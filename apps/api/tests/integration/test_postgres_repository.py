import json
import os
from uuid import uuid4

import asyncpg
import httpx
import pytest

from app.domain.errors import (
    NotFoundError,
    ResponseVersionConflict,
    SubmittedAttemptImmutable,
    SubmittedQuestionImmutable,
)
from app.domain.models import (
    CompleteReviewRequest,
    CreateAssignmentRequest,
    CreateDeletionRequest,
    CreateFamilyInvitationRequest,
    CreateImportRequest,
    CreateLibrarySubmissionRequest,
    CreateUploadIntentRequest,
    ImportPurpose,
    ParentDecisionRequest,
    ResponseKind,
    ReviewLibrarySubmissionRequest,
    SaveResponseRequest,
    UploadBucket,
)
from app.repositories.postgres import PostgresRepository
from app.services.child_sessions import ChildSessionService
from app.services.database_jobs import DatabaseJobWorker

DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests.",
)


@pytest.mark.asyncio
async def test_postgres_vertical_flow_and_family_isolation() -> None:
    assert DATABASE_URL is not None
    asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    parent_a = uuid4()
    parent_b = uuid4()
    family_a = uuid4()
    family_b = uuid4()
    child_a = uuid4()
    connection = await asyncpg.connect(asyncpg_url)
    pin_hash = ChildSessionService("integration-secret").hash_pin("123456")
    try:
        await connection.executemany(
            """
            insert into auth.users (
              id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at
            ) values (
              $1, '00000000-0000-0000-0000-000000000000',
              'authenticated', 'authenticated', $2, '', now(), now(), now()
            )
            """,
            [
                (parent_a, f"{parent_a}@example.test"),
                (parent_b, f"{parent_b}@example.test"),
            ],
        )
        await connection.executemany(
            "insert into public.families (id, name, created_by) values ($1, $2, $3)",
            [
                (family_a, "Integration family A", parent_a),
                (family_b, "Integration family B", parent_b),
            ],
        )
        await connection.executemany(
            "insert into public.family_members (family_id, user_id) values ($1, $2)",
            [(family_a, parent_a), (family_b, parent_b)],
        )
        await connection.execute(
            """
            insert into public.children (
              id, family_id, nickname, grade_stage, pin_hash
            ) values ($1, $2, 'Alex', 'Junior high 1', $3)
            """,
            child_a,
            family_a,
            pin_hash,
        )
    finally:
        await connection.close()

    repository = PostgresRepository(
        DATABASE_URL,
        supabase_url="http://127.0.0.1:54321",
        service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
    )
    uploaded_path: str | None = None
    try:
        request = CreateImportRequest(
            family_id=family_a,
            filenames=["lesson.pdf"],
            purpose=ImportPurpose.GENERATE_SIMILAR,
            title="Integration worksheet",
            subject="English",
        )
        imported = await repository.create_import(
            request,
            "integration-import",
            str(parent_a),
        )
        repeated = await repository.create_import(
            request,
            "integration-import",
            str(parent_a),
        )
        assert repeated.id == imported.id
        await repository.set_management_pin(
            str(family_a),
            str(parent_a),
            "integration-management-pin-hash",
        )
        assert (
            await repository.get_management_pin_hash(
                str(family_a),
                str(parent_a),
            )
            == "integration-management-pin-hash"
        )
        with pytest.raises(NotFoundError):
            await repository.get_management_pin_hash(
                str(family_a),
                str(parent_b),
            )
        with pytest.raises(NotFoundError):
            await repository.get_question_set_draft(
                str(imported.question_set_id),
                str(parent_b),
            )
        invited_email = f"{parent_b}@example.test"
        invitation = await repository.create_family_invitation(
            str(family_a),
            CreateFamilyInvitationRequest(email=invited_email),
            str(parent_a),
            "integration-parent-invite",
        )
        pending = await repository.list_pending_invitations(invited_email)
        assert [item.id for item in pending] == [invitation.id]
        accepted_family = await repository.accept_family_invitation(
            str(invitation.id),
            invited_email,
            str(parent_b),
        )
        assert accepted_family.id == family_a
        worker = DatabaseJobWorker(
            database_url=DATABASE_URL,
            worker_name="integration-worker",
        )
        assert await worker.run_once() is True
        retry_connection = await asyncpg.connect(asyncpg_url)
        try:
            failed_job_id = await retry_connection.fetchval(
                """
                update public.jobs
                set status = 'failed', attempt_count = max_attempts
                where type = 'extract_source' and subject_id = $1
                returning id
                """,
                imported.id,
            )
        finally:
            await retry_connection.close()
        retried_job = await repository.retry_job(
            str(failed_job_id),
            str(parent_a),
        )
        assert retried_job.status.value == "queued"
        assert retried_job.attempt_count == 0
        assert await worker.run_once() is True
        draft = await repository.get_question_set_draft(
            str(imported.question_set_id),
            str(parent_a),
        )
        assert draft.question_set.status.value == "needs_review"
        assert len(draft.questions) == 3

        lesson_import = await repository.create_import(
            CreateImportRequest(
                family_id=family_a,
                filenames=["english_lesson1_similar_practice.pdf"],
                source_paths=["family/import/questions.pdf"],
                answer_filenames=[
                    "english_lesson1_similar_answer_key.pdf"
                ],
                answer_source_paths=["family/import/answer-key.pdf"],
                reference_filenames=["lesson1-source.pdf"],
                reference_source_paths=["family/import/reference.pdf"],
                purpose=ImportPurpose.USE_AS_QUESTIONS,
                title="Lesson 1 同レベル変形練習",
                subject="English",
            ),
            "integration-lesson-one-import",
            str(parent_a),
        )
        assert lesson_import.answer_filenames == [
            "english_lesson1_similar_answer_key.pdf"
        ]
        assert lesson_import.reference_source_paths == [
            "family/import/reference.pdf"
        ]
        assert await worker.run_once() is True
        lesson_draft = await repository.get_question_set_draft(
            str(lesson_import.question_set_id),
            str(parent_a),
        )
        assert len(lesson_draft.questions) == 49
        assert lesson_draft.questions[0].prompt.endswith(
            "Emma ___ Leo are in the music club."
        )

        confirmed = await repository.confirm_question_set(
            str(imported.question_set_id),
            "integration-confirm",
            str(parent_a),
        )
        assignment = await repository.assign_question_set(
            str(confirmed.id),
            CreateAssignmentRequest(child_id=child_a),
            "integration-assign",
            str(parent_a),
        )
        listed_assignments = await repository.list_child_assignments(str(child_a))
        assert listed_assignments[0].id == assignment.id
        assert listed_assignments[0].question_count == 3
        printable = await repository.get_printable_assignment(
            str(assignment.id),
            str(parent_a),
        )
        assert printable.template_version == "a4-v1"
        assert len(printable.questions) == 3
        with pytest.raises(NotFoundError):
            await repository.get_printable_assignment(
                str(assignment.id),
                str(uuid4()),
            )
        work = await repository.start_assignment(str(assignment.id), str(child_a))
        assert work is not None
        service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if service_role_key:
            intent = await repository.create_child_upload_intent(
                CreateUploadIntentRequest(
                    family_id=family_a,
                    bucket=UploadBucket.RESPONSES,
                    object_id=work.attempt.id,
                    filename="answer.png",
                    content_type="image/png",
                ),
                str(child_a),
                "integration-photo-upload",
            )
            uploaded_path = intent.path
            async with httpx.AsyncClient() as client:
                upload = await client.put(
                    intent.upload_url,
                    content=b"integration-image",
                    headers={"Content-Type": "image/png"},
                )
            assert upload.is_success
            await repository.save_response(
                str(work.attempt.id),
                str(work.questions[2].id),
                str(child_a),
                SaveResponseRequest(
                    kind=ResponseKind.PHOTO,
                    answer={"paths": [uploaded_path]},
                    expected_version=0,
                ),
            )
        first_question = work.questions[0]
        saved = await repository.save_response(
            str(work.attempt.id),
            str(first_question.id),
            str(child_a),
            SaveResponseRequest(
                kind=ResponseKind.CHOICE,
                answer={"choices": [0]},
                expected_version=0,
            ),
        )
        assert saved.version == 1
        reopened_work = await repository.get_attempt_work(
            str(work.attempt.id),
            str(child_a),
        )
        assert len(reopened_work.responses) >= 1
        restored_response = next(
            response
            for response in reopened_work.responses
            if response.question_id == first_question.id
        )
        assert restored_response.answer == {"choices": [0]}
        assert restored_response.version == 1
        if uploaded_path:
            restored_photo_response = next(
                response
                for response in reopened_work.responses
                if response.question_id == work.questions[2].id
            )
            assert len(restored_photo_response.photo_urls) == 1
            async with httpx.AsyncClient() as client:
                preview = await client.get(restored_photo_response.photo_urls[0])
            assert preview.is_success
            assert preview.content == b"integration-image"
        with pytest.raises(ResponseVersionConflict):
            await repository.save_response(
                str(work.attempt.id),
                str(first_question.id),
                str(child_a),
                SaveResponseRequest(
                    kind=ResponseKind.CHOICE,
                    answer={"choices": [0]},
                    expected_version=0,
                ),
            )

        question_receipt = await repository.submit_question(
            str(work.attempt.id),
            str(first_question.id),
            str(child_a),
            "integration-submit-question",
        )
        repeated_question_receipt = await repository.submit_question(
            str(work.attempt.id),
            str(first_question.id),
            str(child_a),
            "integration-submit-question",
        )
        assert repeated_question_receipt.job.id == question_receipt.job.id
        with pytest.raises(SubmittedQuestionImmutable):
            await repository.save_response(
                str(work.attempt.id),
                str(first_question.id),
                str(child_a),
                SaveResponseRequest(
                    kind=ResponseKind.CHOICE,
                    answer={"choices": [1]},
                    expected_version=1,
                ),
            )
        assert await worker.run_once() is True
        partial_results = await repository.get_attempt_results(
            str(work.attempt.id),
            str(child_a),
        )
        assert partial_results.complete is False
        assert [result.question_id for result in partial_results.results] == [
            first_question.id
        ]
        original_result_id = partial_results.results[0].id
        regrade_receipt = await repository.regrade_question(
            str(work.attempt.id),
            str(first_question.id),
            str(child_a),
            "integration-regrade-same-answer",
        )
        repeated_regrade_receipt = await repository.regrade_question(
            str(work.attempt.id),
            str(first_question.id),
            str(child_a),
            "integration-regrade-same-answer",
        )
        assert regrade_receipt.job.id != question_receipt.job.id
        assert repeated_regrade_receipt.job.id == regrade_receipt.job.id
        queued_regrade = await repository.get_question_grading_job(
            str(work.attempt.id),
            str(first_question.id),
            str(regrade_receipt.job.id),
            str(child_a),
        )
        assert queued_regrade.status.value == "queued"
        assert await worker.run_once() is True
        finished_regrade = await repository.get_question_grading_job(
            str(work.attempt.id),
            str(first_question.id),
            str(regrade_receipt.job.id),
            str(child_a),
        )
        assert finished_regrade.status.value == "succeeded"
        regraded_results = await repository.get_attempt_results(
            str(work.attempt.id),
            str(child_a),
        )
        assert len(regraded_results.results) == 1
        assert regraded_results.results[0].id == original_result_id
        partially_reopened = await repository.get_attempt_work(
            str(work.attempt.id),
            str(child_a),
        )
        assert partially_reopened.submitted_question_ids == [first_question.id]
        assert next(
            response
            for response in partially_reopened.responses
            if response.question_id == first_question.id
        ).id == saved.id

        receipt = await repository.submit_attempt(
            str(work.attempt.id),
            str(child_a),
            "integration-submit",
        )
        repeated_receipt = await repository.submit_attempt(
            str(work.attempt.id),
            str(child_a),
            "integration-submit",
        )
        assert repeated_receipt.job.id == receipt.job.id
        assert await worker.run_once() is True
        results = await repository.get_attempt_results(
            str(work.attempt.id),
            str(child_a),
        )
        assert results.complete is True
        assert [result.outcome.value for result in results.results] == (
            ["incorrect", "incorrect", "needs_parent_review"]
            if uploaded_path
            else ["incorrect", "incorrect", "incorrect"]
        )
        single_retry = await repository.create_question_retry(
            str(work.attempt.id),
            str(work.questions[0].id),
            str(child_a),
            "integration-single-question-retry",
        )
        repeated_single_retry = await repository.create_question_retry(
            str(work.attempt.id),
            str(work.questions[0].id),
            str(child_a),
            "integration-single-question-retry",
        )
        assert single_retry.attempt.id == repeated_single_retry.attempt.id
        assert single_retry.attempt.id != work.attempt.id
        assert [question.id for question in single_retry.questions] == [
            work.questions[0].id
        ]
        assert single_retry.responses == []
        if uploaded_path:
            photo_review = await repository.get_parent_attempt_review(
                str(work.attempt.id),
                str(parent_a),
            )
            assert photo_review.pending_review_count == 1
            assert photo_review.reviews[0].response_kind == ResponseKind.PHOTO
            assert len(photo_review.reviews[0].photo_urls) == 1
            async with httpx.AsyncClient() as client:
                preview = await client.get(
                    photo_review.reviews[0].photo_urls[0]
                )
            assert preview.is_success
            assert preview.content == b"integration-image"
        review_connection = await asyncpg.connect(asyncpg_url)
        try:
            await review_connection.execute(
                """
                update public.review_items
                set due_on = current_date
                where child_id = $1
                """,
                child_a,
            )
        finally:
            await review_connection.close()
        reviews = await repository.list_due_reviews(str(child_a))
        # A visual answer that still needs a parent decision must not enter
        # spaced review yet. When local Storage is unavailable, the fallback
        # path has three deterministic incorrect results instead.
        assert len(reviews) == (2 if uploaded_path else 3)
        completion = await repository.complete_review(
            str(reviews[0].id),
            str(child_a),
            CompleteReviewRequest(outcome="correct"),
        )
        assert completion.old_interval_days == 1
        assert completion.new_interval_days == 3
        skipped = await repository.skip_today_reviews(str(child_a))
        assert len(skipped) == len(reviews) - 1
        assert all(
            completion.old_interval_days == completion.new_interval_days == 1
            for completion in skipped
        )
        assert await repository.list_due_reviews(str(child_a)) == []
        review_connection = await asyncpg.connect(asyncpg_url)
        try:
            skipped_rows = await review_connection.fetch(
                """
                select due_on = current_date + 1 as postponed,
                       skipped_on = current_date as recorded,
                       failure_count,
                       consecutive_standard_successes
                from public.review_items
                where id = any($1::uuid[])
                """,
                [completion.item_id for completion in skipped],
            )
        finally:
            await review_connection.close()
        assert len(skipped_rows) == len(skipped)
        assert all(row["postponed"] and row["recorded"] for row in skipped_rows)
        assert all(
            row["failure_count"] == 0
            and row["consecutive_standard_successes"] == 0
            for row in skipped_rows
        )
        correction = await repository.create_correction(
            str(work.attempt.id),
            str(child_a),
            "integration-correction",
        )
        assert len(correction.questions) == 3
        correction_answers = [
            (ResponseKind.CHOICE, {"choices": [1]}),
            (ResponseKind.TEXT, {"text": "plays"}),
            (ResponseKind.STROKES, {"strokes": []}),
        ]
        for question, (kind, answer) in zip(
            correction.questions,
            correction_answers,
            strict=True,
        ):
            await repository.save_response(
                str(correction.attempt.id),
                str(question.id),
                str(child_a),
                SaveResponseRequest(
                    kind=kind,
                    answer=answer,
                    expected_version=0,
                ),
            )
        await repository.submit_attempt(
            str(correction.attempt.id),
            str(child_a),
            "integration-correction-submit",
        )
        assert await worker.run_once() is True
        correction_results = await repository.get_attempt_results(
            str(correction.attempt.id),
            str(child_a),
        )
        assert correction_results.complete is True
        assert [result.outcome.value for result in correction_results.results] == [
            "correct",
            "correct",
            "needs_parent_review",
        ]
        parent_review = await repository.get_parent_attempt_review(
            str(correction.attempt.id),
            str(parent_a),
        )
        assert parent_review.child_nickname == "Alex"
        assert parent_review.complete is True
        assert parent_review.awarded_points == 2
        assert parent_review.available_points == 4
        assert parent_review.pending_review_count == 1
        assert parent_review.reviews[0].response_kind == ResponseKind.STROKES
        assert parent_review.reviews[0].response_answer == {"strokes": []}
        with pytest.raises(NotFoundError):
            await repository.get_parent_attempt_review(
                str(correction.attempt.id),
                str(uuid4()),
            )
        parent_decision = await repository.decide_grading_result(
            str(parent_review.reviews[0].result_id),
            ParentDecisionRequest(
                outcome="correct",
                awarded_points=2,
                comment="Work checked by a parent.",
            ),
            str(parent_a),
        )
        assert parent_decision.parent_outcome == "correct"
        resolved_parent_review = await repository.get_parent_attempt_review(
            str(correction.attempt.id),
            str(parent_a),
        )
        assert resolved_parent_review.awarded_points == 4
        assert resolved_parent_review.correct_count == 3
        assert resolved_parent_review.pending_review_count == 0
        assert resolved_parent_review.reviews == []
        child_history = await repository.list_child_history(str(child_a))
        family_history = await repository.list_family_history(
            str(family_a),
            str(parent_a),
        )
        assert child_history[0].attempt_id == correction.attempt.id
        assert family_history[0].child_nickname == "Alex"
        joined_parent_history = await repository.list_family_history(
            str(family_a),
            str(parent_b),
        )
        assert joined_parent_history[0].assignment_id == assignment.id
        deletion = await repository.create_deletion_request(
            CreateDeletionRequest(
                family_id=family_a,
                target_type="child",
                target_id=child_a,
            ),
            str(parent_a),
            "integration-delete-child",
        )
        assert await repository.get_child(str(child_a)) is None
        restored = await repository.restore_deletion_request(
            str(deletion.id),
            str(parent_a),
        )
        assert restored.restored_at is not None
        assert await repository.get_child(str(child_a)) is not None
        with pytest.raises(SubmittedAttemptImmutable):
            await repository.save_response(
                str(work.attempt.id),
                str(first_question.id),
                str(child_a),
                SaveResponseRequest(
                    kind=ResponseKind.CHOICE,
                    answer={"choices": [0]},
                    expected_version=1,
                ),
            )
    finally:
        await repository.close()
        service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if uploaded_path and service_role_key:
            async with httpx.AsyncClient() as client:
                await client.delete(
                    "http://127.0.0.1:54321/storage/v1/object/"
                    f"responses/{uploaded_path}",
                    headers={
                        "Authorization": f"Bearer {service_role_key}",
                        "apikey": service_role_key,
                    },
                )
        cleanup = await asyncpg.connect(asyncpg_url)
        try:
            await cleanup.execute(
                "delete from public.families where id = any($1::uuid[])",
                [family_a, family_b],
            )
            await cleanup.execute(
                "delete from auth.users where id = any($1::uuid[])",
                [parent_a, parent_b],
            )
        finally:
            await cleanup.close()


