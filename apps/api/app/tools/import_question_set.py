import argparse
import asyncio
import hashlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.domain.models import QuestionType


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuestionSetInput(StrictModel):
    title: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1)
    locale: Literal["zh", "ja", "en"]
    difficulty: Literal["reinforcement", "standard", "challenge", "adaptive"]
    source_mode: Literal["manual", "generate", "convert", "similar"]
    instructions: str | None = None
    estimated_minutes: int = Field(gt=0)
    source_summary: dict[str, Any] = Field(default_factory=dict)


class KnowledgeTagInput(StrictModel):
    code: str = Field(min_length=1)
    label: str = Field(min_length=1)


class QuestionInput(StrictModel):
    position: int = Field(gt=0)
    type: QuestionType
    prompt: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)
    answer_key: dict[str, Any]
    rubric: dict[str, Any] = Field(default_factory=dict)
    points: Decimal = Field(gt=0)
    knowledge_code: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_answer_key(self) -> "QuestionInput":
        if self.type == QuestionType.SINGLE_CHOICE:
            choice = self.answer_key.get("choice")
            if (
                not isinstance(choice, int)
                or isinstance(choice, bool)
                or choice < 0
                or choice >= len(self.options)
            ):
                raise ValueError("Single-choice answer must index an option.")
        if self.type == QuestionType.WORD_ORDER:
            tokens = self.answer_key.get("tokens")
            if not isinstance(tokens, list) or Counter(tokens) != Counter(self.options):
                raise ValueError(
                    "Word-order options and answer must use the same token inventory."
                )
        if self.type == QuestionType.TYPED_TEXT:
            text_answer = self.answer_key.get("text")
            text_answers = self.answer_key.get("texts")
            has_single = isinstance(text_answer, str) and bool(text_answer.strip())
            has_multiple = (
                isinstance(text_answers, list)
                and bool(text_answers)
                and all(
                    isinstance(answer, str) and bool(answer.strip())
                    for answer in text_answers
                )
            )
            if not has_single and not has_multiple:
                raise ValueError("Typed-text questions need at least one accepted answer.")
        if self.type == QuestionType.HANDWRITING:
            reference = self.answer_key.get("reference")
            if (
                self.rubric.get("grading_mode") != "parent_review"
                or not isinstance(reference, str)
                or not reference.strip()
            ):
                raise ValueError(
                    "Handwriting questions need parent_review and a reference answer."
                )
        return self


