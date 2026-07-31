from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    CompletedWorksheetImport,
    CreateCompletedWorksheetRequest,
)

router = APIRouter(
    prefix="/v1/completed-worksheets",
    tags=["completed-worksheets"],
)

IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=120),
]


@router.post(
    "",
    response_model=CompletedWorksheetImport,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_completed_worksheet_import(
    request: CreateCompletedWorksheetRequest,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> CompletedWorksheetImport:
    """Start analysis without treating an unreviewed extraction as a task."""
    try:
        return await repository.create_completed_worksheet_import(
            request,
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The selected family or child is not available.",
        ) from error


@router.get("/{worksheet_id}", response_model=CompletedWorksheetImport)
async def get_completed_worksheet_import(
    worksheet_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> CompletedWorksheetImport:
    try:
        return await repository.get_completed_worksheet_import(
            str(worksheet_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The completed worksheet upload is not available.",
        ) from error
