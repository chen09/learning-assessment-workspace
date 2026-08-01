from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    Assignment,
    CreateAssignmentRequest,
    CreateImportRequest,
    QuestionSet,
    QuestionSetDraft,
    QuestionSetImport,
)
from app.tools.import_question_set import (
    ImportDocument,
    ImportResult,
    QuestionInput,
    document_summary,
)

router = APIRouter(prefix="/v1/question-sets", tags=["question-sets"])
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=120),
]


class StructuredImportPreview(BaseModel):
    title: str
    subject: str
    locale: str
    question_count: int
    total_points: float
    estimated_minutes: int
    knowledge_tag_count: int
    answer_keys_present: bool
    checksum: str
    source_summary: dict[str, Any]
    questions: list[QuestionInput]


class StructuredImportRequest(BaseModel):
    family_id: UUID
    child_id: UUID
    source_name: str = Field(min_length=1, max_length=180)
    assignment_mode: Literal["practice", "exam"] = "practice"
    time_limit_seconds: int | None = Field(default=None, ge=60, le=14_400)
    parent_note: str | None = Field(default=None, max_length=300)
    document: ImportDocument

    @model_validator(mode="after")
    def validate_assignment_timing(self) -> "StructuredImportRequest":
        if self.assignment_mode == "exam" and self.time_limit_seconds is None:
            raise ValueError("Timed exams require a time limit.")
        if self.assignment_mode == "practice" and self.time_limit_seconds is not None:
            raise ValueError("Practice assignments cannot have a time limit.")
        return self


@router.post(
    "/imports/structured/preview",
    response_model=StructuredImportPreview,
)
async def preview_structured_import(
    document: ImportDocument,
    _parent_id: Annotated[str, Depends(require_parent)],
) -> StructuredImportPreview:
    summary = document_summary(document, source_name="browser-upload.json")
    return StructuredImportPreview(
        **summary,
        source_summary=document.question_set.source_summary,
        questions=document.questions,
    )


@router.post(
    "/imports/structured",
    response_model=ImportResult,
    status_code=status.HTTP_201_CREATED,
)
async def import_structured_question_set(
    request: StructuredImportRequest,
    _idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ImportResult:
    try:
        return await repository.import_structured_question_set(
            request.document,
            family_id=request.family_id,
            child_id=request.child_id,
            source_name=request.source_name,
            parent_id=parent_id,
            assignment_mode=request.assignment_mode,
            time_limit_seconds=request.time_limit_seconds,
            parent_note=request.parent_note,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The active family or child is not available.",
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.post(
    "/imports",
    response_model=QuestionSetImport,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_import(
    request: CreateImportRequest,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> QuestionSetImport:
    try:
        return await repository.create_import(request, idempotency_key, parent_id)
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.get("/{question_set_id}", response_model=QuestionSetDraft)
async def get_question_set(
    question_set_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> QuestionSetDraft:
    try:
        return await repository.get_question_set_draft(
            str(question_set_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The question set is not available.",
        ) from error


@router.post("/{question_set_id}/confirm", response_model=QuestionSet)
async def confirm_question_set(
    question_set_id: UUID,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> QuestionSet:
    try:
        return await repository.confirm_question_set(
            str(question_set_id),
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The question set is not available.",
        ) from error


@router.post(
    "/{question_set_id}/assignments",
    response_model=Assignment,
    status_code=status.HTTP_201_CREATED,
)
async def assign_question_set(
    question_set_id: UUID,
    request: CreateAssignmentRequest,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> Assignment:
    try:
        return await repository.assign_question_set(
            str(question_set_id),
            request,
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The confirmed set or child is not available.",
        ) from error
