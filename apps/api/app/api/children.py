from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import (
    Repository,
    get_child_session_service,
    get_repository,
    require_management_unlock,
    require_parent,
)
from app.domain.errors import NotFoundError
from app.domain.models import (
    Child,
    ChildSessionRequest,
    ChildSessionResponse,
    ManagementUnlockClaims,
    UpdateChildPinRequest,
)
from app.services.child_sessions import ChildSessionService

router = APIRouter(prefix="/v1/children", tags=["children"])


@router.put("/{child_id}/pin", response_model=Child)
async def update_child_pin(
    child_id: UUID,
    request: UpdateChildPinRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    sessions: Annotated[ChildSessionService, Depends(get_child_session_service)],
    parent_id: Annotated[str, Depends(require_parent)],
    unlock: Annotated[
        ManagementUnlockClaims,
        Depends(require_management_unlock),
    ],
) -> Child:
    child = await repository.get_child(str(child_id))
    if (
        child is None
        or unlock.parent_id != parent_id
        or unlock.family_id != child.family_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The management unlock does not cover this child.",
        )
    try:
        return await repository.update_child_pin(
            str(child_id),
            sessions.hash_pin(request.pin),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The child is not available.",
        ) from error


@router.post(
    "/{child_id}/sessions",
    response_model=ChildSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_child_session(
    child_id: UUID,
    request: ChildSessionRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    sessions: Annotated[ChildSessionService, Depends(get_child_session_service)],
) -> ChildSessionResponse:
    child = await repository.get_child(str(child_id))
    pin_hash = await repository.get_child_pin_hash(str(child_id))
    if child is None or pin_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The child PIN is incorrect.",
        )
    if await repository.is_child_pin_locked(str(child_id)):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Child entry is temporarily locked.",
        )
    if not sessions.verify_pin(pin_hash, request.pin):
        became_locked = await repository.record_child_pin_failure(str(child_id))
        raise HTTPException(
            status_code=(
                status.HTTP_423_LOCKED
                if became_locked
                else status.HTTP_401_UNAUTHORIZED
            ),
            detail=(
                "Child entry is temporarily locked."
                if became_locked
                else "The child PIN is incorrect."
            ),
        )
    await repository.reset_child_pin_failures(str(child_id))
    return sessions.create(child)
