import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import quote
from uuid import UUID

import httpx
from sqlalchemy import text
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from app.domain.errors import (
    AssignmentStatusConflict,
    FamilyParentLimitReached,
    NotFoundError,
    QuestionAnswerRequired,
    ResponseVersionConflict,
    SubmittedAttemptImmutable,
    SubmittedQuestionImmutable,
)
from app.domain.models import (
    Assignment,
    AssignmentStatus,
    AssignmentWork,
    Attempt,
    AttemptResults,
    Child,
    ChildAssignmentSummary,
    CompletedWorksheetConfirmation,
    CompletedWorksheetImport,
    CompletedWorksheetResponseInput,
    CompletedWorksheetStatus,
    CompleteReviewRequest,
    CreateAssignmentRequest,
    CreateChildRequest,
    CreateCompletedWorksheetRequest,
    CreateDeletionRequest,
    CreateFamilyInvitationRequest,
    CreateFamilyRequest,
    CreateImportRequest,
    CreateLibrarySubmissionRequest,
    CreateUploadIntentRequest,
    DeletionRequestView,
    DemoBootstrap,
    Family,
    FamilyInvitation,
    FamilyLibraryQuestionSet,
    HistoryItem,
    Job,
    LibrarySubmission,
    ParentAttemptReview,
    ParentDecision,
    ParentDecisionRequest,
    ParentReviewItem,
    PrintableAssignment,
    Question,
    QuestionResult,
    QuestionSet,
    QuestionSetDraft,
    QuestionSetImport,
    QuestionSubmissionReceipt,
    QuestionView,
    ReviewCompletion,
    ReviewItemView,
    SavedResponse,
    SaveResponseRequest,
    SubmissionReceipt,
    UploadIntent,
)
from app.tools.import_question_set import (
    ImportDocument,
    ImportResult,
    import_question_set,
)

logger = logging.getLogger(__name__)


def _uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _localized_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for locale in ("en", "ja", "zh"):
            candidate = value.get(locale)
            if isinstance(candidate, str):
                return candidate
    return ""


def _float(value: Decimal | float | int | None) -> float | None:
    return None if value is None else float(value)


def _question(row: RowMapping) -> Question:
    raw_options = row["options"]
    options = (
        [str(option) for option in raw_options]
        if isinstance(raw_options, list)
        else None
    )
    return Question(
        id=row["id"],
        family_id=row["family_id"],
        question_set_id=row["question_set_id"],
        position=row["position"],
        type=row["type"],
        prompt=_localized_text(row["prompt"]),
        options=options,
        answer_key=cast(dict[str, Any], row["answer_key"]),
        points=float(row["points"]),
    )


def _question_set(row: RowMapping) -> QuestionSet:
    return QuestionSet(
        id=row["id"],
        family_id=row["family_id"],
        title=row["title"],
        subject=row["subject"],
        status=row["status"],
        source_summary=cast(
            dict[str, Any],
            row.get("source_summary") or {},
        ),
    )


def _assignment(row: RowMapping) -> Assignment:
    return Assignment(
        id=row["id"],
        family_id=row["family_id"],
        question_set_id=row["question_set_id"],
        child_id=row["child_id"],
        status=row["status"],
        mode=row["mode"],
        time_limit_seconds=row["time_limit_seconds"],
        parent_note=row.get("parent_note"),
    )


def _attempt(row: RowMapping) -> Attempt:
    return Attempt(
        id=row["id"],
        family_id=row["family_id"],
        assignment_id=row["assignment_id"],
        child_id=row["child_id"],
        sequence=row["sequence"],
        started_at=row["started_at"],
        submitted_at=row["submitted_at"],
    )


def _job(row: RowMapping) -> Job:
    return Job(
        id=row["id"],
        family_id=row["family_id"],
        subject_id=row["subject_id"],
        type=row["type"],
        status=row["status"],
        attempt_count=row["attempt_count"],
        created_at=row["created_at"],
        completed_at=row["completed_at"],
    )


def _result(row: RowMapping) -> QuestionResult:
    return QuestionResult(
        id=row["id"],
        family_id=row["family_id"],
        attempt_id=row["attempt_id"],
        question_id=row["question_id"],
        outcome=row["outcome"],
        awarded_points=_float(row["awarded_points"]),
        confidence=float(row["confidence"] or 0),
        feedback=cast(dict[str, Any], row["feedback"]),
        grader_version=row["grader_version"],
    )


def _history_item(row: RowMapping) -> HistoryItem:
    data = dict(row)
    data["awarded_points"] = float(row["awarded_points"])
    data["available_points"] = float(row["available_points"])
    return HistoryItem(**data)


