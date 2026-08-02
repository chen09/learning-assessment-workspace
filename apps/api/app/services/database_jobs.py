import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal, cast
from urllib.parse import quote

import asyncpg
import httpx
import structlog

from app.ai.codex_cli import CodexCLIGradingAdapter
from app.ai.contracts import CompletedWorksheetAnalysisInput
from app.domain.models import Job, Question, SavedResponse
from app.fixtures.english_lesson_one import (
    lesson_one_question_specs,
    lesson_one_source_summary,
    matches_lesson_one_import,
)
from app.services.grading import (
    VisualGradingAdapter,
    grade_response_with_ai,
)
from app.services.paper_pipeline import render_pdf_pages

JobHandler = Callable[
    [asyncpg.Connection, dict[str, Any]],
    Awaitable[dict[str, Any]],
]


def _json_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _localized_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for locale in ("en", "ja", "zh"):
            candidate = value.get(locale)
            if isinstance(candidate, str):
                return candidate
    return ""


def _visual_adapter_for_family(
    visual_adapter: VisualGradingAdapter | None,
    *,
    family_id: str,
    allowed_family_ids: frozenset[str] | None,
) -> VisualGradingAdapter | None:
    if visual_adapter is None:
        return None
    if allowed_family_ids is None or family_id in allowed_family_ids:
        return visual_adapter
    return None


async def _download_private_analysis_pages(
    *,
    supabase_url: str,
    service_role_key: str,
    family_id: str,
    bucket: str,
    paths: list[str],
    destination: Path,
    prefix: str,
) -> list[Path]:
    """Download same-family scans and rasterize private PDFs for visual analysis."""
    if not supabase_url or not service_role_key:
        return []
    source_paths = [
        path
        for path in paths
        if Path(path).suffix.lower() in {".jpg", ".jpeg", ".png", ".pdf"}
    ]
    expected_prefix = f"{family_id}/"
    if any(not path.startswith(expected_prefix) for path in source_paths):
        raise RuntimeError("Worksheet image path is outside its family boundary.")
    downloaded: list[Path] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for index, path in enumerate(source_paths, start=1):
            endpoint = (
                f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/"
                f"{quote(path, safe='/')}"
            )
            response = await client.get(
                endpoint,
                headers={
                    "Authorization": f"Bearer {service_role_key}",
                    "apikey": service_role_key,
                },
            )
            response.raise_for_status()
            if len(response.content) > 15_000_000:
                raise RuntimeError("Worksheet scan exceeds the 15 MB analysis limit.")
            suffix = Path(path).suffix.lower()
            source_path = destination / f"{prefix}-{index}{suffix}"
            source_path.write_bytes(response.content)
            if suffix == ".pdf":
                rendered_pages = render_pdf_pages(
                    source_path,
                    destination / f"{prefix}-{index}-pages",
                )
                downloaded.extend(rendered_pages)
            else:
                downloaded.append(source_path)
            if len(downloaded) > 100:
                raise RuntimeError("Worksheet scan has more than 100 analysis pages.")
    return downloaded


