from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

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

router = APIRouter(prefix="/v1/question-sets", tags=["question-sets"])
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=120),
]


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
