from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import (
    Repository,
    get_repository,
    require_child,
    require_parent,
)
from app.domain.errors import AssignmentStatusConflict, NotFoundError
from app.domain.models import (
    Assignment,
    AssignmentWork,
    ChildAssignmentSummary,
    ChildSessionClaims,
    PrintableAssignment,
)

router = APIRouter(prefix="/v1/assignments", tags=["assignments"])


@router.get("", response_model=list[ChildAssignmentSummary])
async def list_child_assignments(
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> list[ChildAssignmentSummary]:
    return await repository.list_child_assignments(str(child.child_id))


@router.get("/{assignment_id}/printable", response_model=PrintableAssignment)
async def get_printable_assignment(
    assignment_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> PrintableAssignment:
    try:
        return await repository.get_printable_assignment(
            str(assignment_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The printable assignment is not available.",
        ) from error


@router.post("/{assignment_id}/start", response_model=AssignmentWork)
async def start_assignment(
    assignment_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> AssignmentWork:
    work = await repository.start_assignment(str(assignment_id), str(child.child_id))
    if work is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The assignment is not available to this child.",
        )
    return work


@router.post("/{assignment_id}/withdraw", response_model=Assignment)
async def withdraw_assignment(
    assignment_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> Assignment:
    try:
        return await repository.withdraw_assignment(str(assignment_id), parent_id)
    except AssignmentStatusConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "assignment_cannot_be_withdrawn"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The assignment is not available.",
        ) from error


@router.post("/{assignment_id}/stop", response_model=Assignment)
async def stop_assignment(
    assignment_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> Assignment:
    try:
        return await repository.stop_assignment(str(assignment_id), parent_id)
    except AssignmentStatusConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "assignment_cannot_be_stopped"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The assignment is not available.",
        ) from error
