from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import ValidationError

from app.api.dependencies import (
    Repository,
    get_child_session_service,
    get_management_unlock_service,
    get_repository,
    require_parent,
)
from app.domain.errors import FamilyParentLimitReached, NotFoundError
from app.domain.models import (
    Child,
    CreateChildRequest,
    CreateFamilyInvitationRequest,
    CreateFamilyRequest,
    Family,
    FamilyInvitation,
    ManagementPinRequest,
    ManagementPinStatus,
    ManagementUnlockResponse,
)
from app.services.child_sessions import ChildSessionService
from app.services.management_unlock import ManagementUnlockService

router = APIRouter(prefix="/v1/families", tags=["families"])
IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=120),
]


@router.get("", response_model=list[Family])
async def list_families(
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[Family]:
    return await repository.list_families(parent_id)


@router.post("", response_model=Family, status_code=status.HTTP_201_CREATED)
async def create_family(
    request: CreateFamilyRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: IdempotencyKey,
) -> Family:
    return await repository.create_family(request, parent_id, idempotency_key)


@router.get("/{family_id}/children", response_model=list[Child])
async def list_children(
    family_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[Child]:
    try:
        return await repository.list_children(str(family_id), parent_id)
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.post(
    "/{family_id}/children",
    response_model=Child,
    status_code=status.HTTP_201_CREATED,
)
async def create_child(
    family_id: UUID,
    request: CreateChildRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    sessions: Annotated[ChildSessionService, Depends(get_child_session_service)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: IdempotencyKey,
) -> Child:
    try:
        return await repository.create_child(
            str(family_id),
            request,
            sessions.hash_pin(request.pin),
            parent_id,
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.put("/{family_id}/management-pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_management_pin(
    family_id: UUID,
    request: ManagementPinRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    unlocks: Annotated[
        ManagementUnlockService,
        Depends(get_management_unlock_service),
    ],
    parent_id: Annotated[str, Depends(require_parent)],
    unlock_token: Annotated[
        str | None,
        Header(alias="X-Management-Unlock"),
    ] = None,
) -> None:
    try:
        existing_hash = await repository.get_management_pin_hash(
            str(family_id),
            parent_id,
        )
        if existing_hash is not None:
            if unlock_token is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unlock management before replacing its PIN.",
                )
            try:
                claims = unlocks.decode(unlock_token)
            except (jwt.PyJWTError, ValidationError) as error:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="The management unlock token is invalid or expired.",
                ) from error
            if claims.parent_id != parent_id or claims.family_id != family_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="The management unlock does not cover this family.",
                )
        await repository.set_management_pin(
            str(family_id),
            parent_id,
            unlocks.hash_pin(request.pin),
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.get(
    "/{family_id}/management-pin",
    response_model=ManagementPinStatus,
)
async def get_management_pin_status(
    family_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ManagementPinStatus:
    try:
        pin_hash = await repository.get_management_pin_hash(
            str(family_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error
    return ManagementPinStatus(configured=pin_hash is not None)


@router.post(
    "/{family_id}/management-unlock",
    response_model=ManagementUnlockResponse,
)
async def create_management_unlock(
    family_id: UUID,
    request: ManagementPinRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    unlocks: Annotated[
        ManagementUnlockService,
        Depends(get_management_unlock_service),
    ],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ManagementUnlockResponse:
    try:
        pin_hash = await repository.get_management_pin_hash(
            str(family_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error
    if pin_hash is None or not unlocks.verify_pin(pin_hash, request.pin):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The management PIN is incorrect.",
        )
    return unlocks.create(str(family_id), parent_id)


@router.post(
    "/{family_id}/invitations",
    response_model=FamilyInvitation,
    status_code=status.HTTP_201_CREATED,
)
async def create_family_invitation(
    family_id: UUID,
    request: CreateFamilyInvitationRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: IdempotencyKey,
) -> FamilyInvitation:
    try:
        return await repository.create_family_invitation(
            str(family_id),
            request,
            parent_id,
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error
    except FamilyParentLimitReached as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "family_parent_limit_reached"},
        ) from error
