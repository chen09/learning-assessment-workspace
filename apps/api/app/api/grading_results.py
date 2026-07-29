from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    ParentAttemptReview,
    ParentDecision,
    ParentDecisionRequest,
)

router = APIRouter(prefix="/v1/grading-results", tags=["grading-results"])


@router.get("/attempts/{attempt_id}", response_model=ParentAttemptReview)
async def get_parent_attempt_review(
    attempt_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ParentAttemptReview:
    try:
        return await repository.get_parent_attempt_review(
            str(attempt_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt results are not available to this parent.",
        ) from error


@router.post("/{result_id}/parent-decision", response_model=ParentDecision)
async def decide_result(
    result_id: UUID,
    request: ParentDecisionRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    _idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> ParentDecision:
    try:
        return await repository.decide_grading_result(
            str(result_id),
            request,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The grading result is not available.",
        ) from error
