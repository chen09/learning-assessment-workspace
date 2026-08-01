from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    CreateLibrarySubmissionRequest,
    FamilyLibraryQuestionSet,
    LibrarySubmission,
)

router = APIRouter(prefix="/v1/library", tags=["library"])


@router.get(
    "/families/{family_id}/question-sets",
    response_model=list[FamilyLibraryQuestionSet],
)
async def list_family_question_sets(
    family_id: str,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[FamilyLibraryQuestionSet]:
    try:
        return await repository.list_family_question_sets(
            family_id,
            parent_id,
        )
    except (NotFoundError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.get(
    "/families/{family_id}/submissions",
    response_model=list[LibrarySubmission],
)
async def list_family_library_submissions(
    family_id: str,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[LibrarySubmission]:
    try:
        return await repository.list_family_library_submissions(
            family_id,
            parent_id,
        )
    except (NotFoundError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family is not available.",
        ) from error


@router.post(
    "/submissions",
    response_model=LibrarySubmission,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_library_submission(
    request: CreateLibrarySubmissionRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> LibrarySubmission:
    try:
        return await repository.create_library_submission(
            request,
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family or question set is not available.",
        ) from error