class PostgresRepository:
    """Production repository with explicit parent/child tenant checks."""

    def __init__(
        self,
        database_url: str,
        *,
        supabase_url: str,
        service_role_key: str,
    ) -> None:
        self._database_url = database_url
        self._engine: AsyncEngine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            connect_args={"server_settings": {"role": "learning_api"}},
        )
        self._supabase_url = supabase_url.rstrip("/")
        self._service_role_key = service_role_key

    async def import_structured_question_set(
        self,
        document: ImportDocument,
        *,
        family_id: UUID,
        child_id: UUID,
        source_name: str,
        parent_id: str,
        assign: bool = True,
        assignment_mode: Literal["practice", "exam"] = "practice",
        time_limit_seconds: int | None = None,
        parent_note: str | None = None,
    ) -> ImportResult:
        return await import_question_set(
            document,
            database_url=self._database_url,
            family_id=family_id,
            child_id=child_id,
            source_name=source_name,
            confirm=True,
            assign=assign,
            parent_id=_uuid(parent_id),
            assignment_mode=assignment_mode,
            time_limit_seconds=time_limit_seconds,
            parent_note=parent_note,
        )

    async def close(self) -> None:
        await self._engine.dispose()

    async def _sign_response_photo_urls(
        self,
        paths: list[str],
    ) -> dict[str, str]:
        if not paths or not self._service_role_key:
            return {}
        endpoint = f"{self._supabase_url}/storage/v1/object/sign/responses"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self._service_role_key}",
                        "apikey": self._service_role_key,
                        "Content-Type": "application/json",
                    },
                    json={"expiresIn": 300, "paths": paths},
                )
                response.raise_for_status()
                payload = cast(list[dict[str, Any]], response.json())
        except (httpx.HTTPError, TypeError, ValueError):
            logger.warning(
                "Could not create signed response-photo URLs.",
                exc_info=True,
            )
            return {}

        signed_urls: dict[str, str] = {}
        for item in payload:
            path = item.get("path")
            signed_path = item.get("signedURL") or item.get("signedUrl")
            if not isinstance(path, str) or not isinstance(signed_path, str):
                continue
            if signed_path.startswith("/"):
                signed_path = f"{self._supabase_url}/storage/v1{signed_path}"
            signed_urls[path] = signed_path
        return signed_urls

    async def _is_parent(
        self,
        connection: AsyncConnection,
        parent_id: str,
        family_id: UUID,
    ) -> bool:
        result = await connection.execute(
            text(
                """
                select exists (
                  select 1 from public.family_members
                  where family_id = :family_id
                    and user_id = :parent_id
                    and status = 'active'
                )
                """
            ),
            {"family_id": family_id, "parent_id": _uuid(parent_id)},
        )
        return bool(result.scalar_one())

    async def _require_parent(
        self,
        connection: AsyncConnection,
        parent_id: str,
        family_id: UUID,
    ) -> None:
        if not await self._is_parent(connection, parent_id, family_id):
            raise NotFoundError

    async def _idempotent_resource(
        self,
        connection: AsyncConnection,
        *,
        family_id: UUID,
        actor_id: str,
        action: str,
        idempotency_key: str,
    ) -> UUID | None:
        result = await connection.execute(
            text(
                """
                select resource_id
                from public.api_idempotency_keys
                where family_id = :family_id
                  and actor_id = :actor_id
                  and action = :action
                  and idempotency_key = :idempotency_key
                """
            ),
            {
                "family_id": family_id,
                "actor_id": actor_id,
                "action": action,
                "idempotency_key": idempotency_key,
            },
        )
        return cast(UUID | None, result.scalar_one_or_none())

    async def _remember_idempotency(
        self,
        connection: AsyncConnection,
        *,
        family_id: UUID,
        actor_id: str,
        action: str,
        idempotency_key: str,
        resource_id: UUID,
    ) -> None:
        await connection.execute(
            text(
                """
                insert into public.api_idempotency_keys (
                  family_id, actor_id, action, idempotency_key, resource_id
                ) values (
                  :family_id, :actor_id, :action, :idempotency_key, :resource_id
                )
                """
            ),
            {
                "family_id": family_id,
                "actor_id": actor_id,
                "action": action,
                "idempotency_key": idempotency_key,
                "resource_id": resource_id,
            },
        )

    async def bootstrap_demo(self) -> DemoBootstrap:
        raise RuntimeError("The demo bootstrap endpoint is disabled for PostgreSQL.")

    async def list_families(self, parent_id: str) -> list[Family]:
        async with self._engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        """
                        select f.id, f.name
                        from public.families f
                        join public.family_members fm on fm.family_id = f.id
                        where fm.user_id = :parent_id
                          and fm.status = 'active'
                          and f.deleted_at is null
                        order by f.created_at
                        """
                    ),
                    {"parent_id": _uuid(parent_id)},
                )
            ).mappings().all()
        return [Family(**dict(row)) for row in rows]

    async def create_family(
        self,
        request: CreateFamilyRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> Family:
        async with self._engine.begin() as connection:
            existing_result = await connection.execute(
                text(
                    """
                    select f.id, f.name
                    from public.api_idempotency_keys i
                    join public.families f on f.id = i.resource_id
                    where i.actor_id = :parent_id
                      and i.action = 'create_family'
                      and i.idempotency_key = :idempotency_key
                    """
                ),
                {
                    "parent_id": parent_id,
                    "idempotency_key": idempotency_key,
                },
            )
            existing = existing_result.mappings().one_or_none()
            if existing is not None:
                return Family(**dict(existing))
            family_result = await connection.execute(
                text(
                    """
                    insert into public.families (name, created_by)
                    values (:name, :parent_id)
                    returning id, name
                    """
                ),
                {"name": request.name.strip(), "parent_id": _uuid(parent_id)},
            )
            row = family_result.mappings().one()
            await connection.execute(
                text(
                    """
                    insert into public.family_members (family_id, user_id)
                    values (:family_id, :parent_id)
                    """
                ),
                {"family_id": row["id"], "parent_id": _uuid(parent_id)},
            )
            await self._remember_idempotency(
                connection,
                family_id=row["id"],
                actor_id=parent_id,
                action="create_family",
                idempotency_key=idempotency_key,
                resource_id=row["id"],
            )
            return Family(**dict(row))

    async def list_children(self, family_id: str, parent_id: str) -> list[Child]:
        family_uuid = _uuid(family_id)
        async with self._engine.connect() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, nickname, grade_stage, ui_language
                        from public.children
                        where family_id = :family_id and deleted_at is null
                        order by created_at
                        """
                    ),
                    {"family_id": family_uuid},
                )
            ).mappings().all()
        return [Child(**dict(row)) for row in rows]

    async def create_child(
        self,
        family_id: str,
        request: CreateChildRequest,
        pin_hash: str,
        parent_id: str,
        idempotency_key: str,
    ) -> Child:
        family_uuid = _uuid(family_id)
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            existing_id = await self._idempotent_resource(
                connection,
                family_id=family_uuid,
                actor_id=parent_id,
                action="create_child",
                idempotency_key=idempotency_key,
            )
            if existing_id is None:
                result = await connection.execute(
                    text(
                        """
                        insert into public.children (
                          family_id, nickname, grade_stage, ui_language, pin_hash
                        ) values (
                          :family_id, :nickname, :grade_stage, :ui_language, :pin_hash
                        )
                        returning id, family_id, nickname, grade_stage, ui_language
                        """
                    ),
                    {
                        "family_id": family_uuid,
                        "nickname": request.nickname.strip(),
                        "grade_stage": request.grade_stage.strip(),
                        "ui_language": request.ui_language,
                        "pin_hash": pin_hash,
                    },
                )
                row = result.mappings().one()
                await self._remember_idempotency(
                    connection,
                    family_id=family_uuid,
                    actor_id=parent_id,
                    action="create_child",
                    idempotency_key=idempotency_key,
                    resource_id=row["id"],
                )
            else:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, nickname, grade_stage, ui_language
                        from public.children where id = :id and deleted_at is null
                        """
                    ),
                    {"id": existing_id},
                )
                row = result.mappings().one()
        return Child(**dict(row))

    async def update_child_pin(
        self,
        child_id: str,
        pin_hash: str,
        parent_id: str,
    ) -> Child:
        async with self._engine.begin() as connection:
            child_result = await connection.execute(
                text(
                    """
                    select id, family_id, nickname, grade_stage, ui_language
                    from public.children
                    where id = :child_id and deleted_at is null
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            row = child_result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            await connection.execute(
                text(
                    """
                    update public.children
                    set pin_hash = :pin_hash,
                        failed_pin_attempts = 0,
                        pin_locked_until = null,
                        updated_at = now()
                    where id = :child_id
                    """
                ),
                {"pin_hash": pin_hash, "child_id": _uuid(child_id)},
            )
        return Child(**dict(row))

    async def update_child_language(
        self,
        child_id: str,
        ui_language: str,
        parent_id: str | None = None,
    ) -> Child:
        async with self._engine.begin() as connection:
            child_result = await connection.execute(
                text(
                    """
                    select id, family_id, nickname, grade_stage, ui_language
                    from public.children
                    where id = :child_id and deleted_at is null
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            child = child_result.mappings().one_or_none()
            if child is None:
                raise NotFoundError
            if parent_id is not None:
                await self._require_parent(
                    connection,
                    parent_id,
                    child["family_id"],
                )
            result = await connection.execute(
                text(
                    """
                    update public.children
                    set ui_language = :ui_language,
                        updated_at = now()
                    where id = :child_id
                    returning id, family_id, nickname, grade_stage, ui_language
                    """
                ),
                {
                    "child_id": _uuid(child_id),
                    "ui_language": ui_language,
                },
            )
            row = result.mappings().one()
        return Child(**dict(row))

    async def set_management_pin(
        self,
        family_id: str,
        parent_id: str,
        pin_hash: str,
    ) -> None:
        family_uuid = _uuid(family_id)
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            await connection.execute(
                text(
                    """
                    update public.family_members
                    set management_pin_hash = :pin_hash
                    where family_id = :family_id
                      and user_id = :parent_id
                      and status = 'active'
                    """
                ),
                {
                    "family_id": family_uuid,
                    "parent_id": _uuid(parent_id),
                    "pin_hash": pin_hash,
                },
            )

    async def get_management_pin_hash(
        self,
        family_id: str,
        parent_id: str,
    ) -> str | None:
        family_uuid = _uuid(family_id)
        async with self._engine.connect() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            result = await connection.execute(
                text(
                    """
                    select management_pin_hash
                    from public.family_members
                    where family_id = :family_id
                      and user_id = :parent_id
                      and status = 'active'
                    """
                ),
                {
                    "family_id": family_uuid,
                    "parent_id": _uuid(parent_id),
                },
            )
            return cast(str | None, result.scalar_one_or_none())

    async def get_child(self, child_id: str) -> Child | None:
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, nickname, grade_stage, ui_language
                    from public.children
                    where id = :child_id and deleted_at is null
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            row = result.mappings().one_or_none()
        if row is None:
            return None
        return Child(**dict(row))

    async def get_child_pin_hash(self, child_id: str) -> str | None:
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    "select pin_hash from public.children "
                    "where id = :child_id and deleted_at is null"
                ),
                {"child_id": _uuid(child_id)},
            )
            return cast(str | None, result.scalar_one_or_none())

    async def is_child_pin_locked(self, child_id: str) -> bool:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select pin_locked_until
                    from public.children
                    where id = :child_id and deleted_at is null
                    for update
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            locked_until = cast(datetime | None, result.scalar_one_or_none())
            if locked_until is None:
                return False
            if locked_until > datetime.now(UTC):
                return True
            await connection.execute(
                text(
                    """
                    update public.children
                    set failed_pin_attempts = 0, pin_locked_until = null
                    where id = :child_id
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            return False

    async def record_child_pin_failure(self, child_id: str) -> bool:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    update public.children
                    set failed_pin_attempts = least(5, failed_pin_attempts + 1),
                        pin_locked_until = case
                          when failed_pin_attempts + 1 >= 5
                          then now() + interval '5 minutes'
                          else pin_locked_until
                        end,
                        updated_at = now()
                    where id = :child_id and deleted_at is null
                    returning failed_pin_attempts >= 5
                    """
                ),
                {"child_id": _uuid(child_id)},
            )
            return bool(result.scalar_one_or_none())

    async def reset_child_pin_failures(self, child_id: str) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    update public.children
                    set failed_pin_attempts = 0, pin_locked_until = null, updated_at = now()
                    where id = :child_id
                    """
                ),
                {"child_id": _uuid(child_id)},
            )

    async def start_assignment(
        self,
        assignment_id: str,
        child_id: str,
    ) -> AssignmentWork | None:
        async with self._engine.begin() as connection:
            assignment_result = await connection.execute(
                text(
                    """
                    select a.id, a.family_id, a.question_set_id, a.child_id,
                           a.status, a.mode, a.time_limit_seconds, a.parent_note, qs.title
                    from public.assignments a
                    join public.question_sets qs on qs.id = a.question_set_id
                    where a.id = :assignment_id
                      and a.child_id = :child_id
                      and a.status in ('assigned', 'in_progress')
                    for update
                    """
                ),
                {
                    "assignment_id": _uuid(assignment_id),
                    "child_id": _uuid(child_id),
                },
            )
            assignment_row = assignment_result.mappings().one_or_none()
            if assignment_row is None:
                return None
            attempt_result = await connection.execute(
                text(
                    """
                    select id, family_id, assignment_id, child_id, sequence,
                           started_at, submitted_at
                    from public.attempts
                    where assignment_id = :assignment_id
                      and child_id = :child_id
                      and submitted_at is null
                    order by sequence desc
                    limit 1
                    """
                ),
                {
                    "assignment_id": _uuid(assignment_id),
                    "child_id": _uuid(child_id),
                },
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                next_sequence_result = await connection.execute(
                    text(
                        """
                        select coalesce(max(sequence), 0) + 1
                        from public.attempts
                        where assignment_id = :assignment_id
                        """
                    ),
                    {"assignment_id": _uuid(assignment_id)},
                )
                sequence = int(next_sequence_result.scalar_one())
                attempt_result = await connection.execute(
                    text(
                        """
                        insert into public.attempts (
                          family_id, assignment_id, child_id, sequence,
                          client_idempotency_key
                        ) values (
                          :family_id, :assignment_id, :child_id, :sequence, :client_key
                        )
                        returning id, family_id, assignment_id, child_id, sequence,
                                  started_at, submitted_at
                        """
                    ),
                    {
                        "family_id": assignment_row["family_id"],
                        "assignment_id": _uuid(assignment_id),
                        "child_id": _uuid(child_id),
                        "sequence": sequence,
                        "client_key": f"start:{assignment_id}:{sequence}",
                    },
                )
                attempt_row = attempt_result.mappings().one()
            await connection.execute(
                text(
                    """
                    update public.assignments
                    set status = 'in_progress',
                        started_at = coalesce(started_at, now()),
                        updated_at = now()
                    where id = :assignment_id
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            question_result = await connection.execute(
                text(
                    """
                    select id, family_id, question_set_id, position, type, prompt,
                           options, answer_key, points
                    from public.questions
                    where question_set_id = :question_set_id
                    order by position
                    """
                ),
                {"question_set_id": assignment_row["question_set_id"]},
            )
            question_rows = question_result.mappings().all()
            response_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, attempt_id, question_id, kind,
                               answer, version, saved_at
                        from public.responses
                        where attempt_id = :attempt_id
                        order by saved_at
                        """
                    ),
                    {"attempt_id": attempt_row["id"]},
                )
            ).mappings().all()
            submitted_question_ids = list(
                (
                    await connection.execute(
                        text(
                            """
                            select question_id
                            from public.question_submissions
                            where attempt_id = :attempt_id
                            order by submitted_at
                            """
                        ),
                        {"attempt_id": attempt_row["id"]},
                    )
                ).scalars()
            )

        assignment_data = dict(assignment_row)
        assignment_data["status"] = AssignmentStatus.IN_PROGRESS
        questions = [_question(row) for row in question_rows]
        return AssignmentWork(
            title=str(assignment_row["title"]),
            assignment=_assignment(cast(RowMapping, assignment_data)),
            attempt=_attempt(attempt_row),
            questions=[
                QuestionView.model_validate(question.model_dump()) for question in questions
            ],
            responses=[SavedResponse(**dict(row)) for row in response_rows],
            submitted_question_ids=submitted_question_ids,
        )

    async def withdraw_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> Assignment:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, status
                    from public.assignments
                    where id = :assignment_id
                    for update
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            existing = result.mappings().one_or_none()
            if existing is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, existing["family_id"])
            if existing["status"] != AssignmentStatus.ASSIGNED:
                raise AssignmentStatusConflict
            updated = await connection.execute(
                text(
                    """
                    update public.assignments
                    set status = 'withdrawn', updated_at = now()
                    where id = :assignment_id
                    returning id, family_id, question_set_id, child_id, status, mode,
                              time_limit_seconds, parent_note
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            return _assignment(updated.mappings().one())

    async def stop_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> Assignment:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, status
                    from public.assignments
                    where id = :assignment_id
                    for update
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            existing = result.mappings().one_or_none()
            if existing is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, existing["family_id"])
            if existing["status"] != AssignmentStatus.IN_PROGRESS:
                raise AssignmentStatusConflict
            updated = await connection.execute(
                text(
                    """
                    update public.assignments
                    set status = 'stopped', updated_at = now()
                    where id = :assignment_id
                    returning id, family_id, question_set_id, child_id, status, mode,
                              time_limit_seconds, parent_note
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            return _assignment(updated.mappings().one())

    async def save_response(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        request: SaveResponseRequest,
    ) -> SavedResponse:
        async with self._engine.begin() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select at.id, at.family_id, at.assignment_id, at.child_id, at.sequence,
                           at.started_at, at.submitted_at, a.status as assignment_status
                    from public.attempts at
                    join public.assignments a on a.id = at.assignment_id
                    where at.id = :attempt_id
                      and at.child_id = :child_id
                    for update
                    """
                ),
                {"attempt_id": _uuid(attempt_id), "child_id": _uuid(child_id)},
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            if attempt_row["submitted_at"] is not None:
                raise SubmittedAttemptImmutable
            if attempt_row["assignment_status"] not in {
                AssignmentStatus.IN_PROGRESS,
                AssignmentStatus.CORRECTING,
            }:
                raise NotFoundError
            submitted_question_result = await connection.execute(
                text(
                    """
                    select 1
                    from public.question_submissions
                    where attempt_id = :attempt_id
                      and question_id = :question_id
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                },
            )
            if submitted_question_result.scalar_one_or_none() is not None:
                raise SubmittedQuestionImmutable
            question_result = await connection.execute(
                text(
                    """
                    select id from public.questions
                    where id = :question_id and family_id = :family_id
                    """
                ),
                {
                    "question_id": _uuid(question_id),
                    "family_id": attempt_row["family_id"],
                },
            )
            if question_result.scalar_one_or_none() is None:
                raise NotFoundError
            current_result = await connection.execute(
                text(
                    """
                    select id, version
                    from public.responses
                    where attempt_id = :attempt_id and question_id = :question_id
                    for update
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                },
            )
            current = current_result.mappings().one_or_none()
            current_version = int(current["version"]) if current is not None else 0
            if request.expected_version != current_version:
                raise ResponseVersionConflict(current_version)
            if current is None:
                response_result = await connection.execute(
                    text(
                        """
                        insert into public.responses (
                          family_id, attempt_id, question_id, kind, answer, version
                        ) values (
                          :family_id, :attempt_id, :question_id, :kind, :answer, 1
                        )
                        returning id, family_id, attempt_id, question_id, kind,
                                  answer, version, saved_at
                        """
                    ),
                    {
                        "family_id": attempt_row["family_id"],
                        "attempt_id": _uuid(attempt_id),
                        "question_id": _uuid(question_id),
                        "kind": request.kind.value,
                        "answer": json.dumps(request.answer),
                    },
                )
            else:
                response_result = await connection.execute(
                    text(
                        """
                        update public.responses
                        set kind = :kind,
                            answer = :answer,
                            version = version + 1,
                            saved_at = now()
                        where id = :response_id
                        returning id, family_id, attempt_id, question_id, kind,
                                  answer, version, saved_at
                        """
                    ),
                    {
                        "response_id": current["id"],
                        "kind": request.kind.value,
                        "answer": json.dumps(request.answer),
                    },
                )
            row = response_result.mappings().one()
        return SavedResponse(**dict(row))

    async def submit_question(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> QuestionSubmissionReceipt:
        async with self._engine.begin() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select at.id, at.family_id, at.assignment_id, at.child_id,
                           at.submitted_at, a.question_set_id,
                           a.status as assignment_status
                    from public.attempts at
                    join public.assignments a on a.id = at.assignment_id
                    where at.id = :attempt_id
                      and at.child_id = :child_id
                    for update of at
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "child_id": _uuid(child_id),
                },
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            if attempt_row["submitted_at"] is not None:
                raise SubmittedAttemptImmutable
            if attempt_row["assignment_status"] not in {
                AssignmentStatus.IN_PROGRESS,
                AssignmentStatus.CORRECTING,
            }:
                raise NotFoundError
            existing_result = await connection.execute(
                text(
                    """
                    select j.id, j.family_id, j.subject_id, j.type, j.status,
                           j.attempt_count, j.created_at, j.completed_at
                    from public.question_submissions qs
                    join public.jobs j on j.id = qs.job_id
                    where qs.attempt_id = :attempt_id
                      and qs.question_id = :question_id
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                },
            )
            existing_job = existing_result.mappings().one_or_none()
            if existing_job is not None:
                return QuestionSubmissionReceipt(
                    attempt_id=_uuid(attempt_id),
                    question_id=_uuid(question_id),
                    job=_job(existing_job),
                )
            response_result = await connection.execute(
                text(
                    """
                    select r.id
                    from public.responses r
                    join public.questions q on q.id = r.question_id
                    where r.attempt_id = :attempt_id
                      and r.question_id = :question_id
                      and q.question_set_id = :question_set_id
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                    "question_set_id": attempt_row["question_set_id"],
                },
            )
            if response_result.scalar_one_or_none() is None:
                raise QuestionAnswerRequired
            job_result = await connection.execute(
                text(
                    """
                    insert into public.jobs (
                      family_id, type, subject_id, payload
                    ) values (
                      :family_id, 'grade_submission', :attempt_id,
                      jsonb_build_object(
                        'scope', 'question',
                        'question_id', cast(:question_id as text),
                        'idempotency_key', cast(:idempotency_key as text)
                      )
                    )
                    returning id, family_id, subject_id, type, status,
                              attempt_count, created_at, completed_at
                    """
                ),
                {
                    "family_id": attempt_row["family_id"],
                    "attempt_id": _uuid(attempt_id),
                    "question_id": question_id,
                    "idempotency_key": idempotency_key,
                },
            )
            job_row = job_result.mappings().one()
            await connection.execute(
                text(
                    """
                    insert into public.question_submissions (
                      family_id, attempt_id, question_id, job_id
                    ) values (
                      :family_id, :attempt_id, :question_id, :job_id
                    )
                    """
                ),
                {
                    "family_id": attempt_row["family_id"],
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                    "job_id": job_row["id"],
                },
            )
        return QuestionSubmissionReceipt(
            attempt_id=_uuid(attempt_id),
            question_id=_uuid(question_id),
            job=_job(job_row),
        )

    async def regrade_question(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> QuestionSubmissionReceipt:
        async with self._engine.begin() as connection:
            answer_result = await connection.execute(
                text(
                    """
                    select at.id, at.family_id
                    from public.attempts at
                    join public.assignments a on a.id = at.assignment_id
                    join public.questions q
                      on q.question_set_id = a.question_set_id
                    join public.responses r
                      on r.attempt_id = at.id and r.question_id = q.id
                    join public.question_results qr
                      on qr.attempt_id = at.id and qr.question_id = q.id
                    where at.id = :attempt_id
                      and at.child_id = :child_id
                      and q.id = :question_id
                    for update of at
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "child_id": _uuid(child_id),
                    "question_id": _uuid(question_id),
                },
            )
            answer_row = answer_result.mappings().one_or_none()
            if answer_row is None:
                raise NotFoundError
            idempotent_result = await connection.execute(
                text(
                    """
                    select id, family_id, subject_id, type, status,
                           attempt_count, created_at, completed_at
                    from public.jobs
                    where type = 'grade_submission'
                      and subject_id = :attempt_id
                      and payload ->> 'question_id' = :question_id
                      and payload ->> 'idempotency_key' = :idempotency_key
                      and payload ->> 'regrade' = 'true'
                    order by created_at desc
                    limit 1
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": question_id,
                    "idempotency_key": idempotency_key,
                },
            )
            idempotent_job = idempotent_result.mappings().one_or_none()
            if idempotent_job is not None:
                return QuestionSubmissionReceipt(
                    attempt_id=_uuid(attempt_id),
                    question_id=_uuid(question_id),
                    job=_job(idempotent_job),
                )
            active_result = await connection.execute(
                text(
                    """
                    select j.id, j.family_id, j.subject_id, j.type, j.status,
                           j.attempt_count, j.created_at, j.completed_at
                    from public.question_submissions qs
                    join public.jobs j on j.id = qs.job_id
                    where qs.attempt_id = :attempt_id
                      and qs.question_id = :question_id
                      and j.status in ('queued', 'running')
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                },
            )
            active_job = active_result.mappings().one_or_none()
            if active_job is not None:
                return QuestionSubmissionReceipt(
                    attempt_id=_uuid(attempt_id),
                    question_id=_uuid(question_id),
                    job=_job(active_job),
                )
            job_result = await connection.execute(
                text(
                    """
                    insert into public.jobs (
                      family_id, type, subject_id, payload
                    ) values (
                      :family_id, 'grade_submission', :attempt_id,
                      jsonb_build_object(
                        'scope', 'question',
                        'question_id', cast(:question_id as text),
                        'idempotency_key', cast(:idempotency_key as text),
                        'regrade', true
                      )
                    )
                    returning id, family_id, subject_id, type, status,
                              attempt_count, created_at, completed_at
                    """
                ),
                {
                    "family_id": answer_row["family_id"],
                    "attempt_id": _uuid(attempt_id),
                    "question_id": question_id,
                    "idempotency_key": idempotency_key,
                },
            )
            job_row = job_result.mappings().one()
            await connection.execute(
                text(
                    """
                    insert into public.question_submissions (
                      family_id, attempt_id, question_id, job_id
                    ) values (
                      :family_id, :attempt_id, :question_id, :job_id
                    )
                    on conflict (attempt_id, question_id) do update
                    set job_id = excluded.job_id,
                        submitted_at = now()
                    """
                ),
                {
                    "family_id": answer_row["family_id"],
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                    "job_id": job_row["id"],
                },
            )
        return QuestionSubmissionReceipt(
            attempt_id=_uuid(attempt_id),
            question_id=_uuid(question_id),
            job=_job(job_row),
        )

    async def get_question_grading_job(
        self,
        attempt_id: str,
        question_id: str,
        job_id: str,
        child_id: str,
    ) -> Job:
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    select j.id, j.family_id, j.subject_id, j.type, j.status,
                           j.attempt_count, j.created_at, j.completed_at
                    from public.jobs j
                    join public.attempts at on at.id = j.subject_id
                    where j.id = :job_id
                      and j.subject_id = :attempt_id
                      and at.child_id = :child_id
                      and j.type = 'grade_submission'
                      and j.payload ->> 'question_id' = :question_id
                    """
                ),
                {
                    "job_id": _uuid(job_id),
                    "attempt_id": _uuid(attempt_id),
                    "child_id": _uuid(child_id),
                    "question_id": question_id,
                },
            )
            row = result.mappings().one_or_none()
        if row is None:
            raise NotFoundError
        return _job(row)

    async def submit_attempt(
        self,
        attempt_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> SubmissionReceipt:
        async with self._engine.begin() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select at.id, at.family_id, at.assignment_id, at.child_id, at.sequence,
                           at.started_at, at.submitted_at, a.status as assignment_status
                    from public.attempts at
                    join public.assignments a on a.id = at.assignment_id
                    where at.id = :attempt_id
                      and at.child_id = :child_id
                    for update
                    """
                ),
                {"attempt_id": _uuid(attempt_id), "child_id": _uuid(child_id)},
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            assignment_result = await connection.execute(
                text(
                    """
                    select id, family_id, question_set_id, child_id, status, mode,
                               time_limit_seconds, parent_note
                    from public.assignments where id = :assignment_id
                    """
                ),
                {"assignment_id": attempt_row["assignment_id"]},
            )
            assignment_row = assignment_result.mappings().one()
            existing_job_result = await connection.execute(
                text(
                    """
                    select id, family_id, subject_id, type, status, attempt_count,
                           created_at, completed_at
                    from public.jobs
                    where type = 'grade_submission'
                      and subject_id = :attempt_id
                      and payload ->> 'idempotency_key' = :idempotency_key
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "idempotency_key": idempotency_key,
                },
            )
            existing_job = existing_job_result.mappings().one_or_none()
            if existing_job is not None:
                return SubmissionReceipt(
                    assignment=_assignment(assignment_row),
                    attempt=_attempt(attempt_row),
                    job=_job(existing_job),
                )
            if attempt_row["submitted_at"] is not None:
                raise SubmittedAttemptImmutable
            if attempt_row["assignment_status"] not in {
                AssignmentStatus.IN_PROGRESS,
                AssignmentStatus.CORRECTING,
            }:
                raise NotFoundError
            submitted_at = datetime.now(UTC)
            await connection.execute(
                text(
                    "update public.attempts set submitted_at = :submitted_at "
                    "where id = :attempt_id"
                ),
                {"submitted_at": submitted_at, "attempt_id": _uuid(attempt_id)},
            )
            await connection.execute(
                text(
                    """
                    update public.assignments
                    set status = 'grading', submitted_at = :submitted_at, updated_at = now()
                    where id = :assignment_id
                    """
                ),
                {
                    "submitted_at": submitted_at,
                    "assignment_id": attempt_row["assignment_id"],
                },
            )
            job_result = await connection.execute(
                text(
                    """
                    insert into public.jobs (
                      family_id, type, subject_id, payload
                    ) values (
                      :family_id, 'grade_submission', :attempt_id,
                          jsonb_build_object(
                            'idempotency_key',
                            cast(:idempotency_key as text)
                          )
                    )
                    returning id, family_id, subject_id, type, status, attempt_count,
                              created_at, completed_at
                    """
                ),
                {
                    "family_id": attempt_row["family_id"],
                    "attempt_id": _uuid(attempt_id),
                    "idempotency_key": idempotency_key,
                },
            )
            job_row = job_result.mappings().one()
        attempt_data = dict(attempt_row)
        attempt_data["submitted_at"] = submitted_at
        assignment_data = dict(assignment_row)
        assignment_data["status"] = AssignmentStatus.GRADING
        return SubmissionReceipt(
            assignment=_assignment(cast(RowMapping, assignment_data)),
            attempt=_attempt(cast(RowMapping, attempt_data)),
            job=_job(job_row),
        )

    async def retry_job(self, job_id: str, parent_id: str) -> Job:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, subject_id, type, status, attempt_count,
                           created_at, completed_at
                    from public.jobs
                    where id = :job_id
                    for update
                    """
                ),
                {"job_id": _uuid(job_id)},
            )
            row = result.mappings().one_or_none()
            if row is None or row["status"] != "failed":
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            result = await connection.execute(
                text(
                    """
                    update public.jobs
                    set status = 'queued',
                        attempt_count = 0,
                        available_at = now(),
                        error_code = null,
                        error_detail = null,
                        completed_at = null,
                        locked_at = null,
                        locked_by = null,
                        updated_at = now()
                    where id = :job_id
                    returning id, family_id, subject_id, type, status,
                              attempt_count, created_at, completed_at
                    """
                ),
                {"job_id": _uuid(job_id)},
            )
            return _job(result.mappings().one())

    async def get_attempt_results(
        self,
        attempt_id: str,
        child_id: str,
    ) -> AttemptResults:
        async with self._engine.connect() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select a.id, a.assignment_id, a.child_id
                    from public.attempts a
                    where a.id = :attempt_id and a.child_id = :child_id
                    """
                ),
                {"attempt_id": _uuid(attempt_id), "child_id": _uuid(child_id)},
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            count_result = await connection.execute(
                text(
                    """
                    select count(*)
                    from public.questions q
                    join public.assignments a on a.question_set_id = q.question_set_id
                    join public.attempts at on at.assignment_id = a.id
                    where a.id = :assignment_id
                      and at.id = :attempt_id
                      and (
                        at.kind <> 'correction'
                        or exists (
                          select 1
                          from public.correction_links cl
                          join public.question_results qr
                            on qr.id = cl.original_result_id
                          where cl.correction_attempt_id = at.id
                            and qr.question_id = q.id
                        )
                      )
                    """
                ),
                {
                    "assignment_id": attempt_row["assignment_id"],
                    "attempt_id": _uuid(attempt_id),
                },
            )
            question_count = int(count_result.scalar_one())
            result_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, attempt_id, question_id, outcome,
                               awarded_points, confidence, feedback, grader_version
                        from public.question_results
                        where attempt_id = :attempt_id
                        order by created_at
                        """
                    ),
                    {"attempt_id": _uuid(attempt_id)},
                )
            ).mappings().all()
        results = [_result(row) for row in result_rows]
        return AttemptResults(
            attempt_id=_uuid(attempt_id),
            complete=question_count > 0 and len(results) == question_count,
            results=results,
        )

    async def get_parent_attempt_review(
        self,
        attempt_id: str,
        parent_id: str,
    ) -> ParentAttemptReview:
        attempt_uuid = _uuid(attempt_id)
        async with self._engine.connect() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select at.family_id, at.assignment_id, c.nickname,
                           qs.title
                    from public.attempts at
                    join public.assignments a on a.id = at.assignment_id
                    join public.children c on c.id = at.child_id
                    join public.question_sets qs on qs.id = a.question_set_id
                    where at.id = :attempt_id
                    """
                ),
                {"attempt_id": attempt_uuid},
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            await self._require_parent(
                connection,
                parent_id,
                attempt_row["family_id"],
            )
            result_rows = (
                await connection.execute(
                    text(
                        """
                        select q.id as question_id, q.position,
                               q.type as question_type, q.prompt,
                               q.points as question_points,
                               qr.id as result_id, qr.outcome,
                               qr.awarded_points, qr.feedback,
                               qr.parent_outcome, qr.parent_awarded_points,
                               r.kind as response_kind, r.answer as response_answer
                        from public.questions q
                        join public.assignments a
                          on a.question_set_id = q.question_set_id
                        join public.attempts at on at.assignment_id = a.id
                        left join public.question_results qr
                          on qr.attempt_id = at.id and qr.question_id = q.id
                        left join public.responses r
                          on r.attempt_id = at.id and r.question_id = q.id
                        where at.id = :attempt_id
                          and (
                            at.kind <> 'correction'
                            or exists (
                              select 1
                              from public.correction_links cl
                              join public.question_results original
                                on original.id = cl.original_result_id
                              where cl.correction_attempt_id = at.id
                                and original.question_id = q.id
                            )
                          )
                        order by q.position
                        """
                    ),
                    {"attempt_id": attempt_uuid},
                )
            ).mappings().all()
            requested_photo_paths: list[str] = []
            for row in result_rows:
                if row["response_kind"] != "photo":
                    continue
                answer = row["response_answer"]
                if not isinstance(answer, dict):
                    continue
                raw_paths = answer.get("paths")
                if not isinstance(raw_paths, list):
                    continue
                requested_photo_paths.extend(
                    path for path in raw_paths if isinstance(path, str)
                )
            valid_photo_paths: set[str] = set()
            if requested_photo_paths:
                asset_rows = (
                    await connection.execute(
                        text(
                            """
                            select object_path
                            from public.assets
                            where family_id = :family_id
                              and bucket_id = 'responses'
                              and object_path = any(
                                cast(:object_paths as text[])
                              )
                            """
                        ),
                        {
                            "family_id": attempt_row["family_id"],
                            "object_paths": requested_photo_paths,
                        },
                    )
                ).scalars()
                valid_photo_paths = set(asset_rows)

        signed_photo_urls = await self._sign_response_photo_urls(
            sorted(valid_photo_paths)
        )
        reviews: list[ParentReviewItem] = []
        awarded_points = 0.0
        correct_count = 0
        correction_count = 0
        graded_count = 0
        for row in result_rows:
            if row["result_id"] is None:
                continue
            graded_count += 1
            final_outcome = row["parent_outcome"] or row["outcome"]
            final_points = (
                row["parent_awarded_points"]
                if row["parent_outcome"] is not None
                else row["awarded_points"]
            )
            awarded_points += _float(final_points) or 0
            correct_count += final_outcome == "correct"
            correction_count += final_outcome == "incorrect"
            if (
                row["parent_outcome"] is None
                and row["outcome"] in {"uncertain", "needs_parent_review"}
                and row["response_kind"] is not None
            ):
                reviews.append(
                    ParentReviewItem(
                        result_id=row["result_id"],
                        question_id=row["question_id"],
                        question_position=row["position"],
                        question_prompt=_localized_text(row["prompt"]),
                        question_type=row["question_type"],
                        question_points=float(row["question_points"]),
                        response_kind=row["response_kind"],
                        response_answer=cast(
                            dict[str, Any],
                            row["response_answer"],
                        ),
                        photo_urls=[
                            signed_photo_urls[path]
                            for path in cast(
                                dict[str, Any],
                                row["response_answer"],
                            ).get("paths", [])
                            if (
                                isinstance(path, str)
                                and path in signed_photo_urls
                            )
                        ]
                        if row["response_kind"] == "photo"
                        else [],
                        automated_outcome=row["outcome"],
                        automated_feedback=cast(
                            dict[str, Any],
                            row["feedback"],
                        ),
                    )
                )
        return ParentAttemptReview(
            attempt_id=attempt_uuid,
            child_nickname=attempt_row["nickname"],
            title=attempt_row["title"],
            complete=bool(result_rows) and graded_count == len(result_rows),
            awarded_points=awarded_points,
            available_points=sum(
                float(row["question_points"]) for row in result_rows
            ),
            correct_count=correct_count,
            correction_count=correction_count,
            pending_review_count=len(reviews),
            reviews=reviews,
        )

    async def create_correction(
        self,
        attempt_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> AssignmentWork:
        client_key = f"correction:{attempt_id}:{idempotency_key}"
        async with self._engine.begin() as connection:
            original_result = await connection.execute(
                text(
                    """
                    select id, family_id, assignment_id, child_id
                    from public.attempts
                    where id = :attempt_id
                      and child_id = :child_id
                      and submitted_at is not null
                    for update
                    """
                ),
                {"attempt_id": _uuid(attempt_id), "child_id": _uuid(child_id)},
            )
            original = original_result.mappings().one_or_none()
            if original is None:
                raise NotFoundError
            relevant_rows = (
                await connection.execute(
                    text(
                        """
                        select id, question_id
                        from public.question_results
                        where attempt_id = :attempt_id
                          and coalesce(parent_outcome, outcome)
                            in ('incorrect', 'uncertain', 'needs_parent_review')
                        order by created_at
                        """
                    ),
                    {"attempt_id": _uuid(attempt_id)},
                )
            ).mappings().all()
            if not relevant_rows:
                raise NotFoundError
            existing_result = await connection.execute(
                text(
                    """
                    select id, family_id, assignment_id, child_id, sequence,
                           started_at, submitted_at
                    from public.attempts
                    where family_id = :family_id
                      and client_idempotency_key = :client_key
                    """
                ),
                {
                    "family_id": original["family_id"],
                    "client_key": client_key,
                },
            )
            correction_row = existing_result.mappings().one_or_none()
            if correction_row is None:
                sequence_result = await connection.execute(
                    text(
                        """
                        select coalesce(max(sequence), 0) + 1
                        from public.attempts
                        where assignment_id = :assignment_id
                        """
                    ),
                    {"assignment_id": original["assignment_id"]},
                )
                correction_result = await connection.execute(
                    text(
                        """
                        insert into public.attempts (
                          family_id, assignment_id, child_id, kind, sequence,
                          client_idempotency_key
                        ) values (
                          :family_id, :assignment_id, :child_id, 'correction',
                          :sequence, :client_key
                        )
                        returning id, family_id, assignment_id, child_id, sequence,
                                  started_at, submitted_at
                        """
                    ),
                    {
                        "family_id": original["family_id"],
                        "assignment_id": original["assignment_id"],
                        "child_id": _uuid(child_id),
                        "sequence": int(sequence_result.scalar_one()),
                        "client_key": client_key,
                    },
                )
                correction_row = correction_result.mappings().one()
                for relevant in relevant_rows:
                    await connection.execute(
                        text(
                            """
                            insert into public.correction_links (
                              original_result_id, correction_attempt_id
                            ) values (:result_id, :correction_attempt_id)
                            on conflict do nothing
                            """
                        ),
                        {
                            "result_id": relevant["id"],
                            "correction_attempt_id": correction_row["id"],
                        },
                    )
            assignment_result = await connection.execute(
                text(
                    """
                    with updated as (
                      update public.assignments
                      set status = 'correcting', updated_at = now()
                      where id = :assignment_id
                      returning id, family_id, question_set_id, child_id, status,
                                mode, time_limit_seconds
                    )
                    select updated.*, qs.title
                    from updated
                    join public.question_sets qs on qs.id = updated.question_set_id
                    """
                ),
                {"assignment_id": original["assignment_id"]},
            )
            assignment_row = assignment_result.mappings().one()
            question_rows = (
                await connection.execute(
                    text(
                        """
                        select q.id, q.family_id, q.question_set_id, q.position,
                               q.type, q.prompt, q.options, q.answer_key, q.points
                        from public.correction_links cl
                        join public.question_results qr
                          on qr.id = cl.original_result_id
                        join public.questions q on q.id = qr.question_id
                        where cl.correction_attempt_id = :correction_attempt_id
                        order by q.position
                        """
                    ),
                    {"correction_attempt_id": correction_row["id"]},
                )
            ).mappings().all()
            response_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, attempt_id, question_id, kind,
                               answer, version, saved_at
                        from public.responses
                        where attempt_id = :attempt_id
                        order by saved_at
                        """
                    ),
                    {"attempt_id": correction_row["id"]},
                )
            ).mappings().all()
        questions = [_question(row) for row in question_rows]
        return AssignmentWork(
            title=str(assignment_row["title"]),
            assignment=_assignment(assignment_row),
            attempt=_attempt(correction_row),
            questions=[
                QuestionView.model_validate(question.model_dump())
                for question in questions
            ],
            responses=[SavedResponse(**dict(row)) for row in response_rows],
        )

    async def create_question_retry(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> AssignmentWork:
        client_key = f"question-retry:{attempt_id}:{question_id}:{idempotency_key}"
        async with self._engine.begin() as connection:
            original_result = await connection.execute(
                text(
                    """
                    select at.id, at.family_id, at.assignment_id, at.child_id,
                           qr.id as result_id
                    from public.attempts at
                    join public.question_results qr
                      on qr.attempt_id = at.id
                     and qr.question_id = :question_id
                    where at.id = :attempt_id
                      and at.child_id = :child_id
                    for update of at
                    """
                ),
                {
                    "attempt_id": _uuid(attempt_id),
                    "question_id": _uuid(question_id),
                    "child_id": _uuid(child_id),
                },
            )
            original = original_result.mappings().one_or_none()
            if original is None:
                raise NotFoundError
            existing_result = await connection.execute(
                text(
                    """
                    select id, family_id, assignment_id, child_id, sequence,
                           started_at, submitted_at
                    from public.attempts
                    where family_id = :family_id
                      and client_idempotency_key = :client_key
                    """
                ),
                {
                    "family_id": original["family_id"],
                    "client_key": client_key,
                },
            )
            retry_row = existing_result.mappings().one_or_none()
            if retry_row is None:
                sequence_result = await connection.execute(
                    text(
                        """
                        select coalesce(max(sequence), 0) + 1
                        from public.attempts
                        where assignment_id = :assignment_id
                        """
                    ),
                    {"assignment_id": original["assignment_id"]},
                )
                retry_result = await connection.execute(
                    text(
                        """
                        insert into public.attempts (
                          family_id, assignment_id, child_id, kind, sequence,
                          client_idempotency_key
                        ) values (
                          :family_id, :assignment_id, :child_id, 'correction',
                          :sequence, :client_key
                        )
                        returning id, family_id, assignment_id, child_id,
                                  sequence, started_at, submitted_at
                        """
                    ),
                    {
                        "family_id": original["family_id"],
                        "assignment_id": original["assignment_id"],
                        "child_id": _uuid(child_id),
                        "sequence": int(sequence_result.scalar_one()),
                        "client_key": client_key,
                    },
                )
                retry_row = retry_result.mappings().one()
                await connection.execute(
                    text(
                        """
                        insert into public.correction_links (
                          original_result_id, correction_attempt_id
                        ) values (:result_id, :correction_attempt_id)
                        on conflict do nothing
                        """
                    ),
                    {
                        "result_id": original["result_id"],
                        "correction_attempt_id": retry_row["id"],
                    },
                )
            assignment_result = await connection.execute(
                text(
                    """
                    with updated as (
                      update public.assignments
                      set status = 'correcting', updated_at = now()
                      where id = :assignment_id
                      returning id, family_id, question_set_id, child_id,
                                status, mode, time_limit_seconds
                    )
                    select updated.*, qs.title
                    from updated
                    join public.question_sets qs
                      on qs.id = updated.question_set_id
                    """
                ),
                {"assignment_id": original["assignment_id"]},
            )
            assignment_row = assignment_result.mappings().one()
            question_result = await connection.execute(
                text(
                    """
                    select q.id, q.family_id, q.question_set_id, q.position,
                           q.type, q.prompt, q.options, q.answer_key, q.points
                    from public.questions q
                    where q.id = :question_id
                    """
                ),
                {"question_id": _uuid(question_id)},
            )
            question_row = question_result.mappings().one_or_none()
            if question_row is None:
                raise NotFoundError
            response_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, attempt_id, question_id, kind,
                               answer, version, saved_at
                        from public.responses
                        where attempt_id = :attempt_id
                        order by saved_at
                        """
                    ),
                    {"attempt_id": retry_row["id"]},
                )
            ).mappings().all()
        question = _question(question_row)
        return AssignmentWork(
            title=str(assignment_row["title"]),
            assignment=_assignment(assignment_row),
            attempt=_attempt(retry_row),
            questions=[QuestionView.model_validate(question.model_dump())],
            responses=[SavedResponse(**dict(row)) for row in response_rows],
        )

    async def get_attempt_work(
        self,
        attempt_id: str,
        child_id: str,
    ) -> AssignmentWork:
        async with self._engine.connect() as connection:
            attempt_result = await connection.execute(
                text(
                    """
                    select id, family_id, assignment_id, child_id, sequence,
                           started_at, submitted_at, kind
                    from public.attempts
                    where id = :attempt_id
                      and child_id = :child_id
                      and submitted_at is null
                    """
                ),
                {"attempt_id": _uuid(attempt_id), "child_id": _uuid(child_id)},
            )
            attempt_row = attempt_result.mappings().one_or_none()
            if attempt_row is None:
                raise NotFoundError
            assignment_row = (
                await connection.execute(
                    text(
                        """
                        select a.id, a.family_id, a.question_set_id, a.child_id,
                               a.status, a.mode, a.time_limit_seconds, a.parent_note,
                               qs.title
                        from public.assignments a
                        join public.question_sets qs on qs.id = a.question_set_id
                        where a.id = :assignment_id
                          and a.status in ('in_progress', 'correcting')
                        """
                    ),
                    {"assignment_id": attempt_row["assignment_id"]},
                )
            ).mappings().one()
            question_rows = (
                await connection.execute(
                    text(
                        """
                        select q.id, q.family_id, q.question_set_id, q.position,
                               q.type, q.prompt, q.options, q.answer_key, q.points
                        from public.questions q
                        where q.question_set_id = :question_set_id
                          and (
                            :attempt_kind <> 'correction'
                            or exists (
                              select 1
                              from public.correction_links cl
                              join public.question_results qr
                                on qr.id = cl.original_result_id
                              where cl.correction_attempt_id = :attempt_id
                                and qr.question_id = q.id
                            )
                          )
                        order by q.position
                        """
                    ),
                    {
                        "question_set_id": assignment_row["question_set_id"],
                        "attempt_kind": attempt_row["kind"],
                        "attempt_id": _uuid(attempt_id),
                    },
                )
            ).mappings().all()
            response_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, attempt_id, question_id, kind,
                               answer, version, saved_at
                        from public.responses
                        where attempt_id = :attempt_id
                        order by saved_at
                        """
                    ),
                    {"attempt_id": _uuid(attempt_id)},
                )
            ).mappings().all()
            submitted_question_ids = list(
                (
                    await connection.execute(
                        text(
                            """
                            select question_id
                            from public.question_submissions
                            where attempt_id = :attempt_id
                            order by submitted_at
                            """
                        ),
                        {"attempt_id": _uuid(attempt_id)},
                    )
                ).scalars()
            )
        questions = [_question(row) for row in question_rows]
        return AssignmentWork(
            title=str(assignment_row["title"]),
            assignment=_assignment(assignment_row),
            attempt=_attempt(attempt_row),
            questions=[
                QuestionView.model_validate(question.model_dump())
                for question in questions
            ],
            responses=[SavedResponse(**dict(row)) for row in response_rows],
            submitted_question_ids=submitted_question_ids,
        )

    async def list_child_assignments(
        self,
        child_id: str,
    ) -> list[ChildAssignmentSummary]:
        async with self._engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        """
                        select
                          a.id,
                          qs.title,
                          a.status,
                          a.mode,
                          a.time_limit_seconds,
                          a.parent_note,
                          count(distinct q.id)::integer as question_count,
                          latest_attempt.id as latest_attempt_id
                        from public.assignments a
                        join public.question_sets qs on qs.id = a.question_set_id
                        left join public.questions q
                          on q.question_set_id = a.question_set_id
                        left join lateral (
                          select at.id
                          from public.attempts at
                          where at.assignment_id = a.id
                            and at.child_id = a.child_id
                          order by at.sequence desc
                          limit 1
                        ) latest_attempt on true
                        where a.child_id = :child_id
                          and a.status not in ('completed', 'withdrawn', 'stopped')
                        group by
                          a.id,
                          qs.title,
                          a.status,
                          a.mode,
                          a.time_limit_seconds,
                          a.parent_note,
                          latest_attempt.id,
                          a.assigned_at
                        order by
                          case a.status
                            when 'in_progress' then 0
                            when 'assigned' then 1
                            when 'correcting' then 2
                            when 'results_ready' then 3
                            when 'grading' then 4
                            else 5
                          end,
                          a.assigned_at desc
                        """
                    ),
                    {"child_id": _uuid(child_id)},
                )
            ).mappings().all()
        return [ChildAssignmentSummary(**dict(row)) for row in rows]

    async def get_printable_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> PrintableAssignment:
        async with self._engine.connect() as connection:
            assignment_result = await connection.execute(
                text(
                    """
                    select
                      a.id,
                      a.family_id,
                      a.question_set_id,
                      a.child_id,
                      a.status,
                      a.mode,
                      a.time_limit_seconds,
                      qs.title
                    from public.assignments a
                    join public.question_sets qs on qs.id = a.question_set_id
                    where a.id = :assignment_id
                    """
                ),
                {"assignment_id": _uuid(assignment_id)},
            )
            assignment_row = assignment_result.mappings().one_or_none()
            if assignment_row is None:
                raise NotFoundError
            await self._require_parent(
                connection,
                parent_id,
                assignment_row["family_id"],
            )
            question_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, question_set_id, position, type,
                               prompt, options, answer_key, points
                        from public.questions
                        where question_set_id = :question_set_id
                        order by position
                        """
                    ),
                    {"question_set_id": assignment_row["question_set_id"]},
                )
            ).mappings().all()
        return PrintableAssignment(
            assignment=_assignment(assignment_row),
            title=assignment_row["title"],
            questions=[
                QuestionView.model_validate(_question(row).model_dump())
                for row in question_rows
            ],
        )

    async def list_due_reviews(self, child_id: str) -> list[ReviewItemView]:
        async with self._engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        """
                        select r.id, r.child_id, r.source_question_id, q.prompt,
                               r.due_on, r.interval_days, r.level
                        from public.review_items r
                        join public.questions q on q.id = r.source_question_id
                        where r.child_id = :child_id
                          and r.due_on <= current_date
                          and r.completed_at is null
                        order by r.due_on, r.created_at
                        limit 10
                        """
                    ),
                    {"child_id": _uuid(child_id)},
                )
            ).mappings().all()
        return [
            ReviewItemView(
                id=row["id"],
                child_id=row["child_id"],
                source_question_id=row["source_question_id"],
                prompt=_localized_text(row["prompt"]),
                due_on=row["due_on"],
                interval_days=row["interval_days"],
                level=row["level"],
            )
            for row in rows
        ]

    async def skip_today_reviews(self, child_id: str) -> list[ReviewCompletion]:
        async with self._engine.begin() as connection:
            rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, interval_days
                        from public.review_items
                        where child_id = :child_id
                          and due_on <= current_date
                          and completed_at is null
                        order by due_on, created_at
                        for update
                        """
                    ),
                    {"child_id": _uuid(child_id)},
                )
            ).mappings().all()
            if not rows:
                return []

            completions: list[ReviewCompletion] = []
            for row in rows:
                due_result = await connection.execute(
                    text(
                        """
                        update public.review_items
                        set due_on = current_date + 1,
                            skipped_on = current_date,
                            updated_at = now()
                        where id = :item_id
                        returning due_on
                        """
                    ),
                    {"item_id": row["id"]},
                )
                next_due = due_result.scalar_one()
                interval_days = int(row["interval_days"])
                await connection.execute(
                    text(
                        """
                        insert into public.review_events (
                          family_id, review_item_id, result,
                          old_interval_days, new_interval_days
                        ) values (
                          :family_id, :item_id, null,
                          :interval_days, :interval_days
                        )
                        """
                    ),
                    {
                        "family_id": row["family_id"],
                        "item_id": row["id"],
                        "interval_days": interval_days,
                    },
                )
                completions.append(
                    ReviewCompletion(
                        item_id=row["id"],
                        old_interval_days=interval_days,
                        new_interval_days=interval_days,
                        next_due_on=next_due,
                    )
                )
        return completions

    async def _history_rows(
        self,
        connection: AsyncConnection,
        *,
        child_id: UUID | None = None,
        family_id: UUID | None = None,
    ) -> list[RowMapping]:
        rows = (
            await connection.execute(
                text(
                    """
                    select
                      a.id as assignment_id,
                      latest_attempt.id as attempt_id,
                      a.child_id,
                      c.nickname as child_nickname,
                      qs.title,
                      a.status,
                      latest_attempt.submitted_at,
                      coalesce(sum(qr.awarded_points), 0) as awarded_points,
                      (
                        select coalesce(sum(q.points), 0)
                        from public.questions q
                        where q.question_set_id = a.question_set_id
                      ) as available_points,
                      count(qr.id) filter (
                        where coalesce(qr.parent_outcome, qr.outcome) <> 'correct'
                      ) as correction_count
                    from public.assignments a
                    join public.children c on c.id = a.child_id
                    join public.question_sets qs on qs.id = a.question_set_id
                    left join lateral (
                      select at.id, at.submitted_at
                      from public.attempts at
                      where at.assignment_id = a.id
                      order by at.sequence desc
                      limit 1
                    ) latest_attempt on true
                    left join public.question_results qr
                      on qr.attempt_id = latest_attempt.id
                    where (
                      cast(:child_id as uuid) is null
                      or a.child_id = cast(:child_id as uuid)
                    )
                      and (
                        cast(:family_id as uuid) is null
                        or a.family_id = cast(:family_id as uuid)
                      )
                    group by
                      a.id, latest_attempt.id, latest_attempt.submitted_at,
                      c.nickname, qs.title
                    order by coalesce(latest_attempt.submitted_at, a.assigned_at) desc
                    limit 100
                    """
                ),
                {"child_id": child_id, "family_id": family_id},
            )
        ).mappings().all()
        return list(rows)

    async def list_child_history(self, child_id: str) -> list[HistoryItem]:
        async with self._engine.connect() as connection:
            rows = await self._history_rows(
                connection,
                child_id=_uuid(child_id),
            )
        return [_history_item(row) for row in rows]

    async def list_family_history(
        self,
        family_id: str,
        parent_id: str,
    ) -> list[HistoryItem]:
        family_uuid = _uuid(family_id)
        async with self._engine.connect() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            rows = await self._history_rows(
                connection,
                family_id=family_uuid,
            )
        return [_history_item(row) for row in rows]

    async def create_deletion_request(
        self,
        request: CreateDeletionRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> DeletionRequestView:
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, request.family_id)
            existing_id = await self._idempotent_resource(
                connection,
                family_id=request.family_id,
                actor_id=parent_id,
                action="deletion_request",
                idempotency_key=idempotency_key,
            )
            if existing_id is not None:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, target_type, target_id, requested_at,
                               purge_after, restored_at
                        from public.deletion_requests where id = :id
                        """
                    ),
                    {"id": existing_id},
                )
                return DeletionRequestView(**dict(result.mappings().one()))
            if request.target_type == "family":
                if request.target_id != request.family_id:
                    raise NotFoundError
                target_result = await connection.execute(
                    text(
                        """
                        update public.families
                        set deleted_at = now(), purge_after = now() + interval '30 days'
                        where id = :target_id and deleted_at is null
                        returning id
                        """
                    ),
                    {"target_id": request.target_id},
                )
            elif request.target_type == "child":
                target_result = await connection.execute(
                    text(
                        """
                        update public.children
                        set deleted_at = now(), updated_at = now()
                        where id = :target_id
                          and family_id = :family_id
                          and deleted_at is null
                        returning id
                        """
                    ),
                    {
                        "target_id": request.target_id,
                        "family_id": request.family_id,
                    },
                )
            else:
                target_result = await connection.execute(
                    text(
                        """
                        update public.assets
                        set deleted_at = now()
                        where id = :target_id
                          and family_id = :family_id
                          and deleted_at is null
                        returning id
                        """
                    ),
                    {
                        "target_id": request.target_id,
                        "family_id": request.family_id,
                    },
                )
            if target_result.scalar_one_or_none() is None:
                raise NotFoundError
            result = await connection.execute(
                text(
                    """
                    insert into public.deletion_requests (
                      family_id, requested_by, target_type, target_id
                    ) values (
                      :family_id, :parent_id, :target_type, :target_id
                    )
                    returning id, family_id, target_type, target_id, requested_at,
                              purge_after, restored_at
                    """
                ),
                {
                    "family_id": request.family_id,
                    "parent_id": _uuid(parent_id),
                    "target_type": request.target_type,
                    "target_id": request.target_id,
                },
            )
            deletion = DeletionRequestView(**dict(result.mappings().one()))
            await connection.execute(
                text(
                    """
                    insert into public.jobs (
                      family_id, type, subject_id, available_at
                    ) values (
                      :family_id, 'purge_deleted_data', :deletion_id, :purge_after
                    )
                    """
                ),
                {
                    "family_id": request.family_id,
                    "deletion_id": deletion.id,
                    "purge_after": deletion.purge_after,
                },
            )
            await self._remember_idempotency(
                connection,
                family_id=request.family_id,
                actor_id=parent_id,
                action="deletion_request",
                idempotency_key=idempotency_key,
                resource_id=deletion.id,
            )
            return deletion

    async def restore_deletion_request(
        self,
        deletion_id: str,
        parent_id: str,
    ) -> DeletionRequestView:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, target_type, target_id, requested_at,
                           purge_after, restored_at
                    from public.deletion_requests
                    where id = :id
                      and restored_at is null
                      and purged_at is null
                      and purge_after > now()
                    for update
                    """
                ),
                {"id": _uuid(deletion_id)},
            )
            row = result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            if row["target_type"] == "family":
                await connection.execute(
                    text(
                        """
                        update public.families
                        set deleted_at = null, purge_after = null
                        where id = :target_id
                        """
                    ),
                    {"target_id": row["target_id"]},
                )
            elif row["target_type"] == "child":
                await connection.execute(
                    text(
                        """
                        update public.children
                        set deleted_at = null, updated_at = now()
                        where id = :target_id
                        """
                    ),
                    {"target_id": row["target_id"]},
                )
            else:
                await connection.execute(
                    text(
                        "update public.assets set deleted_at = null where id = :target_id"
                    ),
                    {"target_id": row["target_id"]},
                )
            result = await connection.execute(
                text(
                    """
                    update public.deletion_requests
                    set restored_at = now()
                    where id = :id
                    returning id, family_id, target_type, target_id, requested_at,
                              purge_after, restored_at
                    """
                ),
                {"id": _uuid(deletion_id)},
            )
            return DeletionRequestView(**dict(result.mappings().one()))

    async def complete_review(
        self,
        item_id: str,
        child_id: str,
        request: CompleteReviewRequest,
    ) -> ReviewCompletion:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, interval_days
                    from public.review_items
                    where id = :item_id
                      and child_id = :child_id
                      and completed_at is null
                    for update
                    """
                ),
                {"item_id": _uuid(item_id), "child_id": _uuid(child_id)},
            )
            row = result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            old_interval = int(row["interval_days"])
            intervals = [1, 3, 7, 14, 30]
            if request.outcome == "incorrect":
                new_interval = 1
            else:
                current_index = intervals.index(old_interval)
                new_interval = intervals[min(current_index + 1, len(intervals) - 1)]
            due_result = await connection.execute(
                text(
                    """
                    update public.review_items
                    set due_on = current_date + cast(:new_interval as integer),
                        interval_days = cast(:new_interval as integer),
                        failure_count = failure_count + case
                          when cast(:outcome as text) = 'incorrect'
                          then 1 else 0 end,
                        consecutive_standard_successes =
                          case when cast(:outcome as text) = 'correct'
                            then consecutive_standard_successes + 1 else 0 end,
                        updated_at = now()
                    where id = :item_id
                    returning due_on
                    """
                ),
                {
                    "new_interval": new_interval,
                    "outcome": request.outcome,
                    "item_id": _uuid(item_id),
                },
            )
            next_due = due_result.scalar_one()
            await connection.execute(
                text(
                    """
                    insert into public.review_events (
                      family_id, review_item_id, result,
                      old_interval_days, new_interval_days
                    ) values (
                      :family_id, :item_id, :outcome,
                      :old_interval, :new_interval
                    )
                    """
                ),
                {
                    "family_id": row["family_id"],
                    "item_id": _uuid(item_id),
                    "outcome": request.outcome,
                    "old_interval": old_interval,
                    "new_interval": new_interval,
                },
            )
        return ReviewCompletion(
            item_id=_uuid(item_id),
            old_interval_days=old_interval,
            new_interval_days=new_interval,
            next_due_on=next_due,
        )

    async def create_import(
        self,
        request: CreateImportRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> QuestionSetImport:
        family_id = request.family_id
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, family_id)
            existing_id = await self._idempotent_resource(
                connection,
                family_id=family_id,
                actor_id=parent_id,
                action="create_import",
                idempotency_key=idempotency_key,
            )
            if existing_id is not None:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, question_set_id, filenames,
                               source_paths, answer_filenames,
                               answer_source_paths, reference_filenames,
                               reference_source_paths, purpose, status, created_at
                        from public.question_set_imports where id = :id
                        """
                    ),
                    {"id": existing_id},
                )
                return QuestionSetImport(**dict(result.mappings().one()))
            question_set_result = await connection.execute(
                text(
                    """
                    insert into public.question_sets (
                      family_id, created_by, title, subject, status, source_mode
                    ) values (
                      :family_id, :parent_id, :title, :subject, 'processing', :source_mode
                    )
                    returning id, family_id, title, subject, status
                    """
                ),
                {
                    "family_id": family_id,
                    "parent_id": _uuid(parent_id),
                    "title": request.title,
                    "subject": request.subject,
                    "source_mode": (
                        "convert"
                        if request.purpose.value == "use_as_questions"
                        else "similar"
                    ),
                },
            )
            question_set_row = question_set_result.mappings().one()
            import_result = await connection.execute(
                text(
                    """
                    insert into public.question_set_imports (
                      family_id, question_set_id, created_by, filenames,
                      source_paths, answer_filenames, answer_source_paths,
                      reference_filenames, reference_source_paths, purpose,
                      status
                    ) values (
                      :family_id, :question_set_id, :parent_id, :filenames,
                      :source_paths, :answer_filenames, :answer_source_paths,
                      :reference_filenames, :reference_source_paths, :purpose,
                      'processing'
                    )
                    returning id, family_id, question_set_id, filenames,
                              source_paths, answer_filenames,
                              answer_source_paths, reference_filenames,
                              reference_source_paths, purpose, status, created_at
                    """
                ),
                {
                    "family_id": family_id,
                    "question_set_id": question_set_row["id"],
                    "parent_id": _uuid(parent_id),
                    "filenames": json.dumps(request.filenames),
                    "source_paths": json.dumps(request.source_paths),
                    "answer_filenames": json.dumps(request.answer_filenames),
                    "answer_source_paths": json.dumps(
                        request.answer_source_paths
                    ),
                    "reference_filenames": json.dumps(
                        request.reference_filenames
                    ),
                    "reference_source_paths": json.dumps(
                        request.reference_source_paths
                    ),
                    "purpose": request.purpose.value,
                },
            )
            imported = QuestionSetImport(**dict(import_result.mappings().one()))
            await connection.execute(
                text(
                    """
                    insert into public.jobs (
                      family_id, type, subject_id, payload
                    ) values (
                      :family_id, 'extract_source', :import_id,
                      jsonb_build_object('schema_version', '1.0')
                    )
                    """
                ),
                {"family_id": family_id, "import_id": imported.id},
            )
            await self._remember_idempotency(
                connection,
                family_id=family_id,
                actor_id=parent_id,
                action="create_import",
                idempotency_key=idempotency_key,
                resource_id=imported.id,
            )
            return imported

    async def create_completed_worksheet_import(
        self,
        request: CreateCompletedWorksheetRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> CompletedWorksheetImport:
        """Queue paper analysis; task records are created only after review."""
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, request.family_id)
            child_exists = await connection.scalar(
                text(
                    """
                    select 1
                    from public.children
                    where id = :child_id
                      and family_id = :family_id
                      and deleted_at is null
                    """
                ),
                {"child_id": request.child_id, "family_id": request.family_id},
            )
            if child_exists is None:
                raise NotFoundError

            existing_id = await self._idempotent_resource(
                connection,
                family_id=request.family_id,
                actor_id=parent_id,
                action="create_completed_worksheet_import",
                idempotency_key=idempotency_key,
            )
            if existing_id is not None:
                existing = (
                    await connection.execute(
                        text(
                            """
                            select id, family_id, child_id, title, subject,
                                   document_language, feedback_language, filenames,
                                   response_paths, answer_source_paths,
                                   reference_source_paths, extraction, status, assignment_id,
                                   attempt_id, created_at
                            from public.completed_worksheet_imports
                            where id = :id
                            """
                        ),
                        {"id": existing_id},
                    )
                ).mappings().one()
                existing_job = (
                    await connection.execute(
                        text(
                            """
                            select id, family_id, subject_id, type, status, payload,
                                   attempt_count, created_at, completed_at
                            from public.jobs
                            where subject_id = :subject_id
                              and type = 'analyze_completed_worksheet'
                            order by created_at desc
                            limit 1
                            """
                        ),
                        {"subject_id": existing_id},
                    )
                ).mappings().one()
                return CompletedWorksheetImport(
                    **dict(existing),
                    job=Job(**dict(existing_job)),
                )

            created = (
                await connection.execute(
                    text(
                        """
                        insert into public.completed_worksheet_imports (
                          family_id, child_id, created_by, title, subject,
                          document_language, feedback_language, filenames,
                          response_paths, answer_source_paths,
                          reference_source_paths
                        ) values (
                          :family_id, :child_id, :parent_id, :title, :subject,
                          :document_language, :feedback_language, cast(:filenames as jsonb),
                          cast(:response_paths as jsonb),
                          cast(:answer_source_paths as jsonb),
                          cast(:reference_source_paths as jsonb)
                        )
                        returning id, family_id, child_id, title, subject,
                                  document_language, feedback_language, filenames,
                                  response_paths, answer_source_paths,
                                  reference_source_paths, extraction, status, assignment_id,
                                  attempt_id, created_at
                        """
                    ),
                    {
                        "family_id": request.family_id,
                        "child_id": request.child_id,
                        "parent_id": _uuid(parent_id),
                        "title": request.title,
                        "subject": request.subject,
                        "document_language": request.document_language,
                        "feedback_language": request.feedback_language,
                        "filenames": json.dumps(request.filenames),
                        "response_paths": json.dumps(request.response_paths),
                        "answer_source_paths": json.dumps(request.answer_source_paths),
                        "reference_source_paths": json.dumps(
                            request.reference_source_paths
                        ),
                    },
                )
            ).mappings().one()
            job_row = (
                await connection.execute(
                    text(
                        """
                        insert into public.jobs (family_id, type, subject_id, payload)
                        values (
                          :family_id, 'analyze_completed_worksheet', :subject_id,
                          jsonb_build_object('schema_version', '1.0')
                        )
                        returning id, family_id, subject_id, type, status, payload,
                                  attempt_count, created_at, completed_at
                        """
                    ),
                    {"family_id": request.family_id, "subject_id": created["id"]},
                )
            ).mappings().one()
            await self._remember_idempotency(
                connection,
                family_id=request.family_id,
                actor_id=parent_id,
                action="create_completed_worksheet_import",
                idempotency_key=idempotency_key,
                resource_id=created["id"],
            )
            return CompletedWorksheetImport(
                **dict(created),
                job=Job(**dict(job_row)),
            )

    async def get_completed_worksheet_import(
        self,
        worksheet_id: str,
        parent_id: str,
    ) -> CompletedWorksheetImport:
        async with self._engine.connect() as connection:
            imported = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, child_id, title, subject,
                               document_language, feedback_language, filenames,
                               response_paths, answer_source_paths,
                               reference_source_paths, extraction, status, assignment_id,
                               attempt_id, created_at
                        from public.completed_worksheet_imports
                        where id = :id
                        """
                    ),
                    {"id": _uuid(worksheet_id)},
                )
            ).mappings().one_or_none()
            if imported is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, imported["family_id"])
            job = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, subject_id, type, status, payload,
                               attempt_count, created_at, completed_at
                        from public.jobs
                        where subject_id = :subject_id
                          and type = 'analyze_completed_worksheet'
                        order by created_at desc
                        limit 1
                        """
                    ),
                    {"subject_id": imported["id"]},
                )
            ).mappings().one_or_none()
            if job is None:
                raise NotFoundError
            return CompletedWorksheetImport(
                **dict(imported),
                job=Job(**dict(job)),
            )

    async def confirm_completed_worksheet_import(
        self,
        worksheet_id: str,
        *,
        document: ImportDocument,
        responses: list[CompletedWorksheetResponseInput],
        idempotency_key: str,
        parent_id: str,
    ) -> CompletedWorksheetConfirmation:
        """Persist a reviewed scan as one submitted, non-editable attempt."""
        worksheet_uuid = _uuid(worksheet_id)
        imported = await self.get_completed_worksheet_import(worksheet_id, parent_id)
        if imported.status == CompletedWorksheetStatus.NEEDS_REVIEW:
            import_result = await self.import_structured_question_set(
                document,
                family_id=imported.family_id,
                child_id=imported.child_id,
                source_name=f"completed-worksheet:{worksheet_id}",
                parent_id=parent_id,
                assign=False,
            )
            question_set_id = import_result.question_set_id
        else:
            question_set_id = None

        async with self._engine.begin() as connection:
            imported_row = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, child_id, status, assignment_id, attempt_id
                        from public.completed_worksheet_imports
                        where id = :id
                        for update
                        """
                    ),
                    {"id": worksheet_uuid},
                )
            ).mappings().one_or_none()
            if imported_row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, imported_row["family_id"])

            if imported_row["attempt_id"] is not None:
                assignment_row = (
                    await connection.execute(
                        text(
                            """
                            select id, family_id, question_set_id, child_id, status, mode,
                                   time_limit_seconds
                            from public.assignments where id = :id
                            """
                        ),
                        {"id": imported_row["assignment_id"]},
                    )
                ).mappings().one()
                attempt_row = (
                    await connection.execute(
                        text(
                            """
                            select id, family_id, assignment_id, child_id, sequence,
                                   started_at, submitted_at
                            from public.attempts where id = :id
                            """
                        ),
                        {"id": imported_row["attempt_id"]},
                    )
                ).mappings().one()
                job_row = (
                    await connection.execute(
                        text(
                            """
                            select id, family_id, subject_id, type, status, payload,
                                   attempt_count, created_at, completed_at
                            from public.jobs
                            where type = 'grade_submission' and subject_id = :attempt_id
                            order by created_at desc limit 1
                            """
                        ),
                        {"attempt_id": imported_row["attempt_id"]},
                    )
                ).mappings().one_or_none()
                if job_row is None:
                    raise NotFoundError
                return CompletedWorksheetConfirmation(
                    completed_worksheet=await self.get_completed_worksheet_import(
                        worksheet_id, parent_id
                    ),
                    question_set_id=assignment_row["question_set_id"],
                    assignment=_assignment(assignment_row),
                    attempt=_attempt(attempt_row),
                    grading_job=_job(job_row),
                )

            if (
                imported_row["status"] != CompletedWorksheetStatus.NEEDS_REVIEW
                or question_set_id is None
            ):
                raise NotFoundError

            assignment_row = (
                await connection.execute(
                    text(
                        """
                        insert into public.assignments (
                          family_id, question_set_id, child_id, assigned_by, mode
                        ) values (
                          :family_id, :question_set_id, :child_id, :parent_id, 'practice'
                        )
                        returning id, family_id, question_set_id, child_id, status, mode,
                                  time_limit_seconds
                        """
                    ),
                    {
                        "family_id": imported_row["family_id"],
                        "question_set_id": question_set_id,
                        "child_id": imported_row["child_id"],
                        "parent_id": _uuid(parent_id),
                    },
                )
            ).mappings().one()
            attempt_row = (
                await connection.execute(
                    text(
                        """
                        insert into public.attempts (
                          family_id, assignment_id, child_id, sequence,
                          client_idempotency_key
                        ) values (
                          :family_id, :assignment_id, :child_id, 1, :client_key
                        )
                        returning id, family_id, assignment_id, child_id, sequence,
                                  started_at, submitted_at
                        """
                    ),
                    {
                        "family_id": imported_row["family_id"],
                        "assignment_id": assignment_row["id"],
                        "child_id": imported_row["child_id"],
                        "client_key": f"completed-worksheet:{worksheet_id}",
                    },
                )
            ).mappings().one()
            question_rows = (
                await connection.execute(
                    text(
                        """
                        select id, position
                        from public.questions
                        where question_set_id = :question_set_id
                        order by position
                        """
                    ),
                    {"question_set_id": question_set_id},
                )
            ).mappings().all()
            if len(question_rows) != len(responses):
                raise NotFoundError
            for question_row, response in zip(question_rows, responses, strict=True):
                if question_row["position"] != response.question_position:
                    raise NotFoundError
                await connection.execute(
                    text(
                        """
                        insert into public.responses (
                          family_id, attempt_id, question_id, kind, answer, version
                        ) values (
                          :family_id, :attempt_id, :question_id, :kind,
                          cast(:answer as jsonb), 1
                        )
                        """
                    ),
                    {
                        "family_id": imported_row["family_id"],
                        "attempt_id": attempt_row["id"],
                        "question_id": question_row["id"],
                        "kind": response.kind.value,
                        "answer": json.dumps(
                            {
                                **response.answer,
                                "source_paths": imported.response_paths,
                            }
                        ),
                    },
                )
            submitted_at = datetime.now(UTC)
            await connection.execute(
                text(
                    """
                    update public.attempts set submitted_at = :submitted_at
                    where id = :attempt_id
                    """
                ),
                {"submitted_at": submitted_at, "attempt_id": attempt_row["id"]},
            )
            assignment_data: dict[str, Any] = dict(assignment_row)
            assignment_data["status"] = AssignmentStatus.GRADING
            await connection.execute(
                text(
                    """
                    update public.assignments
                    set status = 'grading', submitted_at = :submitted_at, updated_at = now()
                    where id = :assignment_id
                    """
                ),
                {"submitted_at": submitted_at, "assignment_id": assignment_data["id"]},
            )
            job_row = (
                await connection.execute(
                    text(
                        """
                        insert into public.jobs (family_id, type, subject_id, payload)
                        values (
                          :family_id, 'grade_submission', :attempt_id,
                          jsonb_build_object(
                            'source', 'completed_worksheet',
                            'completed_worksheet_id', cast(:worksheet_id as text),
                            'idempotency_key', cast(:idempotency_key as text)
                          )
                        )
                        returning id, family_id, subject_id, type, status, payload,
                                  attempt_count, created_at, completed_at
                        """
                    ),
                    {
                        "family_id": imported_row["family_id"],
                        "attempt_id": attempt_row["id"],
                        "worksheet_id": worksheet_id,
                        "idempotency_key": idempotency_key,
                    },
                )
            ).mappings().one()
            await connection.execute(
                text(
                    """
                    update public.completed_worksheet_imports
                    set status = 'grading', question_set_id = :question_set_id,
                        assignment_id = :assignment_id, attempt_id = :attempt_id,
                        updated_at = now()
                    where id = :id
                    """
                ),
                {
                    "id": worksheet_uuid,
                    "question_set_id": question_set_id,
                    "assignment_id": assignment_data["id"],
                    "attempt_id": attempt_row["id"],
                },
            )

        completed = await self.get_completed_worksheet_import(worksheet_id, parent_id)
        attempt_data = dict(attempt_row)
        attempt_data["submitted_at"] = submitted_at
        return CompletedWorksheetConfirmation(
            completed_worksheet=completed,
            question_set_id=question_set_id,
            assignment=_assignment(cast(RowMapping, assignment_data)),
            attempt=_attempt(cast(RowMapping, attempt_data)),
            grading_job=_job(job_row),
        )

    async def get_question_set_draft(
        self,
        question_set_id: str,
        parent_id: str,
    ) -> QuestionSetDraft:
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, title, subject, status, source_summary
                    from public.question_sets
                    where id = :question_set_id and deleted_at is null
                    """
                ),
                {"question_set_id": _uuid(question_set_id)},
            )
            row = result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            question_rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, question_set_id, position, type, prompt,
                               options, answer_key, points
                        from public.questions
                        where question_set_id = :question_set_id
                        order by position
                        """
                    ),
                    {"question_set_id": _uuid(question_set_id)},
                )
            ).mappings().all()
        return QuestionSetDraft(
            question_set=_question_set(row),
            questions=[_question(question) for question in question_rows],
        )

    async def list_family_question_sets(
        self,
        family_id: str,
        parent_id: str,
    ) -> list[FamilyLibraryQuestionSet]:
        async with self._engine.connect() as connection:
            await self._require_parent(connection, parent_id, _uuid(family_id))
            rows = (
                await connection.execute(
                    text(
                        """
                        select qs.id, qs.family_id, qs.title, qs.subject,
                               qs.status, qs.source_summary,
                               count(q.id)::integer as question_count
                        from public.question_sets qs
                        left join public.questions q
                          on q.question_set_id = qs.id
                        where qs.family_id = :family_id
                          and qs.deleted_at is null
                        group by qs.id
                        order by qs.created_at desc
                        """
                    ),
                    {"family_id": _uuid(family_id)},
                )
            ).mappings().all()
        return [
            FamilyLibraryQuestionSet(**dict(row))
            for row in rows
        ]

    async def confirm_question_set(
        self,
        question_set_id: str,
        idempotency_key: str,
        parent_id: str,
    ) -> QuestionSet:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, title, subject, status
                    from public.question_sets
                    where id = :question_set_id and deleted_at is null
                    for update
                    """
                ),
                {"question_set_id": _uuid(question_set_id)},
            )
            row = result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            if row["status"] not in {"needs_review", "confirmed"}:
                raise NotFoundError
            existing_id = await self._idempotent_resource(
                connection,
                family_id=row["family_id"],
                actor_id=parent_id,
                action="confirm_question_set",
                idempotency_key=idempotency_key,
            )
            if existing_id is None:
                result = await connection.execute(
                    text(
                        """
                        update public.question_sets
                        set status = 'confirmed', confirmed_at = now(), updated_at = now()
                        where id = :question_set_id
                        returning id, family_id, title, subject, status
                        """
                    ),
                    {"question_set_id": _uuid(question_set_id)},
                )
                row = result.mappings().one()
                await self._remember_idempotency(
                    connection,
                    family_id=row["family_id"],
                    actor_id=parent_id,
                    action="confirm_question_set",
                    idempotency_key=idempotency_key,
                    resource_id=row["id"],
                )
            return _question_set(row)

    async def assign_question_set(
        self,
        question_set_id: str,
        request: CreateAssignmentRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> Assignment:
        async with self._engine.begin() as connection:
            set_result = await connection.execute(
                text(
                    """
                    select id, family_id, status
                    from public.question_sets
                    where id = :question_set_id and deleted_at is null
                    """
                ),
                {"question_set_id": _uuid(question_set_id)},
            )
            question_set = set_result.mappings().one_or_none()
            if question_set is None or question_set["status"] != "confirmed":
                raise NotFoundError
            family_id = cast(UUID, question_set["family_id"])
            await self._require_parent(connection, parent_id, family_id)
            child_result = await connection.execute(
                text(
                    """
                    select id from public.children
                    where id = :child_id and family_id = :family_id and deleted_at is null
                    """
                ),
                {"child_id": request.child_id, "family_id": family_id},
            )
            if child_result.scalar_one_or_none() is None:
                raise NotFoundError
            existing_id = await self._idempotent_resource(
                connection,
                family_id=family_id,
                actor_id=parent_id,
                action="assign_question_set",
                idempotency_key=idempotency_key,
            )
            if existing_id is not None:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, question_set_id, child_id, status, mode,
                               time_limit_seconds, parent_note
                        from public.assignments where id = :id
                        """
                    ),
                    {"id": existing_id},
                )
                return _assignment(result.mappings().one())
            result = await connection.execute(
                text(
                    """
                    insert into public.assignments (
                      family_id, question_set_id, child_id, assigned_by, mode,
                      time_limit_seconds, parent_note
                    ) values (
                      :family_id, :question_set_id, :child_id, :parent_id, :mode,
                      :time_limit_seconds, :parent_note
                    )
                    returning id, family_id, question_set_id, child_id, status, mode,
                              time_limit_seconds, parent_note
                    """
                ),
                {
                    "family_id": family_id,
                    "question_set_id": _uuid(question_set_id),
                    "child_id": request.child_id,
                    "parent_id": _uuid(parent_id),
                    "mode": request.mode,
                    "time_limit_seconds": request.time_limit_seconds,
                    "parent_note": request.parent_note,
                },
            )
            row = result.mappings().one()
            await self._remember_idempotency(
                connection,
                family_id=family_id,
                actor_id=parent_id,
                action="assign_question_set",
                idempotency_key=idempotency_key,
                resource_id=row["id"],
            )
            return _assignment(row)

    async def create_upload_intent(
        self,
        request: CreateUploadIntentRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> UploadIntent:
        async with self._engine.connect() as connection:
            await self._require_parent(connection, parent_id, request.family_id)
        return await self._sign_upload_intent(
            request,
            idempotency_key,
            owner_user_id=_uuid(parent_id),
        )

    async def create_child_upload_intent(
        self,
        request: CreateUploadIntentRequest,
        child_id: str,
        idempotency_key: str,
    ) -> UploadIntent:
        if request.bucket.value != "responses":
            raise NotFoundError
        async with self._engine.connect() as connection:
            result = await connection.execute(
                text(
                    """
                    select 1
                    from public.attempts
                    where id = :attempt_id
                      and child_id = :child_id
                      and family_id = :family_id
                      and submitted_at is null
                    """
                ),
                {
                    "attempt_id": request.object_id,
                    "child_id": _uuid(child_id),
                    "family_id": request.family_id,
                },
            )
            if result.scalar_one_or_none() is None:
                raise NotFoundError
        return await self._sign_upload_intent(
            request,
            idempotency_key,
            owner_user_id=None,
        )

    async def _sign_upload_intent(
        self,
        request: CreateUploadIntentRequest,
        idempotency_key: str,
        owner_user_id: UUID | None,
    ) -> UploadIntent:
        if not self._service_role_key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for signed uploads.")
        safe_name = Path(request.filename).name.replace(" ", "-").lower()
        stable_prefix = hashlib.sha256(idempotency_key.encode()).hexdigest()[:12]
        unique_name = f"{stable_prefix}-{safe_name}"
        object_path = f"{request.family_id}/{request.object_id}/{unique_name}"
        endpoint = (
            f"{self._supabase_url}/storage/v1/object/upload/sign/"
            f"{request.bucket.value}/{quote(object_path, safe='/')}"
        )
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {self._service_role_key}",
                    "apikey": self._service_role_key,
                    "Content-Type": "application/json",
                },
                json={"upsert": False},
            )
            response.raise_for_status()
            payload = cast(dict[str, Any], response.json())
        signed_url = str(payload.get("url", ""))
        if signed_url.startswith("/"):
            signed_url = f"{self._supabase_url}/storage/v1{signed_url}"
        if not signed_url:
            raise RuntimeError("Supabase did not return a signed upload URL.")
        async with self._engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    insert into public.assets (
                      family_id, owner_user_id, bucket_id, object_path,
                      media_type, metadata
                    ) values (
                      :family_id, :owner_user_id, :bucket_id, :object_path,
                      :media_type, cast(:metadata as jsonb)
                    )
                    on conflict (bucket_id, object_path) do nothing
                    """
                ),
                {
                    "family_id": request.family_id,
                    "owner_user_id": owner_user_id,
                    "bucket_id": request.bucket.value,
                    "object_path": object_path,
                    "media_type": request.content_type,
                    "metadata": json.dumps({"upload_status": "issued"}),
                },
            )
        return UploadIntent(
            bucket=request.bucket,
            path=object_path,
            upload_url=signed_url,
            expires_in=7200,
        )

    async def create_library_submission(
        self,
        request: CreateLibrarySubmissionRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> LibrarySubmission:
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, request.family_id)
            existing_id = await self._idempotent_resource(
                connection,
                family_id=request.family_id,
                actor_id=parent_id,
                action="library_submission",
                idempotency_key=idempotency_key,
            )
            if existing_id is None:
                set_result = await connection.execute(
                    text(
                        """
                        select id from public.question_sets
                        where id = :question_set_id and family_id = :family_id
                        """
                    ),
                    {
                        "question_set_id": request.question_set_id,
                        "family_id": request.family_id,
                    },
                )
                if set_result.scalar_one_or_none() is None:
                    raise NotFoundError
                result = await connection.execute(
                    text(
                        """
                        insert into public.library_submissions (
                          family_id, question_set_id, submitted_by,
                          rights_confirmed_at, privacy_confirmed_at
                        ) values (
                          :family_id, :question_set_id, :parent_id, now(), now()
                        )
                        returning id, family_id, question_set_id, created_at
                        """
                    ),
                    {
                        "family_id": request.family_id,
                        "question_set_id": request.question_set_id,
                        "parent_id": _uuid(parent_id),
                    },
                )
                row = result.mappings().one()
                existing_id = cast(UUID, row["id"])
                await self._remember_idempotency(
                    connection,
                    family_id=request.family_id,
                    actor_id=parent_id,
                    action="library_submission",
                    idempotency_key=idempotency_key,
                    resource_id=existing_id,
                )
            else:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, question_set_id, created_at
                        from public.library_submissions where id = :id
                        """
                    ),
                    {"id": existing_id},
                )
                row = result.mappings().one()
        return LibrarySubmission(
            id=row["id"],
            family_id=row["family_id"],
            question_set_id=row["question_set_id"],
            created_at=row["created_at"],
        )

    async def decide_grading_result(
        self,
        result_id: str,
        request: ParentDecisionRequest,
        parent_id: str,
    ) -> ParentDecision:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id, attempt_id, question_id, outcome,
                           awarded_points, confidence, feedback, grader_version,
                           parent_outcome, parent_awarded_points, parent_comment,
                           parent_reviewed_at
                    from public.question_results
                    where id = :result_id
                    for update
                    """
                ),
                {"result_id": _uuid(result_id)},
            )
            row = result.mappings().one_or_none()
            if row is None:
                raise NotFoundError
            await self._require_parent(connection, parent_id, row["family_id"])
            if row["parent_outcome"] is None:
                result = await connection.execute(
                    text(
                        """
                        update public.question_results
                        set parent_outcome = :outcome,
                            parent_awarded_points = :awarded_points,
                            parent_comment = :comment,
                            parent_reviewed_by = :parent_id,
                            parent_reviewed_at = now()
                        where id = :result_id
                        returning id, family_id, attempt_id, question_id, outcome,
                                  awarded_points, confidence, feedback, grader_version,
                                  parent_outcome, parent_awarded_points, parent_comment,
                                  parent_reviewed_at
                        """
                    ),
                    {
                        "result_id": _uuid(result_id),
                        "outcome": request.outcome,
                        "awarded_points": request.awarded_points,
                        "comment": request.comment,
                        "parent_id": _uuid(parent_id),
                    },
                )
                row = result.mappings().one()
            if row["parent_outcome"] == "incorrect":
                review_source = (
                    await connection.execute(
                        text(
                            """
                            select q.primary_knowledge_tag_id, at.child_id
                            from public.questions q
                            join public.attempts at on at.id = :attempt_id
                            where q.id = :question_id
                            """
                        ),
                        {
                            "attempt_id": row["attempt_id"],
                            "question_id": row["question_id"],
                        },
                    )
                ).mappings().one()
                if review_source["primary_knowledge_tag_id"] is not None:
                    await connection.execute(
                        text(
                            """
                            insert into public.review_items (
                              family_id, child_id, knowledge_tag_id,
                              source_question_id, due_on, interval_days, level
                            ) values (
                              :family_id, :child_id, :knowledge_tag_id,
                              :question_id, current_date + 1, 1, 'standard'
                            )
                            on conflict (child_id, source_question_id)
                              where completed_at is null
                            do update set
                              due_on = current_date + 1,
                              interval_days = 1,
                              failure_count = public.review_items.failure_count + 1,
                              updated_at = now()
                            """
                        ),
                        {
                            "family_id": row["family_id"],
                            "child_id": review_source["child_id"],
                            "knowledge_tag_id": review_source[
                                "primary_knowledge_tag_id"
                            ],
                            "question_id": row["question_id"],
                        },
                    )
        return ParentDecision(
            result=_result(row),
            parent_outcome=row["parent_outcome"],
            parent_awarded_points=_float(row["parent_awarded_points"]),
            parent_comment=row["parent_comment"],
            reviewed_at=row["parent_reviewed_at"],
        )

    async def create_family_invitation(
        self,
        family_id: str,
        request: CreateFamilyInvitationRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> FamilyInvitation:
        family_uuid = _uuid(family_id)
        async with self._engine.begin() as connection:
            await self._require_parent(connection, parent_id, family_uuid)
            existing_id = await self._idempotent_resource(
                connection,
                family_id=family_uuid,
                actor_id=parent_id,
                action="family_invitation",
                idempotency_key=idempotency_key,
            )
            if existing_id is None:
                count_result = await connection.execute(
                    text(
                        """
                        select
                          (select count(*) from public.family_members
                           where family_id = :family_id and status = 'active')
                          +
                          (select count(*) from public.family_invitations
                           where family_id = :family_id
                             and accepted_at is null
                             and revoked_at is null
                             and expires_at > now())
                        """
                    ),
                    {"family_id": family_uuid},
                )
                if int(count_result.scalar_one()) >= 4:
                    raise FamilyParentLimitReached
                token_hash = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
                result = await connection.execute(
                    text(
                        """
                        insert into public.family_invitations (
                          family_id, email, invited_by, token_hash
                        ) values (
                          :family_id, :email, :parent_id, :token_hash
                        )
                        returning id, family_id, email, invited_by, expires_at,
                                  accepted_at, revoked_at
                        """
                    ),
                    {
                        "family_id": family_uuid,
                        "email": request.email.strip().lower(),
                        "parent_id": _uuid(parent_id),
                        "token_hash": token_hash,
                    },
                )
                row = result.mappings().one()
                existing_id = cast(UUID, row["id"])
                await self._remember_idempotency(
                    connection,
                    family_id=family_uuid,
                    actor_id=parent_id,
                    action="family_invitation",
                    idempotency_key=idempotency_key,
                    resource_id=existing_id,
                )
            else:
                result = await connection.execute(
                    text(
                        """
                        select id, family_id, email, invited_by, expires_at,
                               accepted_at, revoked_at
                        from public.family_invitations where id = :id
                        """
                    ),
                    {"id": existing_id},
                )
                row = result.mappings().one()
        return FamilyInvitation(
            id=row["id"],
            family_id=row["family_id"],
            email=row["email"],
            invited_by=str(row["invited_by"]),
            expires_at=row["expires_at"],
            accepted_at=row["accepted_at"],
            revoked_at=row["revoked_at"],
        )

    async def list_pending_invitations(
        self,
        email: str,
    ) -> list[FamilyInvitation]:
        async with self._engine.connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        """
                        select id, family_id, email, invited_by, expires_at,
                               accepted_at, revoked_at
                        from public.family_invitations
                        where email = :email
                          and accepted_at is null
                          and revoked_at is null
                          and expires_at > now()
                        order by created_at
                        """
                    ),
                    {"email": email.strip().lower()},
                )
            ).mappings().all()
        return [
            FamilyInvitation(
                id=row["id"],
                family_id=row["family_id"],
                email=row["email"],
                invited_by=str(row["invited_by"]),
                expires_at=row["expires_at"],
                accepted_at=row["accepted_at"],
                revoked_at=row["revoked_at"],
            )
            for row in rows
        ]

    async def accept_family_invitation(
        self,
        invitation_id: str,
        email: str,
        parent_id: str,
    ) -> Family:
        async with self._engine.begin() as connection:
            result = await connection.execute(
                text(
                    """
                    select id, family_id
                    from public.family_invitations
                    where id = :invitation_id
                      and email = :email
                      and accepted_at is null
                      and revoked_at is null
                      and expires_at > now()
                    for update
                    """
                ),
                {
                    "invitation_id": _uuid(invitation_id),
                    "email": email.strip().lower(),
                },
            )
            invitation = result.mappings().one_or_none()
            if invitation is None:
                raise NotFoundError
            await connection.execute(
                text(
                    """
                    insert into public.family_members (family_id, user_id, status)
                    values (:family_id, :parent_id, 'active')
                    on conflict (family_id, user_id) do update
                    set status = 'active', removed_at = null
                    """
                ),
                {
                    "family_id": invitation["family_id"],
                    "parent_id": _uuid(parent_id),
                },
            )
            await connection.execute(
                text(
                    """
                    update public.family_invitations
                    set accepted_by = :parent_id, accepted_at = now()
                    where id = :invitation_id
                    """
                ),
                {
                    "parent_id": _uuid(parent_id),
                    "invitation_id": _uuid(invitation_id),
                },
            )
            family_result = await connection.execute(
                text(
                    "select id, name from public.families where id = :family_id"
                ),
                {"family_id": invitation["family_id"]},
            )
            return Family(**dict(family_result.mappings().one()))
