from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import (
    Repository,
    get_repository,
    require_child,
    require_parent,
)
from app.domain.errors import NotFoundError
from app.domain.models import (
    ChildSessionClaims,
    CreateUploadIntentRequest,
    UploadIntent,
)

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])


@router.post(
    "/child-intents",
    response_model=UploadIntent,
    status_code=status.HTTP_201_CREATED,
)
async def create_child_upload_intent(
    request: CreateUploadIntentRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> UploadIntent:
    try:
        return await repository.create_child_upload_intent(
            request,
            str(child.child_id),
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The response upload target is not available.",
        ) from error


@router.post(
    "/intents",
    response_model=UploadIntent,
    status_code=status.HTTP_201_CREATED,
)
async def create_upload_intent(
    request: CreateUploadIntentRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> UploadIntent:
    try:
        return await repository.create_upload_intent(
            request,
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error
