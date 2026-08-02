import json
import os
from uuid import uuid4

import asyncpg
import pytest

from app.domain.errors import LibrarySubmissionContainsPrivateFigure
from app.domain.models import (
    CreateLibrarySubmissionRequest,
    ReviewLibrarySubmissionRequest,
)
from app.repositories.postgres import PostgresRepository
from app.services.child_sessions import ChildSessionService
from app.tools.import_question_set import parse_import_document

DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not DATABASE_URL,
        reason="TEST_DATABASE_URL is required for PostgreSQL integration tests.",
    ),
]


@pytest.mark.asyncio
async def test_ai_json_import_is_atomic_assignable_and_idempotent() -> None:
    assert DATABASE_URL is not None
    asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    parent_id = uuid4()
    family_id = uuid4()
    child_id = uuid4()
    connection = await asyncpg.connect(asyncpg_url)
    try:
        await connection.execute(
            """
            insert into auth.users (
              id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at
            ) values (
              $1, '00000000-0000-0000-0000-000000000000',
              'authenticated', 'authenticated', $2, '', now(), now(), now()
            )
            """,
            parent_id,
            f"{parent_id}@example.test",
        )
        await connection.execute(
            "insert into public.families (id, name, created_by) values ($1, $2, $3)",
            family_id,
            "JSON import family",
            parent_id,
        )
        await connection.execute(
            "insert into public.family_members (family_id, user_id) values ($1, $2)",
            family_id,
            parent_id,
        )
        await connection.execute(
            """
            insert into public.children (
              id, family_id, nickname, grade_stage, pin_hash
            ) values ($1, $2, 'Alex', 'Junior high 1', $3)
            """,
            child_id,
            family_id,
            ChildSessionService("integration-secret").hash_pin("123456"),
        )

        document = parse_import_document(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "question_set": {
                        "title": "Imported practice",
                        "subject": "English",
                        "locale": "ja",
                        "difficulty": "standard",
                        "source_mode": "convert",
                        "instructions": "Answer every question.",
                        "estimated_minutes": 10,
                        "source_summary": {"unit": "Lesson 2"},
                    },
                    "knowledge_tags": [
                        {"code": "if-condition", "label": "if condition"},
                    ],
                    "questions": [
                        {
                            "position": 1,
                            "type": "single_choice",
                            "prompt": "___ it rains, stay home.",
                            "options": ["If", "Because"],
                            "answer_key": {"choice": 0},
                            "rubric": {"grading_mode": "exact"},
                            "points": 1,
                            "knowledge_code": "if-condition",
                        },
                    ],
                }
            )
        )
        repository = PostgresRepository(
            DATABASE_URL,
            supabase_url="http://127.0.0.1:54321",
            service_role_key="",
        )
        imported = await repository.import_structured_question_set(
            document,
            family_id=family_id,
            child_id=child_id,
            source_name="lesson-2.json",
            parent_id=str(parent_id),
        )
        repeated = await repository.import_structured_question_set(
            document,
            family_id=family_id,
            child_id=child_id,
            source_name="lesson-2.json",
            parent_id=str(parent_id),
        )
        await repository.close()

        assert imported.reused_existing is False
        assert imported.status == "confirmed"
        assert imported.assignment_id is not None
        assert repeated.reused_existing is True
        assert repeated.question_set_id == imported.question_set_id
        assert repeated.assignment_id == imported.assignment_id
        assert (
            await connection.fetchval(
                "select count(*) from public.questions where question_set_id = $1",
                imported.question_set_id,
            )
            == 1
        )
        assert (
            await connection.fetchval(
                "select count(*) from public.assignments where question_set_id = $1",
                imported.question_set_id,
            )
            == 1
        )
    finally:
        await connection.execute(
            "delete from public.families where id = $1",
            family_id,
        )
        await connection.execute(
            "delete from auth.users where id = $1",
            parent_id,
        )
        await connection.close()


