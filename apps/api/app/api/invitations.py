from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import (
    Repository,
    get_repository,
    require_parent_identity,
)
from app.domain.errors import NotFoundError
from app.domain.models import Family, FamilyInvitation
from app.services.parent_auth import ParentIdentity

router = APIRouter(prefix="/v1/invitations", tags=["invitations"])


def _verified_email(identity: ParentIdentity) -> str:
    if not identity.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "verified_email_required"},
        )
    return identity.email


@router.get("/pending", response_model=list[FamilyInvitation])
async def list_pending_invitations(
    repository: Annotated[Repository, Depends(get_repository)],
    parent: Annotated[ParentIdentity, Depends(require_parent_identity)],
) -> list[FamilyInvitation]:
    return await repository.list_pending_invitations(_verified_email(parent))


@router.post("/{invitation_id}/accept", response_model=Family)
async def accept_invitation(
    invitation_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent: Annotated[ParentIdentity, Depends(require_parent_identity)],
) -> Family:
    try:
        return await repository.accept_family_invitation(
            str(invitation_id),
            _verified_email(parent),
            parent.user_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The invitation is unavailable or expired.",
        ) from error
