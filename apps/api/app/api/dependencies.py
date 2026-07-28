from typing import Annotated, cast

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from pydantic import ValidationError

from app.domain.models import ChildSessionClaims, ManagementUnlockClaims
from app.repositories.memory import MemoryRepository
from app.repositories.postgres import PostgresRepository
from app.services.child_sessions import ChildSessionService
from app.services.management_unlock import ManagementUnlockService
from app.services.parent_auth import (
    ParentAuthenticationError,
    ParentIdentity,
    SupabaseParentAuthService,
)

Repository = MemoryRepository | PostgresRepository


def get_repository(request: Request) -> Repository:
    return cast(Repository, request.app.state.repository)


def get_child_session_service(request: Request) -> ChildSessionService:
    return cast(ChildSessionService, request.app.state.child_session_service)


def get_management_unlock_service(request: Request) -> ManagementUnlockService:
    return cast(
        ManagementUnlockService,
        request.app.state.management_unlock_service,
    )


def get_parent_auth_service(request: Request) -> SupabaseParentAuthService:
    return cast(SupabaseParentAuthService, request.app.state.parent_auth_service)


async def require_parent_identity(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> ParentIdentity:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid parent session is required.",
        )
    try:
        identity = await get_parent_auth_service(request).authenticate(
            authorization.removeprefix("Bearer ")
        )
    except ParentAuthenticationError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid parent session is required.",
        ) from error
    if not identity.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "verified_email_required",
                "message": "Verify an email before creating or joining a family.",
            },
        )
    return identity


async def require_parent(
    identity: Annotated[ParentIdentity, Depends(require_parent_identity)],
) -> str:
    return identity.user_id


def require_child(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> ChildSessionClaims:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid child session is required.",
        )
    token = authorization.removeprefix("Bearer ")
    try:
        return get_child_session_service(request).decode(token)
    except (jwt.PyJWTError, ValidationError) as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The child session is invalid or expired.",
        ) from error


def require_management_unlock(
    request: Request,
    unlock_token: Annotated[
        str | None,
        Header(alias="X-Management-Unlock"),
    ] = None,
) -> ManagementUnlockClaims:
    if not unlock_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A management unlock token is required.",
        )
    try:
        return get_management_unlock_service(request).decode(unlock_token)
    except (jwt.PyJWTError, ValidationError) as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The management unlock token is invalid or expired.",
        ) from error