@pytest.mark.asyncio
async def test_library_review_publishes_a_snapshot_without_answers_or_sources() -> None:
    assert DATABASE_URL is not None
    asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    parent_id = uuid4()
    family_id = uuid4()
    child_id = uuid4()
    connection = await asyncpg.connect(asyncpg_url)
    repository = PostgresRepository(
        DATABASE_URL,
        supabase_url="http://127.0.0.1:54321",
        service_role_key="",
    )
    try:
        await connection.execute(
            """
            insert into auth.users (
              id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at
            ) values (
              $1, '00000000-0000-0000-0000-000000000000',
              'authenticated', 'authenticated', $2, '', now(), now(), now()
            )
            """,
            parent_id,
            f"{parent_id}@example.test",
        )
        await connection.execute(
            "insert into public.families (id, name, created_by) values ($1, $2, $3)",
            family_id,
            "Review integration family",
            parent_id,
        )
        await connection.execute(
            "insert into public.family_members (family_id, user_id) values ($1, $2)",
            family_id,
            parent_id,
        )
        await connection.execute(
            """
            insert into public.children (id, family_id, nickname, grade_stage, pin_hash)
            values ($1, $2, 'Alex', 'Junior high 1', $3)
            """,
            child_id,
            family_id,
            ChildSessionService("integration-secret").hash_pin("123456"),
        )
        document = parse_import_document(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "question_set": {
                        "title": "Private source practice",
                        "subject": "English",
                        "locale": "ja",
                        "difficulty": "standard",
                        "source_mode": "convert",
                        "instructions": "Answer every question.",
                        "estimated_minutes": 10,
                        "source_summary": {"source_material_title": "Private book"},
                    },
                    "knowledge_tags": [{"code": "if-condition", "label": "if condition"}],
                    "questions": [
                        {
                            "position": 1,
                            "type": "single_choice",
                            "prompt": "___ it rains, stay home.",
                            "options": ["If", "Because"],
                            "answer_key": {"choice": 0},
                            "rubric": {"grading_mode": "exact"},
                            "points": 1,
                            "knowledge_code": "if-condition",
                        }
                    ],
                }
            )
        )
        imported = await repository.import_structured_question_set(
            document,
            family_id=family_id,
            child_id=child_id,
            source_name="private-book.json",
            parent_id=str(parent_id),
            assign=False,
        )
        submission = await repository.create_library_submission(
            CreateLibrarySubmissionRequest(
                family_id=family_id,
                question_set_id=imported.question_set_id,
                rights_confirmed=True,
                privacy_confirmed=True,
            ),
            "publish-sanitized-review-set",
            str(parent_id),
        )
        reviewed = await repository.review_library_submission(
            str(submission.id),
            ReviewLibrarySubmissionRequest(
                decision="approve",
                note="Approved for public reuse.",
            ),
            "publish-sanitized-review-decision",
            str(parent_id),
        )

        raw_snapshot = await connection.fetchval(
            "select snapshot from public.library_items where submission_id = $1",
            submission.id,
        )
        snapshot = (
            json.loads(raw_snapshot)
            if isinstance(raw_snapshot, str)
            else raw_snapshot
        )
        serialized_snapshot = json.dumps(snapshot)
        assert reviewed.status == "published"
        assert reviewed.published_at is not None
        assert "answer_key" not in serialized_snapshot
        assert "source_summary" not in serialized_snapshot
        assert "Private book" not in serialized_snapshot
        assert snapshot["questions"][0]["prompt"] == {
            "ja": "___ it rains, stay home.",
        }
    finally:
        await repository.close()
        await connection.execute(
            """
            delete from public.library_items
            where submission_id in (
              select id from public.library_submissions where family_id = $1
            )
            """,
            family_id,
        )
        await connection.execute("delete from public.families where id = $1", family_id)
        await connection.execute("delete from auth.users where id = $1", parent_id)
        await connection.close()


@pytest.mark.asyncio
async def test_library_submission_rejects_question_set_with_private_figure() -> None:
    """Private family images must not silently disappear in a public snapshot."""
    assert DATABASE_URL is not None
    asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    parent_id = uuid4()
    family_id = uuid4()
    child_id = uuid4()
    figure_path = f"{family_id}/private-figure/triangle.png"
    connection = await asyncpg.connect(asyncpg_url)
    repository = PostgresRepository(
        DATABASE_URL,
        supabase_url="http://127.0.0.1:54321",
        service_role_key="",
    )
    try:
        await connection.execute(
            """
            insert into auth.users (
              id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at
            ) values (
              $1, '00000000-0000-0000-0000-000000000000',
              'authenticated', 'authenticated', $2, '', now(), now(), now()
            )
            """,
            parent_id,
            f"{parent_id}@example.test",
        )
        await connection.execute(
            "insert into public.families (id, name, created_by) values ($1, $2, $3)",
            family_id,
            "Private figure integration family",
            parent_id,
        )
        await connection.execute(
            "insert into public.family_members (family_id, user_id) values ($1, $2)",
            family_id,
            parent_id,
        )
        await connection.execute(
            """
            insert into public.children (id, family_id, nickname, grade_stage, pin_hash)
            values ($1, $2, 'Alex', 'Junior high 1', $3)
            """,
            child_id,
            family_id,
            ChildSessionService("integration-secret").hash_pin("123456"),
        )
        await connection.execute(
            """
            insert into public.assets (
              family_id, bucket_id, object_path, media_type, metadata
            ) values ($1, 'sources', $2, 'image/png', '{}'::jsonb)
            """,
            family_id,
            figure_path,
        )

        document = parse_import_document(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "question_set": {
                        "title": "Private figure practice",
                        "subject": "Math",
                        "locale": "en",
                        "difficulty": "standard",
                        "source_mode": "manual",
                        "estimated_minutes": 5,
                    },
                    "knowledge_tags": [{"code": "geometry", "label": "Geometry"}],
                    "questions": [
                        {
                            "position": 1,
                            "type": "single_choice",
                            "prompt": "Which triangle is right-angled?",
                            "options": ["A", "B"],
                            "answer_key": {"choice": 0},
                            "rubric": {"grading_mode": "exact"},
                            "points": 1,
                            "knowledge_code": "geometry",
                            "figure": {
                                "image_path": figure_path,
                                "alt_text": "A pair of triangles",
                            },
                        }
                    ],
                }
            )
        )
        imported = await repository.import_structured_question_set(
            document,
            family_id=family_id,
            child_id=child_id,
            source_name="private-figure.json",
            parent_id=str(parent_id),
            assign=False,
        )

        with pytest.raises(LibrarySubmissionContainsPrivateFigure):
            await repository.create_library_submission(
                CreateLibrarySubmissionRequest(
                    family_id=family_id,
                    question_set_id=imported.question_set_id,
                    rights_confirmed=True,
                    privacy_confirmed=True,
                ),
                "publish-private-figure-set",
                str(parent_id),
            )
    finally:
        await repository.close()
        await connection.execute("delete from public.families where id = $1", family_id)
        await connection.execute("delete from auth.users where id = $1", parent_id)
        await connection.close()