@pytest.mark.asyncio
async def test_public_library_copy_keeps_answers_private_and_creates_a_standalone_set() -> None:
    """A public item is anonymous, but its copied family set remains gradeable."""
    assert DATABASE_URL is not None
    asyncpg_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    parent_id = uuid4()
    source_family_id = uuid4()
    destination_family_id = uuid4()
    source_set_id = uuid4()
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
        await connection.executemany(
            "insert into public.families (id, name, created_by) values ($1, $2, $3)",
            [
                (source_family_id, "Library source", parent_id),
                (destination_family_id, "Library destination", parent_id),
            ],
        )
        await connection.executemany(
            "insert into public.family_members (family_id, user_id) values ($1, $2)",
            [(source_family_id, parent_id), (destination_family_id, parent_id)],
        )
        await connection.execute(
            """
            insert into public.question_sets (
              id, family_id, created_by, title, subject, status, source_summary,
              confirmed_at
            ) values ($1, $2, $3, 'Published algebra', 'Mathematics', 'confirmed',
              $4::jsonb, now())
            """,
            source_set_id,
            source_family_id,
            parent_id,
            json.dumps({"source_material_title": "Private algebra book"}),
        )
        await connection.execute(
            """
            insert into public.questions (
              family_id, question_set_id, position, type, prompt, options,
              answer_key, rubric, points
            ) values ($1, $2, 1, 'typed_text', $3::jsonb, null, $4::jsonb, $5::jsonb, 2)
            """,
            source_family_id,
            source_set_id,
            json.dumps({"ja": "x² - 9 を因数分解しなさい。"}),
            json.dumps({"text": "(x - 3)(x + 3)"}),
            json.dumps({"grading_mode": "exact"}),
        )
        submission = await repository.create_library_submission(
            CreateLibrarySubmissionRequest(
                family_id=source_family_id,
                question_set_id=source_set_id,
                rights_confirmed=True,
                privacy_confirmed=True,
            ),
            "integration-public-library-submit",
            str(parent_id),
        )
        approved = await repository.review_library_submission(
            str(submission.id),
            ReviewLibrarySubmissionRequest(decision="approve"),
            "integration-public-library-approve",
            str(parent_id),
        )
        public_items = await repository.list_public_library_items()
        copied = await repository.copy_public_library_item(
            str(public_items[0].id),
            destination_family_id,
            "integration-public-library-copy",
            str(parent_id),
        )
        repeated = await repository.copy_public_library_item(
            str(public_items[0].id),
            destination_family_id,
            "integration-public-library-copy",
            str(parent_id),
        )

        public_snapshot = await connection.fetchval(
            "select snapshot from public.library_items where id = $1",
            public_items[0].id,
        )
        private_snapshot = await connection.fetchval(
            "select content from private.library_item_private_content where library_item_id = $1",
            public_items[0].id,
        )
        copied_question = await connection.fetchrow(
            "select answer_key, prompt from public.questions where question_set_id = $1",
            copied.question_set_id,
        )

        assert approved.status == "published"
        assert public_items[0].title == "Published algebra"
        assert "answer_key" not in json.dumps(public_snapshot)
        assert "Private algebra book" not in json.dumps(public_snapshot)
        assert private_snapshot["questions"][0]["answer_key"] == {
            "text": "(x - 3)(x + 3)"
        }
        assert copied.family_id == destination_family_id
        assert copied.reused_existing is False
        assert repeated.question_set_id == copied.question_set_id
        assert repeated.reused_existing is True
        assert copied_question["answer_key"] == {"text": "(x - 3)(x + 3)"}
        assert copied_question["prompt"] == {"ja": "x² - 9 を因数分解しなさい。"}
    finally:
        await repository.close()
        await connection.execute(
            """
            delete from public.library_items
            where submission_id in (
              select id from public.library_submissions
              where family_id = any($1::uuid[])
            )
            """,
            [source_family_id, destination_family_id],
        )
        await connection.execute(
            "delete from public.families where id = any($1::uuid[])",
            [source_family_id, destination_family_id],
        )
        await connection.execute("delete from auth.users where id = $1", parent_id)
        await connection.close()
