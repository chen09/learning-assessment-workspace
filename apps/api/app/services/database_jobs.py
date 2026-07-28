import json
from collections.abc import Awaitable, Callable
from typing import Any

import asyncpg
import structlog

from app.domain.models import Job, Question, SavedResponse
from app.services.grading import FixtureGrader

JobHandler = Callable[
    [asyncpg.Connection, dict[str, Any]],
    Awaitable[dict[str, Any]],
]


def _json_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


async def fixture_job_handler(
    connection: asyncpg.Connection,
    job: dict[str, Any],
) -> dict[str, Any]:
    if job["type"] == "purge_deleted_data":
        deletion = await connection.fetchrow(
            """
            select id, target_type, target_id, restored_at, purged_at
            from public.deletion_requests
            where id = $1
            """,
            job["subject_id"],
        )
        if deletion is None or deletion["restored_at"] is not None:
            return {
                "job_type": job["type"],
                "status": "cancelled_after_restore",
            }
        table_by_target = {
            "family": "families",
            "child": "children",
            "asset": "assets",
        }
        table = table_by_target.get(str(deletion["target_type"]))
        if table is None:
            raise RuntimeError("Unsupported deletion target.")
        await connection.execute(
            f"delete from public.{table} where id = $1",
            deletion["target_id"],
        )
        if table != "families":
            await connection.execute(
                """
                update public.deletion_requests
                set purged_at = now()
                where id = $1
                """,
                deletion["id"],
            )
        return {
            "job_type": job["type"],
            "status": "purged",
            "target_type": deletion["target_type"],
        }
    if job["type"] == "extract_source":
        imported = await connection.fetchrow(
            """
            select i.id, i.family_id, i.question_set_id, qs.subject
            from public.question_set_imports i
            join public.question_sets qs on qs.id = i.question_set_id
            where i.id = $1
            """,
            job["subject_id"],
        )
        if imported is None:
            raise RuntimeError("The source import no longer exists.")
        subject = str(imported["subject"])
        knowledge_tag_id = await connection.fetchval(
            """
            insert into public.knowledge_tags (
              family_id, subject, code, label
            ) values ($1, $2, $3, $4::jsonb)
            on conflict (family_id, code) do update
            set subject = excluded.subject
            returning id
            """,
            imported["family_id"],
            subject,
            f"fixture:{subject.casefold().replace(' ', '-')}",
            json.dumps({"en": f"{subject} foundations"}),
        )
        fixtures = (
            (
                "single_choice",
                "Choose the sentence that uses the present simple correctly.",
                [
                    "She walk to school every day.",
                    "She walks to school every day.",
                    "She walking to school every day.",
                ],
                {"choice": 1},
                1,
            ),
            (
                "typed_text",
                "Complete: My brother ___ tennis on Sundays.",
                None,
                {"text": "plays"},
                1,
            ),
            (
                "handwriting",
                "Write one similar sentence and underline the verb.",
                None,
                {"reference": "A grammatical present-simple sentence."},
                2,
            ),
        )
        for position, fixture in enumerate(fixtures, start=1):
            question_type, prompt, options, answer_key, points = fixture
            await connection.execute(
                """
                insert into public.questions (
                  family_id, question_set_id, position, type, prompt, options,
                  answer_key, points, primary_knowledge_tag_id
                ) values (
                  $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9
                )
                on conflict (question_set_id, position) do update
                set type = excluded.type,
                    prompt = excluded.prompt,
                    options = excluded.options,
                    answer_key = excluded.answer_key,
                    points = excluded.points,
                    primary_knowledge_tag_id = excluded.primary_knowledge_tag_id,
                    updated_at = now()
                """,
                imported["family_id"],
                imported["question_set_id"],
                position,
                question_type,
                json.dumps({"en": prompt}),
                json.dumps(options),
                json.dumps(answer_key),
                points,
                knowledge_tag_id,
            )
        await connection.execute(
            """
            update public.question_sets
            set status = 'needs_review', updated_at = now()
            where id = $1
            """,
            imported["question_set_id"],
        )
        await connection.execute(
            """
            update public.question_set_imports
            set status = 'needs_review'
            where id = $1
            """,
            imported["id"],
        )
        return {
            "adapter": "fixture-v1",
            "job_type": job["type"],
            "schema_version": "1.0",
            "question_count": len(fixtures),
            "status": "needs_review",
        }
    if job["type"] == "grade_submission":
        question_rows = await connection.fetch(
            """
            select q.id, q.family_id, q.question_set_id, q.position, q.type,
                   q.prompt, q.options, q.answer_key, q.points,
                   q.primary_knowledge_tag_id, at.child_id
            from public.questions q
            join public.assignments a on a.question_set_id = q.question_set_id
            join public.attempts at on at.assignment_id = a.id
            where at.id = $1
              and (
                at.kind <> 'correction'
                or exists (
                  select 1
                  from public.correction_links cl
                  join public.question_results original_result
                    on original_result.id = cl.original_result_id
                  where cl.correction_attempt_id = at.id
                    and original_result.question_id = q.id
                )
              )
            order by q.position
            """,
            job["subject_id"],
        )
        response_rows = await connection.fetch(
            """
            select id, family_id, attempt_id, question_id, kind, answer, version,
                   saved_at
            from public.responses
            where attempt_id = $1
            """,
            job["subject_id"],
        )
        responses: dict[str, SavedResponse] = {}
        for row in response_rows:
            response_data = dict(row)
            response_data["answer"] = _json_value(response_data["answer"])
            responses[str(row["question_id"])] = SavedResponse(**response_data)
        grader = FixtureGrader()
        job_model = Job(**dict(job))
        outcomes: dict[str, int] = {}
        for row in question_rows:
            prompt_value = _json_value(row["prompt"])
            prompt = (
                prompt_value.get("en", "")
                if isinstance(prompt_value, dict)
                else str(prompt_value)
            )
            question = Question(
                id=row["id"],
                family_id=row["family_id"],
                question_set_id=row["question_set_id"],
                position=row["position"],
                type=row["type"],
                prompt=prompt,
                options=_json_value(row["options"]),
                answer_key=_json_value(row["answer_key"]),
                points=float(row["points"]),
            )
            result = grader.grade(
                job_model,
                question,
                responses.get(str(question.id)),
            )
            await connection.execute(
                """
                insert into public.question_results (
                  id, family_id, attempt_id, question_id, outcome,
                  awarded_points, confidence, feedback, grader_version
                ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                on conflict (attempt_id, question_id) do update
                set outcome = excluded.outcome,
                    awarded_points = excluded.awarded_points,
                    confidence = excluded.confidence,
                    feedback = excluded.feedback,
                    grader_version = excluded.grader_version
                """,
                result.id,
                result.family_id,
                result.attempt_id,
                result.question_id,
                result.outcome.value,
                result.awarded_points,
                result.confidence,
                json.dumps(result.feedback),
                result.grader_version,
            )
            if (
                result.outcome.value == "incorrect"
                and row["primary_knowledge_tag_id"] is not None
            ):
                await connection.execute(
                    """
                    insert into public.review_items (
                      family_id, child_id, knowledge_tag_id, source_question_id,
                      due_on, interval_days, level
                    ) values ($1, $2, $3, $4, current_date + 1, 1, 'standard')
                    on conflict (child_id, source_question_id)
                      where completed_at is null
                    do update set
                      due_on = current_date + 1,
                      interval_days = 1,
                      failure_count = public.review_items.failure_count + 1,
                      updated_at = now()
                    """,
                    result.family_id,
                    row["child_id"],
                    row["primary_knowledge_tag_id"],
                    result.question_id,
                )
            outcomes[result.outcome.value] = outcomes.get(result.outcome.value, 0) + 1
        await connection.execute(
            """
            update public.assignments a
            set status = 'results_ready', updated_at = now()
            from public.attempts at
            where at.id = $1 and a.id = at.assignment_id
            """,
            job["subject_id"],
        )
        return {
            "adapter": grader.version,
            "job_type": job["type"],
            "schema_version": "1.0",
            "question_count": len(question_rows),
            "outcomes": outcomes,
            "status": "processed",
        }
    return {
        "adapter": "fixture",
        "job_type": job["type"],
        "schema_version": "1.0",
        "status": "processed",
    }


