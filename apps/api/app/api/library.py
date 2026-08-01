from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.config import get_settings
from app.domain.errors import (
    LibrarySubmissionContainsPrivateAudio,
    LibrarySubmissionStatusConflict,
    NotFoundError,
)
from app.domain.models import (
    CopyPublicLibraryItemRequest,
    CreateLibrarySubmissionRequest,
    FamilyLibraryQuestionSet,
    LibraryReviewerAccess,
    LibraryReviewSubmission,
    LibrarySubmission,
    PublicLibraryCopy,
    PublicLibraryItem,
    ReviewLibrarySubmissionRequest,
)

router = APIRouter(prefix="/v1/library", tags=["library"])


def _require_library_reviewer(parent_id: str) -> None:
    if parent_id not in get_settings().library_reviewer_parent_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "library_reviewer_required"},
        )


@router.get("/items", response_model=list[PublicLibraryItem])
async def list_public_library_items(
    repository: Annotated[Repository, Depends(get_repository)],
    _: Annotated[str, Depends(require_parent)],
) -> list[PublicLibraryItem]:
    """List anonymous public metadata only; never expose answers or sources."""
    return await repository.list_public_library_items()


@router.post(
    "/items/{library_item_id}/copies",
    response_model=PublicLibraryCopy,
    status_code=status.HTTP_201_CREATED,
)
async def copy_public_library_item(
    library_item_id: str,
    request: CopyPublicLibraryItemRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> PublicLibraryCopy:
    """Create a standalone family copy from the reviewed private snapshot."""
    try:
        return await repository.copy_public_library_item(
            library_item_id,
            request.family_id,
            idempotency_key,
            parent_id,
        )
    except (NotFoundError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The published library item is not available.",
        ) from error


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


@router.get("/review/submissions", response_model=list[LibraryReviewSubmission])
async def list_pending_library_review_submissions(
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[LibraryReviewSubmission]:
    """Reviewer metadata excludes source files, answer keys, and child work."""
    _require_library_reviewer(parent_id)
    return await repository.list_pending_library_review_submissions()


@router.get("/review/access", response_model=LibraryReviewerAccess)
async def get_library_reviewer_access(
    parent_id: Annotated[str, Depends(require_parent)],
) -> LibraryReviewerAccess:
    return LibraryReviewerAccess(
        is_reviewer=parent_id in get_settings().library_reviewer_parent_ids,
    )


@router.post(
    "/review/submissions/{submission_id}/decision",
    response_model=LibrarySubmission,
)
async def review_library_submission(
    submission_id: str,
    request: ReviewLibrarySubmissionRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> LibrarySubmission:
    _require_library_reviewer(parent_id)
    try:
        return await repository.review_library_submission(
            submission_id,
            request,
            idempotency_key,
            parent_id,
        )
    except LibrarySubmissionStatusConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "library_submission_cannot_be_reviewed"},
        ) from error
    except (NotFoundError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The library submission is not available.",
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
    except LibrarySubmissionContainsPrivateAudio as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "library_submission_contains_private_audio"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The family or question set is not available.",
        ) from error


@router.post("/submissions/{submission_id}/withdraw", response_model=LibrarySubmission)
async def withdraw_library_submission(
    submission_id: str,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> LibrarySubmission:
    try:
        return await repository.withdraw_library_submission(submission_id, parent_id)
    except LibrarySubmissionStatusConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "library_submission_cannot_be_withdrawn"},
        ) from error
    except (NotFoundError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The library submission is not available.",
        ) from error
