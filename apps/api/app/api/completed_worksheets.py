from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, model_validator

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import (
    CompletedWorksheetConfirmation,
    CompletedWorksheetImport,
    CompletedWorksheetResponseInput,
    CreateCompletedWorksheetRequest,
    FamilyCompletedWorksheetImport,
)
from app.tools.import_question_set import ImportDocument

router = APIRouter(
    prefix="/v1/completed-worksheets",
    tags=["completed-worksheets"],
)

IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=120),
]


class ConfirmCompletedWorksheetRequest(BaseModel):
    """The parent's reviewed extraction; answers stay attached to the scan."""

    document: ImportDocument
    responses: list[CompletedWorksheetResponseInput]

    @model_validator(mode="after")
    def validate_response_positions(self) -> "ConfirmCompletedWorksheetRequest":
        expected = [question.position for question in self.document.questions]
        actual = [response.question_position for response in self.responses]
        if actual != expected:
            raise ValueError(
                "Responses must contain every confirmed question exactly once, in order."
            )
        return self


def _validate_uploaded_page_references(
    responses: list[CompletedWorksheetResponseInput],
    *,
    uploaded_page_count: int,
) -> None:
    """Keep a reviewed answer attached only to real pages in this scan."""
    for response in responses:
        page_numbers = response.answer.get("page_numbers")
        if not isinstance(page_numbers, list) or not page_numbers:
            raise ValueError(
                f"Answer for question {response.question_position} needs at least one page number."
            )
        for page_number in page_numbers:
            if (
                isinstance(page_number, bool)
                or not isinstance(page_number, int)
                or page_number < 1
                or page_number > uploaded_page_count
            ):
                raise ValueError(
                    f"Answer for question {response.question_position} references page "
                    f"{page_number}, but this paper only has "
                    f"{uploaded_page_count} uploaded page(s)."
                )


@router.post(
    "",
    response_model=CompletedWorksheetImport,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_completed_worksheet_import(
    request: CreateCompletedWorksheetRequest,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> CompletedWorksheetImport:
    """Start analysis without treating an unreviewed extraction as a task."""
    try:
        return await repository.create_completed_worksheet_import(
            request,
            idempotency_key,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The selected family or child is not available.",
        ) from error


@router.get(
    "/families/{family_id}",
    response_model=list[FamilyCompletedWorksheetImport],
)
async def list_completed_worksheet_imports(
    family_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> list[FamilyCompletedWorksheetImport]:
    """List recoverable paper-analysis drafts without returning private media paths."""
    try:
        return await repository.list_completed_worksheet_imports(
            family_id,
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The selected family is not available.",
        ) from error


@router.get("/{worksheet_id}", response_model=CompletedWorksheetImport)
async def get_completed_worksheet_import(
    worksheet_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> CompletedWorksheetImport:
    try:
        return await repository.get_completed_worksheet_import(
            str(worksheet_id),
            parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The completed worksheet upload is not available.",
        ) from error


@router.post(
    "/{worksheet_id}/confirm",
    response_model=CompletedWorksheetConfirmation,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_completed_worksheet_import(
    worksheet_id: UUID,
    request: ConfirmCompletedWorksheetRequest,
    idempotency_key: IdempotencyKey,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> CompletedWorksheetConfirmation:
    """Create the formal question set and submitted attempt after review."""
    try:
        imported = await repository.get_completed_worksheet_import(
            str(worksheet_id),
            parent_id,
        )
        _validate_uploaded_page_references(
            request.responses,
            uploaded_page_count=len(imported.response_paths),
        )
        return await repository.confirm_completed_worksheet_import(
            str(worksheet_id),
            document=request.document,
            responses=request.responses,
            idempotency_key=idempotency_key,
            parent_id=parent_id,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The completed worksheet is not available for confirmation.",
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