async def fixture_job_handler(
    connection: asyncpg.Connection,
    job: dict[str, Any],
    *,
    visual_adapter: VisualGradingAdapter | None = None,
    allowed_visual_family_ids: frozenset[str] | None = None,
    minimum_confidence: float = 0.75,
    supabase_url: str = "",
    supabase_service_role_key: str = "",
    allow_fixture_source_generation: bool = True,
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
    if job["type"] == "analyze_completed_worksheet":
        worksheet = await connection.fetchrow(
            """
            select id, family_id, child_id, title, subject, document_language,
                   feedback_language, filenames, response_paths,
                   answer_source_paths, reference_source_paths
            from public.completed_worksheet_imports
            where id = $1
            """,
            job["subject_id"],
        )
        if worksheet is None:
            raise RuntimeError("The completed worksheet upload no longer exists.")
        response_paths = list(_json_value(worksheet["response_paths"]))
        answer_source_paths = list(_json_value(worksheet["answer_source_paths"]))
        reference_source_paths = list(
            _json_value(worksheet["reference_source_paths"])
        )
        extraction: dict[str, Any] = {
            "schema_version": "1.0",
            "status": "needs_parent_confirmation",
            "artifact_kind": "completed_worksheet_scan",
            "source_page_count": len(response_paths),
            "question_units": [],
            "warnings": [
                "No question boundaries are final until a parent confirms them."
            ],
        }
        adapter_name = "fixture-v1"
        worksheet_adapter = _visual_adapter_for_family(
            visual_adapter,
            family_id=str(worksheet["family_id"]),
            allowed_family_ids=allowed_visual_family_ids,
        )
        if (
            isinstance(worksheet_adapter, CodexCLIGradingAdapter)
            and supabase_url
            and supabase_service_role_key
        ):
            with TemporaryDirectory(prefix="luma-private-worksheet-") as directory:
                workspace = Path(directory)
                response_images = await _download_private_analysis_pages(
                    supabase_url=supabase_url,
                    service_role_key=supabase_service_role_key,
                    family_id=str(worksheet["family_id"]),
                    bucket="responses",
                    paths=response_paths,
                    destination=workspace,
                    prefix="response",
                )
                if response_images:
                    answer_key_images = await _download_private_analysis_pages(
                        supabase_url=supabase_url,
                        service_role_key=supabase_service_role_key,
                        family_id=str(worksheet["family_id"]),
                        bucket="sources",
                        paths=answer_source_paths,
                        destination=workspace,
                        prefix="answer-key",
                    )
                    reference_images = await _download_private_analysis_pages(
                        supabase_url=supabase_url,
                        service_role_key=supabase_service_role_key,
                        family_id=str(worksheet["family_id"]),
                        bucket="sources",
                        paths=reference_source_paths,
                        destination=workspace,
                        prefix="reference",
                    )
                    drafted = worksheet_adapter.analyze_completed_worksheet(
                        CompletedWorksheetAnalysisInput(
                            document_language=cast(
                                Literal["en", "ja", "zh"],
                                str(worksheet["document_language"]),
                            ),
                            feedback_language=cast(
                                Literal["en", "ja", "zh"],
                                str(worksheet["feedback_language"]),
                            ),
                            source_page_count=len(response_images),
                            answer_key_page_count=len(answer_key_images),
                            reference_page_count=len(reference_images),
                        ),
                        response_page_images=response_images,
                        answer_key_images=answer_key_images,
                        reference_images=reference_images,
                    )
                    extraction = drafted.model_dump(mode="json")
                    extraction["source_page_count"] = len(response_images)
                    adapter_name = worksheet_adapter.version
                else:
                    extraction["warnings"].append(
                        "Automatic extraction currently needs at least one supported "
                        "PNG, JPEG, or PDF worksheet page."
                    )
        await connection.execute(
            """
            update public.completed_worksheet_imports
            set status = 'needs_review', extraction = $2::jsonb, updated_at = now()
            where id = $1
            """,
            worksheet["id"],
            json.dumps(extraction),
        )
        return {
            "adapter": adapter_name,
            "job_type": job["type"],
            "schema_version": "1.0",
            "status": "needs_review",
            "source_page_count": extraction["source_page_count"],
        }
    if job["type"] == "extract_source":
        imported = await connection.fetchrow(
            """
            select i.id, i.family_id, i.question_set_id, i.filenames,
                   i.answer_filenames, i.reference_filenames, qs.subject
            from public.question_set_imports i
            join public.question_sets qs on qs.id = i.question_set_id
            where i.id = $1
            """,
            job["subject_id"],
        )
        if imported is None:
            raise RuntimeError("The source import no longer exists.")
        subject = str(imported["subject"])
        is_lesson_one = matches_lesson_one_import(
            list(_json_value(imported["filenames"])),
            list(_json_value(imported["answer_filenames"])),
        )
        if not allow_fixture_source_generation:
            fixture_rows: list[tuple[Any, ...]] = []
        elif is_lesson_one:
            fixture_rows = [
                (
                    spec.type.value,
                    spec.prompt,
                    list(spec.options) if spec.options else None,
                    spec.answer_key,
                    spec.points,
                    spec.knowledge_code,
                    spec.knowledge_label,
                )
                for spec in lesson_one_question_specs()
            ]
        else:
            fixture_rows = [
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
                    f"fixture:{subject.casefold().replace(' ', '-')}",
                    f"{subject} foundations",
                ),
                (
                    "typed_text",
                    "Complete: My brother ___ tennis on Sundays.",
                    None,
                    {"text": "plays"},
                    1,
                    f"fixture:{subject.casefold().replace(' ', '-')}",
                    f"{subject} foundations",
                ),
                (
                    "handwriting",
                    "Write one similar sentence and underline the verb.",
                    None,
                    {"reference": "A grammatical present-simple sentence."},
                    2,
                    f"fixture:{subject.casefold().replace(' ', '-')}",
                    f"{subject} foundations",
                ),
            ]
        knowledge_tag_ids: dict[str, Any] = {}
        for position, fixture in enumerate(fixture_rows, start=1):
            (
                question_type,
                prompt,
                options,
                answer_key,
                points,
                knowledge_code,
                knowledge_label,
            ) = fixture
            knowledge_tag_id = knowledge_tag_ids.get(knowledge_code)
            if knowledge_tag_id is None:
                knowledge_tag_id = await connection.fetchval(
                    """
                    insert into public.knowledge_tags (
                      family_id, subject, code, label
                    ) values ($1, $2, $3, $4::jsonb)
                    on conflict (family_id, code) do update
                    set subject = excluded.subject,
                        label = excluded.label
                    returning id
                    """,
                    imported["family_id"],
                    subject,
                    knowledge_code,
                    json.dumps({"en": knowledge_label}),
                )
                knowledge_tag_ids[knowledge_code] = knowledge_tag_id
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
            set status = 'needs_review',
                source_summary = $2::jsonb,
                updated_at = now()
            where id = $1
            """,
            imported["question_set_id"],
            json.dumps(
                lesson_one_source_summary(
                    len(list(_json_value(imported["reference_filenames"])))
                )
                if allow_fixture_source_generation and is_lesson_one
                else {
                    "schema_version": "1.0",
                    "artifact_kind": (
                        "fixture_generated_practice"
                        if allow_fixture_source_generation
                        else "private_source_material"
                    ),
                    **(
                        {"knowledge_points": [f"{subject} foundations"]}
                        if allow_fixture_source_generation
                        else {
                            "generation_status": "awaiting_structured_draft",
                            "source_file_count": len(
                                list(_json_value(imported["filenames"]))
                            ),
                            "answer_key_file_count": len(
                                list(_json_value(imported["answer_filenames"]))
                            ),
                        }
                    ),
                    "reference_file_count": len(
                        list(_json_value(imported["reference_filenames"]))
                    ),
                }
            ),
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
            "question_count": len(fixture_rows),
            "source_material_count": len(
                list(_json_value(imported["reference_filenames"]))
            ),
            "generation_status": (
                "fixture_generated"
                if allow_fixture_source_generation
                else "awaiting_structured_draft"
            ),
            "status": "needs_review",
        }
    if job["type"] == "grade_submission":
        payload = _json_value(job.get("payload") or {})
        submitted_question_id = (
            payload.get("question_id")
            if isinstance(payload, dict)
            else None
        )
        question_rows = await connection.fetch(
            """
            select q.id, q.family_id, q.question_set_id, q.position, q.type,
                   q.prompt, q.options, q.answer_key, q.rubric, q.points,
                   q.primary_knowledge_tag_id, at.child_id, c.ui_language
            from public.questions q
            join public.assignments a on a.question_set_id = q.question_set_id
            join public.attempts at on at.assignment_id = a.id
            join public.children c on c.id = at.child_id
            where at.id = $1
              and ($2::uuid is null or q.id = $2::uuid)
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
            submitted_question_id,
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
        job_data = dict(job)
        job_data["payload"] = payload
        job_model = Job(**job_data)
        job_visual_adapter = _visual_adapter_for_family(
            visual_adapter,
            family_id=str(job_model.family_id),
            allowed_family_ids=allowed_visual_family_ids,
        )
        outcomes: dict[str, int] = {}
        grader_versions: set[str] = set()
        for row in question_rows:
            question = Question(
                id=row["id"],
                family_id=row["family_id"],
                question_set_id=row["question_set_id"],
                position=row["position"],
                type=row["type"],
                prompt=_localized_text(_json_value(row["prompt"])),
                options=_json_value(row["options"]),
                answer_key=_json_value(row["answer_key"]),
                points=float(row["points"]),
            )
            rubric = _json_value(row["rubric"])
            grading_guide = (
                str(rubric.get("grading_guide") or rubric.get("criteria") or "")
                if isinstance(rubric, dict)
                else str(rubric)
            )
            result = grade_response_with_ai(
                job_model,
                question,
                responses.get(str(question.id)),
                visual_adapter=job_visual_adapter,
                grading_guide=grading_guide,
                minimum_confidence=minimum_confidence,
                feedback_language=cast(
                    Literal["en", "ja", "zh"],
                    str(row["ui_language"]),
                ),
            )
            grader_versions.add(result.grader_version)
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
        if submitted_question_id is None:
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
            "adapter": ",".join(sorted(grader_versions)) or "fixture-v1",
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
                if job["type"] == "analyze_completed_worksheet":
                    await connection.execute(
                        """
                        update public.completed_worksheet_imports
                        set status = 'failed', updated_at = now()
                        where id = $1
                        """,
                        job["subject_id"],
                    )
                self._logger.exception(
                    "job_failed",
                    job_id=str(job["id"]),
                    job_type=job["type"],
                )
            return True
        finally:
            await connection.close()
