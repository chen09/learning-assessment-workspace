from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_child
from app.domain.errors import NotFoundError
from app.domain.models import (
    ChildSessionClaims,
    CompleteReviewRequest,
    ReviewCompletion,
    ReviewItemView,
)

router = APIRouter(prefix="/v1/reviews", tags=["reviews"])


@router.get("/today", response_model=list[ReviewItemView])
async def list_today_reviews(
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> list[ReviewItemView]:
    return await repository.list_due_reviews(str(child.child_id))


@router.post("/{item_id}/complete", response_model=ReviewCompletion)
async def complete_review(
    item_id: UUID,
    request: CompleteReviewRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> ReviewCompletion:
    try:
        return await repository.complete_review(
            str(item_id),
            str(child.child_id),
            request,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The review item is not available.",
        ) from error