class DatabaseJobWorker:
    """Claims one PostgreSQL job at a time; no Redis or in-memory broker."""

    def __init__(
        self,
        *,
        database_url: str,
        worker_name: str,
        handler: JobHandler = fixture_job_handler,
    ) -> None:
        self._database_url = database_url.replace(
            "postgresql+asyncpg://",
            "postgresql://",
            1,
        )
        self._worker_name = worker_name
        self._handler = handler
        self._logger = structlog.get_logger(__name__)

    async def run_once(self) -> bool:
        connection = await asyncpg.connect(self._database_url)
        try:
            await connection.execute("set role learning_worker")
            row = await connection.fetchrow(
                "select * from public.claim_next_job($1)",
                self._worker_name,
            )
            if row is None:
                return False
            job = dict(row)
            try:
                async with connection.transaction():
                    result = await self._handler(connection, job)
                    await connection.execute(
                        """
                        update public.jobs
                        set status = 'succeeded',
                            result = $2::jsonb,
                            completed_at = now(),
                            locked_at = null,
                            locked_by = null,
                            updated_at = now()
                        where id = $1
                        """,
                        job["id"],
                        json.dumps(result),
                    )
            except Exception as error:
                await connection.execute(
                    """
                    update public.jobs
                    set status = 'failed',
                        error_code = 'worker_error',
                        error_detail = left($2, 2000),
                        available_at = now() + make_interval(
                          secs => least(300, power(2, attempt_count)::integer)
                        ),
                        locked_at = null,
                        locked_by = null,
                        updated_at = now()
                    where id = $1
                    """,
                    job["id"],
                    str(error),
                )
                self._logger.exception(
                    "job_failed",
                    job_id=str(job["id"]),
                    job_type=job["type"],
                )
            return True
        finally:
            await connection.close()
