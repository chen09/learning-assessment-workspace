from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_child
from app.domain.errors import (
    ListeningReplayLimitReached,
    NotFoundError,
    QuestionAnswerRequired,
    ResponseVersionConflict,
    SubmittedAttemptImmutable,
    SubmittedQuestionImmutable,
)
from app.domain.models import (
    AssignmentWork,
    AttemptResults,
    ChildSessionClaims,
    Job,
    ListeningPlaybackReceipt,
    QuestionSubmissionReceipt,
    SavedResponse,
    SaveResponseRequest,
    SubmissionReceipt,
)

router = APIRouter(prefix="/v1/attempts", tags=["attempts"])


@router.get("/{attempt_id}/work", response_model=AssignmentWork)
async def get_attempt_work(
    attempt_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> AssignmentWork:
    try:
        return await repository.get_attempt_work(
            str(attempt_id),
            str(child.child_id),
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt is not available for work.",
        ) from error


@router.post(
    "/{attempt_id}/questions/{question_id}/audio-playbacks",
    response_model=ListeningPlaybackReceipt,
)
async def record_listening_playback(
    attempt_id: UUID,
    question_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> ListeningPlaybackReceipt:
    try:
        return await repository.record_listening_playback(
            str(attempt_id),
            str(question_id),
            str(child.child_id),
        )
    except ListeningReplayLimitReached as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "listening_replay_limit_reached"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The listening question is not available.",
        ) from error


@router.post("/{attempt_id}/correction", response_model=AssignmentWork)
async def create_correction(
    attempt_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> AssignmentWork:
    try:
        return await repository.create_correction(
            str(attempt_id),
            str(child.child_id),
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No correction is available for this attempt.",
        ) from error


@router.post(
    "/{attempt_id}/questions/{question_id}/retry",
    response_model=AssignmentWork,
)
async def create_question_retry(
    attempt_id: UUID,
    question_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> AssignmentWork:
    try:
        return await repository.create_question_retry(
            str(attempt_id),
            str(question_id),
            str(child.child_id),
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No graded answer is available to retry.",
        ) from error


@router.put(
    "/{attempt_id}/responses/{question_id}",
    response_model=SavedResponse,
)
async def save_response(
    attempt_id: UUID,
    question_id: UUID,
    request: SaveResponseRequest,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> SavedResponse:
    try:
        return await repository.save_response(
            str(attempt_id),
            str(question_id),
            str(child.child_id),
            request,
        )
    except ResponseVersionConflict as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "response_version_conflict",
                "current_version": error.current_version,
            },
        ) from error
    except SubmittedAttemptImmutable as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "submitted_attempt_is_immutable"},
        ) from error
    except SubmittedQuestionImmutable as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "submitted_question_is_immutable"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt or question is not available.",
        ) from error


@router.post(
    "/{attempt_id}/questions/{question_id}/submit",
    response_model=QuestionSubmissionReceipt,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_question(
    attempt_id: UUID,
    question_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> QuestionSubmissionReceipt:
    try:
        return await repository.submit_question(
            str(attempt_id),
            str(question_id),
            str(child.child_id),
            idempotency_key,
        )
    except QuestionAnswerRequired as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "question_answer_required"},
        ) from error
    except (SubmittedAttemptImmutable, SubmittedQuestionImmutable) as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "submitted_question_is_immutable"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt or question is not available.",
        ) from error


@router.post(
    "/{attempt_id}/questions/{question_id}/regrade",
    response_model=QuestionSubmissionReceipt,
    status_code=status.HTTP_202_ACCEPTED,
)
async def regrade_question(
    attempt_id: UUID,
    question_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> QuestionSubmissionReceipt:
    try:
        return await repository.regrade_question(
            str(attempt_id),
            str(question_id),
            str(child.child_id),
            idempotency_key,
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="A graded answer is required before requesting another review.",
        ) from error


@router.get(
    "/{attempt_id}/questions/{question_id}/grading-jobs/{job_id}",
    response_model=Job,
)
async def get_question_grading_job(
    attempt_id: UUID,
    question_id: UUID,
    job_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> Job:
    try:
        return await repository.get_question_grading_job(
            str(attempt_id),
            str(question_id),
            str(job_id),
            str(child.child_id),
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The grading job is not available.",
        ) from error


@router.post(
    "/{attempt_id}/submit",
    response_model=SubmissionReceipt,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_attempt(
    attempt_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=120),
    ],
) -> SubmissionReceipt:
    try:
        return await repository.submit_attempt(
            str(attempt_id),
            str(child.child_id),
            idempotency_key,
        )
    except SubmittedAttemptImmutable as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "submitted_attempt_is_immutable"},
        ) from error
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt is not available.",
        ) from error


@router.get("/{attempt_id}/results", response_model=AttemptResults)
async def get_results(
    attempt_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    child: Annotated[ChildSessionClaims, Depends(require_child)],
) -> AttemptResults:
    try:
        return await repository.get_attempt_results(
            str(attempt_id),
            str(child.child_id),
        )
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The attempt is not available.",
        ) from error
