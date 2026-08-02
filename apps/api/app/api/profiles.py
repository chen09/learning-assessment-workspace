from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    ParentLanguagePreference,
    UpdateParentLanguageRequest,
)

router = APIRouter(prefix="/v1/profiles", tags=["profiles"])


@router.get("/me/language", response_model=ParentLanguagePreference)
async def get_own_parent_language(
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ParentLanguagePreference:
    try:
        return await repository.get_parent_language(parent_id)
    except NotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="The parent profile is not available.",
        ) from error


@router.put("/me/language", response_model=ParentLanguagePreference)
async def update_own_parent_language(
    request: UpdateParentLanguageRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> ParentLanguagePreference:
    try:
        return await repository.update_parent_language(parent_id, request.ui_language)
    except NotFoundError as error:
        raise HTTPException(
            status_code=404,
            detail="The parent profile is not available.",
        ) from error
