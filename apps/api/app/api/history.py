from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import (
    Repository,
    get_repository,
    require_child,
    require_parent,
)
from app.domain.errors import NotFoundError
from app.domain.models import ChildSessionClaims, HistoryItem

router = APIRouter(prefix="/v1/history", tags=["history"])


@router.get("/child", response_model=list[HistoryItem])
async def list_child_history(
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> list[HistoryItem]:
    try:
        return await repository.list_child_history(str(child.child_id))
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The child is not available.",
        ) from error


@router.get("/families/{family_id}", response_model=list[HistoryItem])
async def list_family_history(
    family_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[HistoryItem]:
    try:
        return await repository.list_family_history(
            str(family_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error
