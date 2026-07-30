import json
import os
from uuid import uuid4

import asyncpg
import pytest

from app.repositories.postgres import PostgresRepository
from app.services.child_sessions import ChildSessionService
from app.tools.import_question_set import parse_import_document

DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests.",
)


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