class ImportDocument(StrictModel):
    schema_version: Literal["1.0"]
    question_set: QuestionSetInput
    knowledge_tags: list[KnowledgeTagInput] = Field(min_length=1)
    questions: list[QuestionInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_positions(self) -> "ImportDocument":
        positions = [question.position for question in self.questions]
        expected = list(range(1, len(self.questions) + 1))
        if positions != expected:
            raise ValueError("Question positions must be contiguous and ordered from 1.")
        return self

    @model_validator(mode="after")
    def validate_knowledge_codes(self) -> "ImportDocument":
        codes = [tag.code for tag in self.knowledge_tags]
        known_codes = set(codes)
        if len(known_codes) != len(codes):
            raise ValueError("Knowledge tag codes must be unique.")
        for question in self.questions:
            if question.knowledge_code not in known_codes:
                raise ValueError(
                    f"Question {question.position} uses unknown knowledge code "
                    f"{question.knowledge_code!r}."
                )
        return self

    @property
    def question_count(self) -> int:
        return len(self.questions)

    @property
    def total_points(self) -> Decimal:
        return sum((question.points for question in self.questions), Decimal())


class ImportResult(StrictModel):
    question_set_id: UUID
    assignment_id: UUID | None
    family_id: UUID
    family_name: str
    child_id: UUID
    child_nickname: str
    question_count: int
    total_points: Decimal
    status: Literal["needs_review", "confirmed"]
    reused_existing: bool
    checksum: str


def parse_import_document(payload: str | bytes) -> ImportDocument:
    return ImportDocument.model_validate_json(payload)


def document_checksum(document: ImportDocument) -> str:
    canonical = json.dumps(
        document.model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(canonical).hexdigest()


def document_summary(
    document: ImportDocument,
    *,
    source_name: str,
) -> dict[str, Any]:
    return {
        "title": document.question_set.title,
        "subject": document.question_set.subject,
        "locale": document.question_set.locale,
        "question_count": document.question_count,
        "total_points": float(document.total_points),
        "estimated_minutes": document.question_set.estimated_minutes,
        "knowledge_tag_count": len(document.knowledge_tags),
        "answer_keys_present": all(bool(question.answer_key) for question in document.questions),
        "source_name": source_name,
        "checksum": document_checksum(document),
    }


async def import_question_set(
    document: ImportDocument,
    *,
    database_url: str,
    family_id: UUID,
    child_id: UUID,
    source_name: str,
    confirm: bool,
    assign: bool,
    parent_id: UUID | None = None,
    assignment_mode: Literal["practice", "exam"] = "practice",
    time_limit_seconds: int | None = None,
) -> ImportResult:
    if assign and not confirm:
        raise ValueError("A question set must be confirmed before it can be assigned.")

    checksum = document_checksum(document)
    engine = create_async_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"server_settings": {"role": "learning_api"}},
    )
    try:
        async with engine.begin() as connection:
            target_result = await connection.execute(
                text(
                    """
                    select
                      f.id as family_id,
                      f.name as family_name,
                      c.id as child_id,
                      c.nickname as child_nickname,
                      (
                        select fm.user_id
                        from public.family_members fm
                        where fm.family_id = f.id
                          and fm.status = 'active'
                          and (
                            cast(:parent_id as uuid) is null
                            or fm.user_id = cast(:parent_id as uuid)
                          )
                        order by (fm.user_id = f.created_by) desc, fm.joined_at
                        limit 1
                      ) as parent_id
                    from public.families f
                    join public.children c
                      on c.family_id = f.id
                     and c.deleted_at is null
                    where f.id = :family_id
                      and f.deleted_at is null
                      and c.id = :child_id
                      and (
                        cast(:parent_id as uuid) is null
                        or exists (
                          select 1
                          from public.family_members authorized_parent
                          where authorized_parent.family_id = f.id
                            and authorized_parent.user_id = cast(:parent_id as uuid)
                            and authorized_parent.status = 'active'
                        )
                      )
                    for share of f, c
                    """
                ),
                {
                    "family_id": family_id,
                    "child_id": child_id,
                    "parent_id": parent_id,
                },
            )
            target = target_result.mappings().one_or_none()
            if target is None:
                raise ValueError("The requested active family and child were not found.")
            parent_id = target["parent_id"]
            if parent_id is None:
                raise ValueError("The family does not have an active parent.")

            existing_result = await connection.execute(
                text(
                    """
                    select
                      qs.id as question_set_id,
                      qs.status,
                      (
                        select a.id
                        from public.assignments a
                        where a.question_set_id = qs.id
                          and a.child_id = :child_id
                        order by a.created_at desc
                        limit 1
                      ) as assignment_id,
                      (
                        select count(*)
                        from public.questions q
                        where q.question_set_id = qs.id
                      ) as question_count
                    from public.question_sets qs
                    where qs.family_id = :family_id
                      and qs.deleted_at is null
                      and qs.source_summary ->> 'import_checksum' = :checksum
                    order by qs.created_at
                    limit 1
                    for update
                    """
                ),
                {
                    "child_id": child_id,
                    "family_id": family_id,
                    "checksum": checksum,
                },
            )
            existing = existing_result.mappings().one_or_none()
            if existing is not None:
                existing_status = cast(
                    Literal["needs_review", "confirmed"],
                    str(existing["status"]),
                )
                if confirm and existing_status != "confirmed":
                    await connection.execute(
                        text(
                            """
                            update public.question_sets
                            set status = 'confirmed',
                                confirmed_at = coalesce(confirmed_at, now()),
                                updated_at = now()
                            where id = :question_set_id
                            """
                        ),
                        {"question_set_id": existing["question_set_id"]},
                    )
                    existing_status = "confirmed"
                existing_assignment_id = existing["assignment_id"]
                if assign and existing_assignment_id is None:
                    existing_assignment_id = await connection.scalar(
                        text(
                            """
                            insert into public.assignments (
                              family_id, question_set_id, child_id, assigned_by, mode,
                              time_limit_seconds
                            ) values (
                              :family_id, :question_set_id, :child_id, :parent_id, :mode,
                              :time_limit_seconds
                            )
                            returning id
                            """
                        ),
                        {
                            "family_id": family_id,
                            "question_set_id": existing["question_set_id"],
                            "child_id": child_id,
                            "parent_id": parent_id,
                            "mode": assignment_mode,
                            "time_limit_seconds": time_limit_seconds,
                        },
                    )
                return ImportResult(
                    question_set_id=existing["question_set_id"],
                    assignment_id=existing_assignment_id,
                    family_id=target["family_id"],
                    family_name=target["family_name"],
                    child_id=target["child_id"],
                    child_nickname=target["child_nickname"],
                    question_count=int(existing["question_count"]),
                    total_points=document.total_points,
                    status=existing_status,
                    reused_existing=True,
                    checksum=checksum,
                )

            knowledge_tag_ids: dict[str, UUID] = {}
            for tag in document.knowledge_tags:
                tag_id = await connection.scalar(
                    text(
                        """
                        insert into public.knowledge_tags (
                          family_id, subject, code, label
                        ) values (
                          :family_id, :subject, :code, cast(:label as jsonb)
                        )
                        on conflict (family_id, code) do update
                        set subject = excluded.subject,
                            label = excluded.label
                        returning id
                        """
                    ),
                    {
                        "family_id": family_id,
                        "subject": document.question_set.subject,
                        "code": tag.code,
                        "label": json.dumps(
                            {document.question_set.locale: tag.label},
                            ensure_ascii=False,
                        ),
                    },
                )
                if tag_id is None:
                    raise RuntimeError(f"Could not save knowledge tag {tag.code!r}.")
                knowledge_tag_ids[tag.code] = tag_id

            source_summary = dict(document.question_set.source_summary)
            source_summary.update(
                {
                    "schema_version": document.schema_version,
                    "import_checksum": checksum,
                    "imported_via": (
                        "parent_json_upload"
                        if parent_id is not None
                        else "ai_json_cli"
                    ),
                    "original_json_filename": source_name,
                    "question_count": document.question_count,
                    "total_points": float(document.total_points),
                    "estimated_minutes": document.question_set.estimated_minutes,
                    "answer_keys_present": True,
                }
            )
            new_status: Literal["needs_review", "confirmed"] = (
                "confirmed" if confirm else "needs_review"
            )
            question_set_id = await connection.scalar(
                text(
                    """
                    insert into public.question_sets (
                      family_id, created_by, title, subject, status, difficulty,
                      source_mode, instructions, locale, source_summary, confirmed_at
                    ) values (
                      :family_id, :parent_id, :title, :subject, :status, :difficulty,
                      :source_mode, :instructions, :locale, cast(:source_summary as jsonb),
                      :confirmed_at
                    )
                    returning id
                    """
                ),
                {
                    "family_id": family_id,
                    "parent_id": parent_id,
                    "title": document.question_set.title,
                    "subject": document.question_set.subject,
                    "status": new_status,
                    "difficulty": document.question_set.difficulty,
                    "source_mode": document.question_set.source_mode,
                    "instructions": document.question_set.instructions,
                    "locale": document.question_set.locale,
                    "source_summary": json.dumps(source_summary, ensure_ascii=False),
                    "confirmed_at": datetime.now(UTC) if confirm else None,
                },
            )
            if question_set_id is None:
                raise RuntimeError("Could not create the question set.")

            for question in document.questions:
                await connection.execute(
                    text(
                        """
                        insert into public.questions (
                          family_id, question_set_id, position, type, prompt, options,
                          answer_key, rubric, points, primary_knowledge_tag_id
                        ) values (
                          :family_id, :question_set_id, :position, :type,
                          cast(:prompt as jsonb), cast(:options as jsonb),
                          cast(:answer_key as jsonb), cast(:rubric as jsonb),
                          :points, :knowledge_tag_id
                        )
                        """
                    ),
                    {
                        "family_id": family_id,
                        "question_set_id": question_set_id,
                        "position": question.position,
                        "type": question.type.value,
                        "prompt": json.dumps(
                            {document.question_set.locale: question.prompt},
                            ensure_ascii=False,
                        ),
                        "options": (
                            json.dumps(question.options, ensure_ascii=False)
                            if question.options
                            else None
                        ),
                        "answer_key": json.dumps(
                            question.answer_key,
                            ensure_ascii=False,
                        ),
                        "rubric": json.dumps(question.rubric, ensure_ascii=False),
                        "points": question.points,
                        "knowledge_tag_id": knowledge_tag_ids[question.knowledge_code],
                    },
                )

            new_assignment_id: UUID | None = None
            if assign:
                new_assignment_id = await connection.scalar(
                    text(
                        """
                        insert into public.assignments (
                          family_id, question_set_id, child_id, assigned_by, mode,
                          time_limit_seconds
                        ) values (
                          :family_id, :question_set_id, :child_id, :parent_id, :mode,
                          :time_limit_seconds
                        )
                        returning id
                        """
                    ),
                    {
                        "family_id": family_id,
                        "question_set_id": question_set_id,
                        "child_id": child_id,
                        "parent_id": parent_id,
                        "mode": assignment_mode,
                        "time_limit_seconds": time_limit_seconds,
                    },
                )

            await connection.execute(
                text(
                    """
                    insert into public.audit_events (
                      family_id, actor_user_id, action, subject_type, subject_id, metadata
                    ) values (
                      :family_id, :parent_id, 'import_ai_question_set_json',
                      'question_set', :question_set_id, cast(:metadata as jsonb)
                    )
                    """
                ),
                {
                    "family_id": family_id,
                    "parent_id": parent_id,
                    "question_set_id": question_set_id,
                    "metadata": json.dumps(
                        {
                            "checksum": checksum,
                            "source_name": source_name,
                            "question_count": document.question_count,
                            "assigned": assign,
                            "child_id": str(child_id) if assign else None,
                        },
                        ensure_ascii=False,
                    ),
                },
            )

            return ImportResult(
                question_set_id=question_set_id,
                assignment_id=new_assignment_id,
                family_id=target["family_id"],
                family_name=target["family_name"],
                child_id=target["child_id"],
                child_nickname=target["child_nickname"],
                question_count=document.question_count,
                total_points=document.total_points,
                status=new_status,
                reused_existing=False,
                checksum=checksum,
            )
    finally:
        await engine.dispose()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and import an AI-parsed question-set JSON document.",
    )
    parser.add_argument("json_path", type=Path)
    parser.add_argument("--family-id", type=UUID, required=True)
    parser.add_argument("--child-id", type=UUID, required=True)
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--assign", action="store_true")
    execution = parser.add_mutually_exclusive_group(required=True)
    execution.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize without connecting to the database.",
    )
    execution.add_argument(
        "--apply",
        action="store_true",
        help="Write the validated question set to the configured database.",
    )
    return parser


async def _run_cli() -> int:
    args = _build_parser().parse_args()
    document = parse_import_document(args.json_path.read_bytes())
    summary = document_summary(document, source_name=args.json_path.name)
    if args.dry_run:
        print(json.dumps({"dry_run": True, **summary}, ensure_ascii=False, indent=2))
        return 0

    settings = get_settings()
    result = await import_question_set(
        document,
        database_url=settings.database_url,
        family_id=args.family_id,
        child_id=args.child_id,
        source_name=args.json_path.name,
        confirm=args.confirm,
        assign=args.assign,
    )
    print(json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    try:
        raise SystemExit(asyncio.run(_run_cli()))
    except (OSError, ValueError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
