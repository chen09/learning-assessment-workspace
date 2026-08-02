from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import CreateDeletionRequest, DeletionRequestView

router = APIRouter(prefix="/v1/deletions", tags=["deletions"])


@router.get("", response_model=list[DeletionRequestView])
async def list_recoverable_deletions(
    family_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[DeletionRequestView]:
    try:
        return await repository.list_recoverable_deletions(
            str(family_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.post(
    "",
    response_model=DeletionRequestView,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_deletion_request(
    request: CreateDeletionRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> DeletionRequestView:
    try:
        return await repository.create_deletion_request(
            request,
            parent_id,
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The deletion target is not available.",
        ) from error


@router.post("/{deletion_id}/restore", response_model=DeletionRequestView)
async def restore_deletion_request(
    deletion_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> DeletionRequestView:
    try:
        return await repository.restore_deletion_request(
            str(deletion_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The deletion request cannot be restored.",
        ) from error
