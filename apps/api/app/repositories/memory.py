from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from argon2 import PasswordHasher

from app.domain.errors import (
    AssignmentStatusConflict,
    FamilyParentLimitReached,
    LibrarySubmissionContainsPrivateAudio,
    LibrarySubmissionStatusConflict,
    ListeningReplayLimitReached,
    NotFoundError,
    QuestionAnswerRequired,
    ResponseVersionConflict,
    SubmittedAttemptImmutable,
    SubmittedQuestionImmutable,
)
from app.domain.models import (
    Assignment,
    AssignmentStatus,
    AssignmentWork,
    Attempt,
    AttemptResults,
    Child,
    ChildAssignmentSummary,
    CompletedWorksheetConfirmation,
    CompletedWorksheetImport,
    CompletedWorksheetResponseInput,
    CompletedWorksheetStatus,
    CompleteReviewRequest,
    CreateAssignmentRequest,
    CreateChildRequest,
    CreateCompletedWorksheetRequest,
    CreateDeletionRequest,
    CreateFamilyInvitationRequest,
    CreateFamilyRequest,
    CreateImportRequest,
    CreateLibrarySubmissionRequest,
    CreateUploadIntentRequest,
    DeletionRequestView,
    DemoBootstrap,
    Family,
    FamilyInvitation,
    FamilyLibraryQuestionSet,
    HistoryItem,
    Job,
    JobStatus,
    LibraryReviewSubmission,
    LibrarySubmission,
    ListeningPlaybackReceipt,
    ParentAttemptReview,
    ParentDecision,
    ParentDecisionRequest,
    ParentHistoryItem,
    ParentReviewItem,
    PrintableAssignment,
    PublicLibraryCopy,
    PublicLibraryItem,
    Question,
    QuestionResult,
    QuestionSet,
    QuestionSetDraft,
    QuestionSetImport,
    QuestionSetStatus,
    QuestionSubmissionReceipt,
    QuestionType,
    QuestionView,
    ResponseKind,
    ResponseRevision,
    ReviewCompletion,
    ReviewItemView,
    ReviewLibrarySubmissionRequest,
    SavedResponse,
    SaveResponseRequest,
    SubmissionReceipt,
    UploadIntent,
)
from app.fixtures.english_lesson_one import (
    lesson_one_question_specs,
    lesson_one_source_summary,
    matches_lesson_one_import,
)
from app.tools.import_question_set import (
    ImportDocument,
    ImportResult,
    document_checksum,
)


def _photo_paths(kind: ResponseKind | None, answer: object) -> list[str]:
    if kind != ResponseKind.PHOTO or not isinstance(answer, dict):
        return []
    paths = answer.get("paths")
    if not isinstance(paths, list):
        return []
    return [path for path in paths if isinstance(path, str)]


def _photo_revision_change(
    previous_paths: list[str], next_paths: list[str]
) -> Literal["photo_added", "photo_updated", "photo_removed"]:
    if not previous_paths:
        return "photo_added"
    if not next_paths:
        return "photo_removed"
    return "photo_updated"


def _question_view(question: Question, *, play_count: int = 0) -> QuestionView:
    listening = question.listening
    return QuestionView(
        id=question.id,
        position=question.position,
        type=question.type,
        prompt=question.prompt,
        options=question.options,
        points=question.points,
        listening=(
            {
                "audio_url": None,
                "replay_limit": listening.replay_limit,
                "play_count": play_count,
                "transcript": (
                    listening.transcript
                    if listening.transcript_policy == "always"
                    else None
                ),
            }
            if listening is not None
            else None
        ),
    )


class MemoryRepository:
    """Fixture-backed repository used by tests and local UI development."""

    def __init__(self) -> None:
        self.families: dict[str, Family] = {}
        self.children: dict[str, Child] = {}
        self.question_sets: dict[str, QuestionSet] = {}
        self.questions: dict[str, Question] = {}
        self.assignments: dict[str, Assignment] = {}
        self.attempts: dict[str, Attempt] = {}
        self.responses: dict[tuple[str, str], SavedResponse] = {}
        self.response_revisions: dict[str, list[ResponseRevision]] = {}
        self.jobs: dict[str, Job] = {}
        self.question_results: dict[str, list[QuestionResult]] = {}
        self.submission_idempotency: dict[tuple[str, str], str] = {}
        self.question_submissions: dict[tuple[str, str], str] = {}
        self.listening_play_counts: dict[tuple[str, str], int] = {}
        self.child_pin_hashes: dict[str, str] = {}
        self.child_pin_failures: dict[str, int] = {}
        self.child_pin_locked_until: dict[str, datetime] = {}
        self.imports: dict[str, QuestionSetImport] = {}
        self.import_idempotency: dict[tuple[str, str], str] = {}
        self.completed_worksheet_imports: dict[str, CompletedWorksheetImport] = {}
        self.completed_worksheet_idempotency: dict[tuple[str, str], str] = {}
        self.structured_imports: dict[tuple[str, str], str] = {}
        self.confirm_idempotency: dict[tuple[str, str], str] = {}
        self.assignment_idempotency: dict[tuple[str, str], str] = {}
        self.upload_intents: dict[tuple[str, str], UploadIntent] = {}
        self.private_audio_paths: set[tuple[str, str]] = set()
        self.library_submissions: dict[str, LibrarySubmission] = {}
        self.library_idempotency: dict[tuple[str, str], str] = {}
        self.library_review_idempotency: dict[tuple[str, str], str] = {}
        self.library_copy_idempotency: dict[tuple[str, str], str] = {}
        self.library_items: dict[str, dict[str, object]] = {}
        self.parent_decisions: dict[str, ParentDecision] = {}
        self.family_invitations: dict[str, FamilyInvitation] = {}
        self.invitation_idempotency: dict[tuple[str, str], str] = {}
        self.family_parents: dict[str, set[str]] = {}
        self.family_idempotency: dict[tuple[str, str], str] = {}
        self.child_idempotency: dict[tuple[str, str], str] = {}
        self.review_items: dict[str, ReviewItemView] = {}
        self.correction_idempotency: dict[tuple[str, str], str] = {}
        self.correction_question_ids: dict[str, set[str]] = {}
        self.deletion_requests: dict[str, DeletionRequestView] = {}
        self.deletion_idempotency: dict[tuple[str, str], str] = {}
        self.management_pin_hashes: dict[tuple[str, str], str] = {}
        self._pin_hasher = PasswordHasher()

    async def bootstrap_demo(self) -> DemoBootstrap:
        family = Family(name="Demo family")
        child = Child(
            family_id=family.id,
            nickname="Alex",
            grade_stage="Junior high 1",
        )
        question_set = QuestionSet(
            family_id=family.id,
            title="Algebra and English warm-up",
            subject="Mixed practice",
            status=QuestionSetStatus.CONFIRMED,
        )
        questions = [
            Question(
                family_id=family.id,
                question_set_id=question_set.id,
                position=1,
                type=QuestionType.SINGLE_CHOICE,
                prompt="Choose the correct expansion of (a + b)(a - b).",
                options=["a² - b²", "a² + b²", "a² - 2ab + b²"],
                answer_key={"choice": 0},
            ),
            Question(
                family_id=family.id,
                question_set_id=question_set.id,
                position=2,
                type=QuestionType.TYPED_TEXT,
                prompt="Complete: She ___ to school every day.",
                answer_key={"text": "goes"},
            ),
            Question(
                family_id=family.id,
                question_set_id=question_set.id,
                position=3,
                type=QuestionType.HANDWRITING,
                prompt="Show why (a + b)(a - b) = a² - b².",
                answer_key={"reference": "Expand and cancel +ab and -ab."},
                points=2,
            ),
        ]
        assignment = Assignment(
            family_id=family.id,
            question_set_id=question_set.id,
            child_id=child.id,
        )

        self.families[str(family.id)] = family
        self.family_parents[str(family.id)] = {"parent-fixture"}
        self.children[str(child.id)] = child
        self.child_pin_hashes[str(child.id)] = self._pin_hasher.hash("123456")
        self.question_sets[str(question_set.id)] = question_set
        self.assignments[str(assignment.id)] = assignment
        self.questions.update({str(question.id): question for question in questions})

        return DemoBootstrap(
            family=family,
            child=child,
            question_set=question_set,
            assignment=assignment,
            questions=[_question_view(question) for question in questions],
        )

    async def list_families(self, parent_id: str) -> list[Family]:
        return [
            family
            for family_id, family in self.families.items()
            if parent_id in self.family_parents.get(family_id, set())
        ]

    async def create_family(
        self,
        request: CreateFamilyRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> Family:
        record_key = (parent_id, idempotency_key)
        existing_id = self.family_idempotency.get(record_key)
        if existing_id is not None:
            return self.families[existing_id]
        family = Family(name=request.name.strip())
        self.families[str(family.id)] = family
        self.family_parents[str(family.id)] = {parent_id}
        self.family_idempotency[record_key] = str(family.id)
        return family

    async def list_children(self, family_id: str, parent_id: str) -> list[Child]:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        return [
            child
            for child in self.children.values()
            if str(child.family_id) == family_id
        ]

    async def create_child(
        self,
        family_id: str,
        request: CreateChildRequest,
        pin_hash: str,
        parent_id: str,
        idempotency_key: str,
    ) -> Child:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing_id = self.child_idempotency.get(record_key)
        if existing_id is not None:
            return self.children[existing_id]
        child = Child(
            family_id=family_id,
            nickname=request.nickname.strip(),
            grade_stage=request.grade_stage.strip(),
            ui_language=request.ui_language,
        )
        self.children[str(child.id)] = child
        self.child_pin_hashes[str(child.id)] = pin_hash
        self.child_idempotency[record_key] = str(child.id)
        return child

    async def update_child_pin(
        self,
        child_id: str,
        pin_hash: str,
        parent_id: str,
    ) -> Child:
        child = self.children.get(child_id)
        if (
            child is None
            or parent_id not in self.family_parents.get(str(child.family_id), set())
        ):
            raise NotFoundError
        self.child_pin_hashes[child_id] = pin_hash
        await self.reset_child_pin_failures(child_id)
        return child

    async def update_child_language(
        self,
        child_id: str,
        ui_language: str,
        parent_id: str | None = None,
    ) -> Child:
        child = self.children.get(child_id)
        if child is None or (
            parent_id is not None
            and parent_id
            not in self.family_parents.get(str(child.family_id), set())
        ):
            raise NotFoundError
        child.ui_language = ui_language  # type: ignore[assignment]
        return child

    async def set_management_pin(
        self,
        family_id: str,
        parent_id: str,
        pin_hash: str,
    ) -> None:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        self.management_pin_hashes[(family_id, parent_id)] = pin_hash

    async def get_management_pin_hash(
        self,
        family_id: str,
        parent_id: str,
    ) -> str | None:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        return self.management_pin_hashes.get((family_id, parent_id))

    async def get_child(self, child_id: str) -> Child | None:
        return self.children.get(child_id)

    async def get_child_pin_hash(self, child_id: str) -> str | None:
        return self.child_pin_hashes.get(child_id)

    async def is_child_pin_locked(self, child_id: str) -> bool:
        locked_until = self.child_pin_locked_until.get(child_id)
        if locked_until is None:
            return False
        if locked_until <= datetime.now(UTC):
            await self.reset_child_pin_failures(child_id)
            return False
        return True

    async def record_child_pin_failure(self, child_id: str) -> bool:
        failures = self.child_pin_failures.get(child_id, 0) + 1
        self.child_pin_failures[child_id] = failures
        if failures < 5:
            return False
        self.child_pin_locked_until[child_id] = datetime.now(UTC) + timedelta(minutes=5)
        return True

    async def reset_child_pin_failures(self, child_id: str) -> None:
        self.child_pin_failures.pop(child_id, None)
        self.child_pin_locked_until.pop(child_id, None)

    async def start_assignment(
        self,
        assignment_id: str,
        child_id: str,
    ) -> AssignmentWork | None:
        assignment = self.assignments.get(assignment_id)
        if (
            assignment is None
            or str(assignment.child_id) != child_id
            or assignment.status
            not in {AssignmentStatus.ASSIGNED, AssignmentStatus.IN_PROGRESS}
        ):
            return None

        existing_attempt = next(
            (
                attempt
                for attempt in self.attempts.values()
                if str(attempt.assignment_id) == assignment_id
                and str(attempt.child_id) == child_id
                and attempt.submitted_at is None
            ),
            None,
        )
        attempt = existing_attempt or Attempt(
            family_id=assignment.family_id,
            assignment_id=assignment.id,
            child_id=assignment.child_id,
        )
        self.attempts[str(attempt.id)] = attempt
        assignment.status = AssignmentStatus.IN_PROGRESS
        self.assignments[assignment_id] = assignment

        questions = sorted(
            (
                question
                for question in self.questions.values()
                if question.question_set_id == assignment.question_set_id
            ),
            key=lambda question: question.position,
        )
        return AssignmentWork(
            title=self.question_sets[str(assignment.question_set_id)].title,
            assignment=assignment,
            attempt=attempt,
            questions=[
                _question_view(
                    question,
                    play_count=self.listening_play_counts.get(
                        (str(attempt.id), str(question.id)), 0
                    ),
                )
                for question in questions
            ],
            responses=list(self.responses_for_attempt(str(attempt.id)).values()),
            submitted_question_ids=[
                UUID(question_id)
                for saved_attempt_id, question_id in self.question_submissions
                if saved_attempt_id == str(attempt.id)
            ],
        )

    async def withdraw_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> Assignment:
        assignment = self.assignments.get(assignment_id)
        if (
            assignment is None
            or parent_id not in self.family_parents.get(str(assignment.family_id), set())
        ):
            raise NotFoundError
        if assignment.status != AssignmentStatus.ASSIGNED:
            raise AssignmentStatusConflict
        assignment.status = AssignmentStatus.WITHDRAWN
        self.assignments[assignment_id] = assignment
        return assignment

    async def stop_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> Assignment:
        assignment = self.assignments.get(assignment_id)
        if (
            assignment is None
            or parent_id not in self.family_parents.get(str(assignment.family_id), set())
        ):
            raise NotFoundError
        if assignment.status != AssignmentStatus.IN_PROGRESS:
            raise AssignmentStatusConflict
        assignment.status = AssignmentStatus.STOPPED
        self.assignments[assignment_id] = assignment
        return assignment

    async def list_child_assignments(
        self,
        child_id: str,
    ) -> list[ChildAssignmentSummary]:
        summaries: list[ChildAssignmentSummary] = []
        for assignment in self.assignments.values():
            if (
                str(assignment.child_id) != child_id
                or assignment.status
                in {
                    AssignmentStatus.COMPLETED,
                    AssignmentStatus.WITHDRAWN,
                    AssignmentStatus.STOPPED,
                }
            ):
                continue
            question_set = self.question_sets[str(assignment.question_set_id)]
            question_count = sum(
                question.question_set_id == assignment.question_set_id
                for question in self.questions.values()
            )
            attempts = sorted(
                (
                    attempt
                    for attempt in self.attempts.values()
                    if attempt.assignment_id == assignment.id
                ),
                key=lambda attempt: attempt.sequence,
                reverse=True,
            )
            summaries.append(
                ChildAssignmentSummary(
                    id=assignment.id,
                    title=question_set.title,
                    status=assignment.status,
                    mode=assignment.mode,
                    time_limit_seconds=assignment.time_limit_seconds,
                    parent_note=assignment.parent_note,
                    question_count=question_count,
                    latest_attempt_id=attempts[0].id if attempts else None,
                )
            )
        return summaries

    async def get_printable_assignment(
        self,
        assignment_id: str,
        parent_id: str,
    ) -> PrintableAssignment:
        assignment = self.assignments.get(assignment_id)
        if (
            assignment is None
            or parent_id
            not in self.family_parents.get(str(assignment.family_id), set())
        ):
            raise NotFoundError
        question_set = self.question_sets[str(assignment.question_set_id)]
        questions = sorted(
            (
                question
                for question in self.questions.values()
                if question.question_set_id == assignment.question_set_id
            ),
            key=lambda question: question.position,
        )
        return PrintableAssignment(
            assignment=assignment,
            title=question_set.title,
            questions=[
                QuestionView.model_validate(question.model_dump())
                for question in questions
            ],
        )

    async def save_response(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        request: SaveResponseRequest,
    ) -> SavedResponse:
        attempt = self.attempts.get(attempt_id)
        question = self.questions.get(question_id)
        if (
            attempt is None
            or question is None
            or str(attempt.child_id) != child_id
            or question.family_id != attempt.family_id
        ):
            raise NotFoundError
        if attempt.submitted_at is not None:
            raise SubmittedAttemptImmutable
        if self.assignments[str(attempt.assignment_id)].status not in {
            AssignmentStatus.IN_PROGRESS,
            AssignmentStatus.CORRECTING,
        }:
            raise NotFoundError
        if (attempt_id, question_id) in self.question_submissions:
            raise SubmittedQuestionImmutable

        key = (attempt_id, question_id)
        existing = self.responses.get(key)
        current_version = existing.version if existing is not None else 0
        if request.expected_version != current_version:
            raise ResponseVersionConflict(current_version)

        response_data = {
            "family_id": attempt.family_id,
            "attempt_id": attempt.id,
            "question_id": question.id,
            "kind": request.kind,
            "answer": request.answer,
            "version": current_version + 1,
        }
        if existing is not None:
            response_data["id"] = existing.id
        response = SavedResponse(**response_data)
        self.responses[key] = response
        previous_paths = _photo_paths(
            existing.kind if existing is not None else None,
            existing.answer if existing is not None else None,
        )
        next_paths = _photo_paths(request.kind, request.answer)
        if previous_paths != next_paths and (
            request.kind == ResponseKind.PHOTO
            or (existing is not None and existing.kind == ResponseKind.PHOTO)
        ):
            self.response_revisions.setdefault(attempt_id, []).append(
                ResponseRevision(
                    question_id=question.id,
                    question_position=question.position,
                    response_version=response.version,
                    change=_photo_revision_change(previous_paths, next_paths),
                    previous_page_count=len(previous_paths),
                    page_count=len(next_paths),
                    saved_at=response.saved_at,
                )
            )
        return response

    async def submit_question(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> QuestionSubmissionReceipt:
        attempt = self.attempts.get(attempt_id)
        question = self.questions.get(question_id)
        if (
            attempt is None
            or question is None
            or str(attempt.child_id) != child_id
            or question.family_id != attempt.family_id
        ):
            raise NotFoundError
        if attempt.submitted_at is not None:
            raise SubmittedAttemptImmutable
        if self.assignments[str(attempt.assignment_id)].status not in {
            AssignmentStatus.IN_PROGRESS,
            AssignmentStatus.CORRECTING,
        }:
            raise NotFoundError
        existing_job_id = self.question_submissions.get((attempt_id, question_id))
        if existing_job_id is not None:
            return QuestionSubmissionReceipt(
                attempt_id=attempt.id,
                question_id=question.id,
                job=self.jobs[existing_job_id],
            )
        if (attempt_id, question_id) not in self.responses:
            raise QuestionAnswerRequired
        job = Job(
            family_id=attempt.family_id,
            subject_id=attempt.id,
            payload={
                "scope": "question",
                "question_id": question_id,
                "idempotency_key": idempotency_key,
            },
        )
        self.jobs[str(job.id)] = job
        self.question_submissions[(attempt_id, question_id)] = str(job.id)
        return QuestionSubmissionReceipt(
            attempt_id=attempt.id,
            question_id=question.id,
            job=job,
        )

    async def regrade_question(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> QuestionSubmissionReceipt:
        attempt = self.attempts.get(attempt_id)
        question = self.questions.get(question_id)
        existing_results = self.question_results.get(attempt_id, [])
        has_result = any(
            str(result.question_id) == question_id for result in existing_results
        )
        if (
            attempt is None
            or question is None
            or str(attempt.child_id) != child_id
            or question.family_id != attempt.family_id
            or (attempt_id, question_id) not in self.responses
            or not has_result
        ):
            raise NotFoundError
        for job in self.jobs.values():
            if (
                str(job.subject_id) == attempt_id
                and job.payload.get("question_id") == question_id
                and job.payload.get("idempotency_key") == idempotency_key
            ):
                return QuestionSubmissionReceipt(
                    attempt_id=attempt.id,
                    question_id=question.id,
                    job=job,
                )
        current_job_id = self.question_submissions.get((attempt_id, question_id))
        current_job = (
            self.jobs.get(current_job_id) if current_job_id is not None else None
        )
        if current_job is not None and current_job.status in {
            JobStatus.QUEUED,
            JobStatus.RUNNING,
        }:
            return QuestionSubmissionReceipt(
                attempt_id=attempt.id,
                question_id=question.id,
                job=current_job,
            )
        job = Job(
            family_id=attempt.family_id,
            subject_id=attempt.id,
            payload={
                "scope": "question",
                "question_id": question_id,
                "idempotency_key": idempotency_key,
                "regrade": True,
            },
        )
        self.jobs[str(job.id)] = job
        self.question_submissions[(attempt_id, question_id)] = str(job.id)
        return QuestionSubmissionReceipt(
            attempt_id=attempt.id,
            question_id=question.id,
            job=job,
        )

    async def get_question_grading_job(
        self,
        attempt_id: str,
        question_id: str,
        job_id: str,
        child_id: str,
    ) -> Job:
        attempt = self.attempts.get(attempt_id)
        question = self.questions.get(question_id)
        job = self.jobs.get(job_id)
        if (
            attempt is None
            or question is None
            or job is None
            or str(attempt.child_id) != child_id
            or str(job.subject_id) != attempt_id
            or job.payload.get("question_id") != question_id
        ):
            raise NotFoundError
        return job

    async def submit_attempt(
        self,
        attempt_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> SubmissionReceipt:
        attempt = self.attempts.get(attempt_id)
        if attempt is None or str(attempt.child_id) != child_id:
            raise NotFoundError

        idempotency_record = (attempt_id, idempotency_key)
        existing_job_id = self.submission_idempotency.get(idempotency_record)
        assignment = self.assignments[str(attempt.assignment_id)]
        # A retry of the same submission must return its original receipt even
        # after the attempt became immutable.
        if existing_job_id is not None:
            return SubmissionReceipt(
                assignment=assignment,
                attempt=attempt,
                job=self.jobs[existing_job_id],
            )
        if attempt.submitted_at is not None:
            raise SubmittedAttemptImmutable
        if assignment.status not in {
            AssignmentStatus.IN_PROGRESS,
            AssignmentStatus.CORRECTING,
        }:
            raise NotFoundError
        attempt.submitted_at = datetime.now(UTC)
        assignment.status = AssignmentStatus.GRADING
        job = Job(
            family_id=attempt.family_id,
            subject_id=attempt.id,
        )
        self.attempts[attempt_id] = attempt
        self.assignments[str(assignment.id)] = assignment
        self.jobs[str(job.id)] = job
        self.submission_idempotency[idempotency_record] = str(job.id)
        return SubmissionReceipt(
            assignment=assignment,
            attempt=attempt,
            job=job,
        )

    async def retry_job(self, job_id: str, parent_id: str) -> Job:
        job = self.jobs.get(job_id)
        if (
            job is None
            or job.status != JobStatus.FAILED
            or parent_id
            not in self.family_parents.get(str(job.family_id), set())
        ):
            raise NotFoundError
        job.status = JobStatus.QUEUED
        job.attempt_count = 0
        job.completed_at = None
        self.jobs[job_id] = job
        return job

    def next_queued_job(self) -> Job | None:
        return next(
            (job for job in self.jobs.values() if job.status == JobStatus.QUEUED),
            None,
        )

    def responses_for_attempt(self, attempt_id: str) -> dict[str, SavedResponse]:
        return {
            question_id: response
            for (saved_attempt_id, question_id), response in self.responses.items()
            if saved_attempt_id == attempt_id
        }

    def questions_for_attempt(self, attempt_id: str) -> list[Question]:
        attempt = self.attempts[attempt_id]
        assignment = self.assignments[str(attempt.assignment_id)]
        return sorted(
            (
                question
                for question in self.questions.values()
                if question.question_set_id == assignment.question_set_id
            ),
            key=lambda question: question.position,
        )

    def complete_grading(
        self,
        job: Job,
        results: list[QuestionResult],
    ) -> Job:
        existing_results = self.question_results.get(str(job.subject_id), [])
        existing_by_question = {
            str(result.question_id): result for result in existing_results
        }
        stable_results = [
            result.model_copy(
                update={"id": existing_by_question[str(result.question_id)].id}
            )
            if str(result.question_id) in existing_by_question
            else result
            for result in results
        ]
        graded_question_ids = {
            str(result.question_id) for result in stable_results
        }
        self.question_results[str(job.subject_id)] = [
            result
            for result in existing_results
            if str(result.question_id) not in graded_question_ids
        ] + stable_results
        self.jobs[str(job.id)] = job
        attempt = self.attempts[str(job.subject_id)]
        assignment = self.assignments[str(attempt.assignment_id)]
        if attempt.submitted_at is not None:
            assignment.status = AssignmentStatus.RESULTS_READY
        self.assignments[str(assignment.id)] = assignment
        for result in stable_results:
            if result.outcome.value != "incorrect":
                continue
            question = self.questions[str(result.question_id)]
            item = ReviewItemView(
                id=result.id,
                child_id=attempt.child_id,
                source_question_id=result.question_id,
                prompt=question.prompt,
                due_on=(datetime.now(UTC) + timedelta(days=1)).date(),
                interval_days=1,
                level="standard",
            )
            self.review_items[str(item.id)] = item
        return job

    async def list_due_reviews(self, child_id: str) -> list[ReviewItemView]:
        today = datetime.now(UTC).date()
        return [
            item
            for item in self.review_items.values()
            if str(item.child_id) == child_id and item.due_on <= today
        ][:10]

    async def skip_today_reviews(self, child_id: str) -> list[ReviewCompletion]:
        today = datetime.now(UTC).date()
        next_due = today + timedelta(days=1)
        skipped: list[ReviewCompletion] = []
        for item_id, item in self.review_items.items():
            if str(item.child_id) != child_id or item.due_on > today:
                continue
            self.review_items[item_id] = item.model_copy(
                update={"due_on": next_due}
            )
            skipped.append(
                ReviewCompletion(
                    item_id=item.id,
                    old_interval_days=item.interval_days,
                    new_interval_days=item.interval_days,
                    next_due_on=next_due,
                )
            )
        return skipped

    async def list_child_history(self, child_id: str) -> list[HistoryItem]:
        child = self.children.get(child_id)
        if child is None:
            raise NotFoundError
        items: list[HistoryItem] = []
        for assignment in self.assignments.values():
            if str(assignment.child_id) != child_id:
                continue
            attempts = [
                attempt
                for attempt in self.attempts.values()
                if attempt.assignment_id == assignment.id
            ]
            attempt = max(attempts, key=lambda item: item.sequence, default=None)
            question_set = self.question_sets[str(assignment.question_set_id)]
            questions = [
                question
                for question in self.questions.values()
                if question.question_set_id == assignment.question_set_id
            ]
            results = (
                self.question_results.get(str(attempt.id), [])
                if attempt is not None
                else []
            )
            items.append(
                HistoryItem(
                    assignment_id=assignment.id,
                    attempt_id=attempt.id if attempt else None,
                    child_id=child.id,
                    child_nickname=child.nickname,
                    title=question_set.title,
                    status=assignment.status,
                    submitted_at=attempt.submitted_at if attempt else None,
                    awarded_points=sum(
                        result.awarded_points or 0 for result in results
                    ),
                    available_points=sum(question.points for question in questions),
                    correction_count=sum(
                        result.outcome.value != "correct" for result in results
                    ),
                )
            )
        return items

    async def list_family_history(
        self,
        family_id: str,
        parent_id: str,
    ) -> list[ParentHistoryItem]:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        items: list[ParentHistoryItem] = []
        for child in self.children.values():
            if str(child.family_id) == family_id:
                for item in await self.list_child_history(str(child.id)):
                    assignment = self.assignments[str(item.assignment_id)]
                    question_set = self.question_sets[str(assignment.question_set_id)]
                    items.append(
                        ParentHistoryItem(
                            **item.model_dump(),
                            source_material_title=question_set.source_summary.get(
                                "source_material_title"
                            ),
                            source_material_subject=question_set.source_summary.get(
                                "source_material_subject"
                            ),
                        )
                    )
        return items

    async def create_deletion_request(
        self,
        request: CreateDeletionRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> DeletionRequestView:
        family_id = str(request.family_id)
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        if request.target_type == "family" and request.target_id != request.family_id:
            raise NotFoundError
        if request.target_type == "child":
            child = self.children.get(str(request.target_id))
            if child is None or child.family_id != request.family_id:
                raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing_id = self.deletion_idempotency.get(record_key)
        if existing_id is not None:
            return self.deletion_requests[existing_id]
        deletion = DeletionRequestView(
            family_id=request.family_id,
            target_type=request.target_type,
            target_id=request.target_id,
            requested_at=datetime.now(UTC),
            purge_after=datetime.now(UTC) + timedelta(days=30),
        )
        self.deletion_requests[str(deletion.id)] = deletion
        self.deletion_idempotency[record_key] = str(deletion.id)
        return deletion

    async def restore_deletion_request(
        self,
        deletion_id: str,
        parent_id: str,
    ) -> DeletionRequestView:
        deletion = self.deletion_requests.get(deletion_id)
        if (
            deletion is None
            or parent_id
            not in self.family_parents.get(str(deletion.family_id), set())
            or deletion.restored_at is not None
        ):
            raise NotFoundError
        restored = deletion.model_copy(
            update={"restored_at": datetime.now(UTC)}
        )
        self.deletion_requests[deletion_id] = restored
        return restored

    async def complete_review(
        self,
        item_id: str,
        child_id: str,
        request: CompleteReviewRequest,
    ) -> ReviewCompletion:
        item = self.review_items.get(item_id)
        if item is None or str(item.child_id) != child_id:
            raise NotFoundError
        old_interval = item.interval_days
        intervals = [1, 3, 7, 14, 30]
        if request.outcome == "incorrect":
            new_interval = 1
        else:
            current_index = intervals.index(old_interval)
            new_interval = intervals[min(current_index + 1, len(intervals) - 1)]
        next_due = datetime.now(UTC).date() + timedelta(days=new_interval)
        self.review_items[item_id] = item.model_copy(
            update={"interval_days": new_interval, "due_on": next_due}
        )
        return ReviewCompletion(
            item_id=item.id,
            old_interval_days=old_interval,
            new_interval_days=new_interval,
            next_due_on=next_due,
        )

    async def get_attempt_results(
        self,
        attempt_id: str,
        child_id: str,
    ) -> AttemptResults:
        attempt = self.attempts.get(attempt_id)
        if attempt is None or str(attempt.child_id) != child_id:
            raise NotFoundError
        results = self.question_results.get(attempt_id, [])
        questions = self.questions_for_attempt(attempt_id)
        question_by_id = {str(question.id): question for question in questions}
        visible_results = []
        for result in results:
            listening = question_by_id.get(str(result.question_id))
            transcript = (
                listening.listening.transcript
                if listening is not None
                and listening.listening is not None
                and listening.listening.transcript_policy
                in {"always", "after_submission"}
                else None
            )
            visible_results.append(result.model_copy(update={"transcript": transcript}))
        return AttemptResults(
            attempt_id=attempt.id,
            complete=len(visible_results) == len(questions),
            results=visible_results,
        )

    async def get_parent_attempt_review(
        self,
        attempt_id: str,
        parent_id: str,
    ) -> ParentAttemptReview:
        attempt = self.attempts.get(attempt_id)
        if (
            attempt is None
            or parent_id
            not in self.family_parents.get(str(attempt.family_id), set())
        ):
            raise NotFoundError
        assignment = self.assignments[str(attempt.assignment_id)]
        child = self.children[str(attempt.child_id)]
        question_set = self.question_sets[str(assignment.question_set_id)]
        questions = sorted(
            self.questions_for_attempt(attempt_id),
            key=lambda question: question.position,
        )
        results = {
            str(result.question_id): result
            for result in self.question_results.get(attempt_id, [])
        }
        reviews: list[ParentReviewItem] = []
        awarded_points = 0.0
        correct_count = 0
        correction_count = 0
        for question in questions:
            result = results.get(str(question.id))
            if result is None:
                continue
            decision = self.parent_decisions.get(str(result.id))
            final_outcome = (
                decision.parent_outcome if decision is not None else result.outcome
            )
            final_points = (
                decision.parent_awarded_points
                if decision is not None
                else result.awarded_points
            )
            awarded_points += final_points or 0
            correct_count += final_outcome == "correct"
            correction_count += final_outcome == "incorrect"
            if (
                decision is None
                and result.outcome
                in {"uncertain", "needs_parent_review"}
            ):
                response = self.responses.get((attempt_id, str(question.id)))
                if response is not None:
                    reviews.append(
                        ParentReviewItem(
                            result_id=result.id,
                            question_id=question.id,
                            question_position=question.position,
                            question_prompt=question.prompt,
                            question_type=question.type,
                            question_points=question.points,
                            response_kind=response.kind,
                            response_answer=response.answer,
                            photo_urls=[],
                            automated_outcome=result.outcome,
                            automated_feedback=result.feedback,
                        )
                    )
        return ParentAttemptReview(
            attempt_id=attempt.id,
            child_nickname=child.nickname,
            title=question_set.title,
            source_material_title=question_set.source_summary.get(
                "source_material_title"
            ),
            source_material_subject=question_set.source_summary.get(
                "source_material_subject"
            ),
            complete=len(results) == len(questions),
            awarded_points=awarded_points,
            available_points=sum(question.points for question in questions),
            correct_count=correct_count,
            correction_count=correction_count,
            pending_review_count=len(reviews),
            reviews=reviews,
            response_revisions=list(
                reversed(self.response_revisions.get(attempt_id, []))
            ),
        )

    async def create_correction(
        self,
        attempt_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> AssignmentWork:
        original = self.attempts.get(attempt_id)
        if (
            original is None
            or original.submitted_at is None
            or str(original.child_id) != child_id
        ):
            raise NotFoundError
        record_key = (attempt_id, idempotency_key)
        existing_id = self.correction_idempotency.get(record_key)
        if existing_id is not None:
            correction = self.attempts[existing_id]
        else:
            sequence = (
                max(
                    (
                        attempt.sequence
                        for attempt in self.attempts.values()
                        if attempt.assignment_id == original.assignment_id
                    ),
                    default=0,
                )
                + 1
            )
            correction = Attempt(
                family_id=original.family_id,
                assignment_id=original.assignment_id,
                child_id=original.child_id,
                sequence=sequence,
            )
            self.attempts[str(correction.id)] = correction
            self.correction_idempotency[record_key] = str(correction.id)
            result_ids: set[str] = set()
            for result in self.question_results.get(attempt_id, []):
                decision = self.parent_decisions.get(str(result.id))
                final_outcome = (
                    decision.parent_outcome
                    if decision is not None
                    else result.outcome
                )
                if final_outcome in {
                    "incorrect",
                    "uncertain",
                    "needs_parent_review",
                }:
                    result_ids.add(str(result.question_id))
            self.correction_question_ids[str(correction.id)] = result_ids
        assignment = self.assignments[str(original.assignment_id)]
        assignment.status = AssignmentStatus.CORRECTING
        questions = [
            question
            for question in self.questions_for_attempt(attempt_id)
            if str(question.id)
            in self.correction_question_ids.get(str(correction.id), set())
        ]
        if not questions:
            raise NotFoundError
        return AssignmentWork(
            title=self.question_sets[str(assignment.question_set_id)].title,
            assignment=assignment,
            attempt=correction,
            questions=[
                QuestionView.model_validate(question.model_dump())
                for question in questions
            ],
            responses=list(
                self.responses_for_attempt(str(correction.id)).values()
            ),
        )

    async def create_question_retry(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
        idempotency_key: str,
    ) -> AssignmentWork:
        original = self.attempts.get(attempt_id)
        result = next(
            (
                item
                for item in self.question_results.get(attempt_id, [])
                if str(item.question_id) == question_id
            ),
            None,
        )
        if original is None or result is None or str(original.child_id) != child_id:
            raise NotFoundError
        record_key = (
            f"question-retry:{attempt_id}:{question_id}",
            idempotency_key,
        )
        existing_id = self.correction_idempotency.get(record_key)
        if existing_id is not None:
            retry = self.attempts[existing_id]
        else:
            sequence = (
                max(
                    (
                        attempt.sequence
                        for attempt in self.attempts.values()
                        if attempt.assignment_id == original.assignment_id
                    ),
                    default=0,
                )
                + 1
            )
            retry = Attempt(
                family_id=original.family_id,
                assignment_id=original.assignment_id,
                child_id=original.child_id,
                sequence=sequence,
            )
            self.attempts[str(retry.id)] = retry
            self.correction_idempotency[record_key] = str(retry.id)
            self.correction_question_ids[str(retry.id)] = {question_id}
        assignment = self.assignments[str(original.assignment_id)]
        assignment.status = AssignmentStatus.CORRECTING
        question = next(
            (
                item
                for item in self.questions_for_attempt(attempt_id)
                if str(item.id) == question_id
            ),
            None,
        )
        if question is None:
            raise NotFoundError
        return AssignmentWork(
            title=self.question_sets[str(assignment.question_set_id)].title,
            assignment=assignment,
            attempt=retry,
            questions=[
                _question_view(
                    question,
                    play_count=self.listening_play_counts.get(
                        (str(retry.id), str(question.id)), 0
                    ),
                )
            ],
            responses=list(self.responses_for_attempt(str(retry.id)).values()),
        )

    async def get_attempt_work(
        self,
        attempt_id: str,
        child_id: str,
    ) -> AssignmentWork:
        attempt = self.attempts.get(attempt_id)
        if (
            attempt is None
            or attempt.submitted_at is not None
            or str(attempt.child_id) != child_id
            or self.assignments[str(attempt.assignment_id)].status
            not in {AssignmentStatus.IN_PROGRESS, AssignmentStatus.CORRECTING}
        ):
            raise NotFoundError
        assignment = self.assignments[str(attempt.assignment_id)]
        questions = self.questions_for_attempt(attempt_id)
        correction_ids = self.correction_question_ids.get(attempt_id)
        if correction_ids is not None:
            questions = [
                question
                for question in questions
                if str(question.id) in correction_ids
            ]
        return AssignmentWork(
            title=self.question_sets[str(assignment.question_set_id)].title,
            assignment=assignment,
            attempt=attempt,
            questions=[
                _question_view(
                    question,
                    play_count=self.listening_play_counts.get(
                        (attempt_id, str(question.id)), 0
                    ),
                )
                for question in questions
            ],
            responses=list(self.responses_for_attempt(attempt_id).values()),
            submitted_question_ids=[
                UUID(question_id)
                for saved_attempt_id, question_id in self.question_submissions
                if saved_attempt_id == attempt_id
            ],
        )

    async def record_listening_playback(
        self,
        attempt_id: str,
        question_id: str,
        child_id: str,
    ) -> ListeningPlaybackReceipt:
        attempt = self.attempts.get(attempt_id)
        question = self.questions.get(question_id)
        if (
            attempt is None
            or question is None
            or attempt.submitted_at is not None
            or str(attempt.child_id) != child_id
            or question.question_set_id
            != self.assignments[str(attempt.assignment_id)].question_set_id
            or question.type != QuestionType.LISTENING
            or question.listening is None
        ):
            raise NotFoundError
        key = (attempt_id, question_id)
        play_count = self.listening_play_counts.get(key, 0)
        if play_count >= question.listening.replay_limit:
            raise ListeningReplayLimitReached
        next_count = play_count + 1
        self.listening_play_counts[key] = next_count
        return ListeningPlaybackReceipt(
            question_id=question.id,
            play_count=next_count,
            replay_limit=question.listening.replay_limit,
            audio_url=f"fixture://private-audio/{question.id}",
        )

    async def create_import(
        self,
        request: CreateImportRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> QuestionSetImport:
        family_id = str(request.family_id)
        if family_id not in self.families:
            raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing_id = self.import_idempotency.get(record_key)
        if existing_id is not None:
            return self.imports[existing_id]

        is_lesson_one = matches_lesson_one_import(
            request.filenames,
            request.answer_filenames,
        )
        question_set = QuestionSet(
            family_id=request.family_id,
            title=request.title,
            subject=request.subject,
            status=QuestionSetStatus.NEEDS_REVIEW,
            source_summary=(
                lesson_one_source_summary(len(request.reference_filenames))
                if is_lesson_one
                else {}
            ),
        )
        if is_lesson_one:
            questions = [
                Question(
                    family_id=request.family_id,
                    question_set_id=question_set.id,
                    position=position,
                    type=spec.type,
                    prompt=spec.prompt,
                    options=list(spec.options) if spec.options else None,
                    answer_key=spec.answer_key,
                    points=spec.points,
                )
                for position, spec in enumerate(
                    lesson_one_question_specs(),
                    start=1,
                )
            ]
        else:
            questions = [
                Question(
                    family_id=request.family_id,
                    question_set_id=question_set.id,
                    position=1,
                    type=QuestionType.SINGLE_CHOICE,
                    prompt="Choose the sentence that uses the present simple correctly.",
                    options=[
                        "She walk to school every day.",
                        "She walks to school every day.",
                        "She walking to school every day.",
                    ],
                    answer_key={"choice": 1},
                ),
                Question(
                    family_id=request.family_id,
                    question_set_id=question_set.id,
                    position=2,
                    type=QuestionType.TYPED_TEXT,
                    prompt="Complete: My brother ___ tennis on Sundays.",
                    answer_key={"text": "plays"},
                ),
                Question(
                    family_id=request.family_id,
                    question_set_id=question_set.id,
                    position=3,
                    type=QuestionType.HANDWRITING,
                    prompt="Write one similar sentence and underline the verb.",
                    answer_key={"reference": "A grammatical present-simple sentence."},
                    points=2,
                ),
            ]
        imported = QuestionSetImport(
            family_id=request.family_id,
            question_set_id=question_set.id,
            filenames=request.filenames,
            source_paths=request.source_paths,
            answer_filenames=request.answer_filenames,
            answer_source_paths=request.answer_source_paths,
            reference_filenames=request.reference_filenames,
            reference_source_paths=request.reference_source_paths,
            purpose=request.purpose,
        )
        self.question_sets[str(question_set.id)] = question_set
        self.questions.update({str(question.id): question for question in questions})
        self.imports[str(imported.id)] = imported
        self.import_idempotency[record_key] = str(imported.id)
        return imported

    async def create_completed_worksheet_import(
        self,
        request: CreateCompletedWorksheetRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> CompletedWorksheetImport:
        family_id = str(request.family_id)
        child = self.children.get(str(request.child_id))
        if (
            family_id not in self.families
            or parent_id not in self.family_parents.get(family_id, set())
            or child is None
            or child.family_id != request.family_id
        ):
            raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing_id = self.completed_worksheet_idempotency.get(record_key)
        if existing_id is not None:
            return self.completed_worksheet_imports[existing_id]

        worksheet_id = uuid4()
        job = Job(
            family_id=request.family_id,
            subject_id=worksheet_id,
            type="analyze_completed_worksheet",
            payload={"schema_version": "1.0"},
        )
        imported = CompletedWorksheetImport(
            id=worksheet_id,
            family_id=request.family_id,
            child_id=request.child_id,
            title=request.title,
            subject=request.subject,
            document_language=request.document_language,
            feedback_language=request.feedback_language,
            filenames=request.filenames,
            response_paths=request.response_paths,
            answer_source_paths=request.answer_source_paths,
            reference_source_paths=request.reference_source_paths,
            job=job,
        )
        self.completed_worksheet_imports[str(imported.id)] = imported
        self.completed_worksheet_idempotency[record_key] = str(imported.id)
        self.jobs[str(job.id)] = job
        return imported

    def complete_completed_worksheet_analysis(self, job: Job) -> Job:
        imported = self.completed_worksheet_imports.get(str(job.subject_id))
        if imported is None:
            raise NotFoundError
        imported.status = CompletedWorksheetStatus.NEEDS_REVIEW
        imported.job = job
        self.completed_worksheet_imports[str(imported.id)] = imported
        self.jobs[str(job.id)] = job
        return job

    async def get_completed_worksheet_import(
        self,
        worksheet_id: str,
        parent_id: str,
    ) -> CompletedWorksheetImport:
        imported = self.completed_worksheet_imports.get(worksheet_id)
        if (
            imported is None
            or parent_id not in self.family_parents.get(str(imported.family_id), set())
        ):
            raise NotFoundError
        job = self.jobs.get(str(imported.job.id))
        if job is None:
            raise NotFoundError
        imported.job = job
        return imported

    async def import_structured_question_set(
        self,
        document: ImportDocument,
        *,
        family_id: UUID,
        child_id: UUID,
        source_name: str,
        parent_id: str,
        assign: bool = True,
        assignment_mode: str = "practice",
        time_limit_seconds: int | None = None,
        parent_note: str | None = None,
    ) -> ImportResult:
        family_key = str(family_id)
        child_key = str(child_id)
        child = self.children.get(child_key)
        if (
            family_key not in self.families
            or parent_id not in self.family_parents.get(family_key, set())
            or child is None
            or child.family_id != family_id
        ):
            raise NotFoundError

        checksum = document_checksum(document)
        record_key = (family_key, checksum)
        existing_set_id = self.structured_imports.get(record_key)
        if existing_set_id is not None:
            question_set = self.question_sets[existing_set_id]
            assignment = next(
                (
                    candidate
                    for candidate in self.assignments.values()
                    if str(candidate.question_set_id) == existing_set_id
                    and candidate.child_id == child_id
                ),
                None,
            )
            if assignment is None and assign:
                assignment = Assignment(
                    family_id=family_id,
                    question_set_id=question_set.id,
                    child_id=child_id,
                    mode=assignment_mode,
                    time_limit_seconds=time_limit_seconds,
                    parent_note=parent_note,
                )
                self.assignments[str(assignment.id)] = assignment
            return ImportResult(
                question_set_id=question_set.id,
                assignment_id=assignment.id if assignment is not None else None,
                family_id=family_id,
                family_name=self.families[family_key].name,
                child_id=child_id,
                child_nickname=child.nickname,
                question_count=sum(
                    question.question_set_id == question_set.id
                    for question in self.questions.values()
                ),
                total_points=document.total_points,
                status="confirmed",
                reused_existing=True,
                checksum=checksum,
            )

        question_set = QuestionSet(
            family_id=family_id,
            title=document.question_set.title,
            subject=document.question_set.subject,
            status=QuestionSetStatus.CONFIRMED,
            source_summary={
                **document.question_set.source_summary,
                "schema_version": document.schema_version,
                "import_checksum": checksum,
                "imported_via": "parent_json_upload",
                "original_json_filename": source_name,
                "question_count": document.question_count,
                "total_points": float(document.total_points),
                "estimated_minutes": document.question_set.estimated_minutes,
                "answer_keys_present": True,
            },
        )
        self.question_sets[str(question_set.id)] = question_set
        for item in document.questions:
            listening = None
            if item.type == QuestionType.LISTENING:
                if item.listening is None:
                    raise ValueError(
                        f"Listening question {item.position} needs a private audio file."
                    )
                listening = item.listening.private_config()
                if (family_key, listening.audio_path) not in self.private_audio_paths:
                    raise ValueError(
                        "A listening audio file is not available to this family."
                    )
            question = Question(
                family_id=family_id,
                question_set_id=question_set.id,
                position=item.position,
                type=item.type,
                prompt=item.prompt,
                options=item.options or None,
                answer_key=item.answer_key,
                points=float(item.points),
                listening=listening,
            )
            self.questions[str(question.id)] = question
        assignment = None
        if assign:
            assignment = Assignment(
                family_id=family_id,
                question_set_id=question_set.id,
                child_id=child_id,
                mode=assignment_mode,
                time_limit_seconds=time_limit_seconds,
                parent_note=parent_note,
            )
            self.assignments[str(assignment.id)] = assignment
        self.structured_imports[record_key] = str(question_set.id)
        return ImportResult(
            question_set_id=question_set.id,
            assignment_id=assignment.id if assignment is not None else None,
            family_id=family_id,
            family_name=self.families[family_key].name,
            child_id=child_id,
            child_nickname=child.nickname,
            question_count=document.question_count,
            total_points=document.total_points,
            status="confirmed",
            reused_existing=False,
            checksum=checksum,
        )

    async def confirm_completed_worksheet_import(
        self,
        worksheet_id: str,
        *,
        document: ImportDocument,
        responses: list[CompletedWorksheetResponseInput],
        idempotency_key: str,
        parent_id: str,
    ) -> CompletedWorksheetConfirmation:
        imported = await self.get_completed_worksheet_import(worksheet_id, parent_id)
        if imported.status != CompletedWorksheetStatus.NEEDS_REVIEW:
            if imported.assignment_id is None or imported.attempt_id is None:
                raise NotFoundError
            assignment = self.assignments[str(imported.assignment_id)]
            attempt = self.attempts[str(imported.attempt_id)]
            job = next(
                (
                    candidate
                    for candidate in self.jobs.values()
                    if candidate.type == "grade_submission"
                    and candidate.subject_id == attempt.id
                ),
                None,
            )
            if job is None:
                raise NotFoundError
            return CompletedWorksheetConfirmation(
                completed_worksheet=imported,
                question_set_id=assignment.question_set_id,
                assignment=assignment,
                attempt=attempt,
                grading_job=job,
            )

        imported_result = await self.import_structured_question_set(
            document,
            family_id=imported.family_id,
            child_id=imported.child_id,
            source_name=f"completed-worksheet:{imported.id}",
            parent_id=parent_id,
            assign=False,
        )
        assignment = Assignment(
            family_id=imported.family_id,
            question_set_id=imported_result.question_set_id,
            child_id=imported.child_id,
            # This is an already-completed paper. It enters the normal
            # submission transition without exposing an editable task.
            status=AssignmentStatus.IN_PROGRESS,
        )
        self.assignments[str(assignment.id)] = assignment
        attempt = Attempt(
            family_id=imported.family_id,
            assignment_id=assignment.id,
            child_id=imported.child_id,
        )
        self.attempts[str(attempt.id)] = attempt
        questions = sorted(
            (
                question
                for question in self.questions.values()
                if question.question_set_id == assignment.question_set_id
            ),
            key=lambda question: question.position,
        )
        for question, response in zip(questions, responses, strict=True):
            self.responses[(str(attempt.id), str(question.id))] = SavedResponse(
                family_id=attempt.family_id,
                attempt_id=attempt.id,
                question_id=question.id,
                kind=response.kind,
                answer={
                    **response.answer,
                    "source_paths": imported.response_paths,
                },
            )
        receipt = await self.submit_attempt(
            str(attempt.id),
            str(imported.child_id),
            f"completed-worksheet:{imported.id}:{idempotency_key}",
        )
        imported.status = CompletedWorksheetStatus.GRADING
        imported.assignment_id = assignment.id
        imported.attempt_id = attempt.id
        self.completed_worksheet_imports[str(imported.id)] = imported
        return CompletedWorksheetConfirmation(
            completed_worksheet=imported,
            question_set_id=assignment.question_set_id,
            assignment=receipt.assignment,
            attempt=receipt.attempt,
            grading_job=receipt.job,
        )

    async def get_question_set_draft(
        self,
        question_set_id: str,
        parent_id: str,
    ) -> QuestionSetDraft:
        question_set = self.question_sets.get(question_set_id)
        if question_set is None:
            raise NotFoundError
        questions = sorted(
            (
                question
                for question in self.questions.values()
                if str(question.question_set_id) == question_set_id
            ),
            key=lambda question: question.position,
        )
        return QuestionSetDraft(question_set=question_set, questions=questions)

    async def list_family_question_sets(
        self,
        family_id: str,
        parent_id: str,
    ) -> list[FamilyLibraryQuestionSet]:
        if (
            family_id not in self.families
            or parent_id not in self.family_parents.get(family_id, set())
        ):
            raise NotFoundError
        return [
            FamilyLibraryQuestionSet(
                id=question_set.id,
                family_id=question_set.family_id,
                title=question_set.title,
                subject=question_set.subject,
                status=question_set.status,
                question_count=sum(
                    question.question_set_id == question_set.id
                    for question in self.questions.values()
                ),
                source_summary=question_set.source_summary,
            )
            for question_set in reversed(list(self.question_sets.values()))
            if str(question_set.family_id) == family_id
        ]

    async def list_family_library_submissions(
        self,
        family_id: str,
        parent_id: str,
    ) -> list[LibrarySubmission]:
        if (
            family_id not in self.families
            or parent_id not in self.family_parents.get(family_id, set())
        ):
            raise NotFoundError
        return sorted(
            (
                submission
                for submission in self.library_submissions.values()
                if str(submission.family_id) == family_id
            ),
            key=lambda submission: submission.created_at,
            reverse=True,
        )

    async def list_pending_library_review_submissions(
        self,
    ) -> list[LibraryReviewSubmission]:
        return sorted(
            (
                LibraryReviewSubmission(
                    id=submission.id,
                    question_set_id=submission.question_set_id,
                    title=self.question_sets[str(submission.question_set_id)].title,
                    subject=self.question_sets[str(submission.question_set_id)].subject,
                    question_count=sum(
                        question.question_set_id == submission.question_set_id
                        for question in self.questions.values()
                    ),
                    created_at=submission.created_at,
                )
                for submission in self.library_submissions.values()
                if submission.status == "pending_review"
            ),
            key=lambda submission: submission.created_at,
            reverse=True,
        )

    async def list_public_library_items(self) -> list[PublicLibraryItem]:
        items: list[PublicLibraryItem] = []
        for submission_id, item in self.library_items.items():
            submission = self.library_submissions.get(submission_id)
            if submission is None or submission.status != "published":
                continue
            metadata = item["metadata"]
            item_id = item.get("id")
            revision = item.get("revision")
            if (
                not isinstance(metadata, dict)
                or not isinstance(item_id, UUID)
                or not isinstance(revision, int)
            ):
                continue
            items.append(
                PublicLibraryItem(
                    id=item_id,
                    title=str(metadata["title"]),
                    subject=str(metadata["subject"]),
                    question_count=int(metadata["question_count"]),
                    revision=revision,
                    published_at=submission.published_at or submission.created_at,
                )
            )
        return sorted(items, key=lambda item: item.published_at, reverse=True)

    async def copy_public_library_item(
        self,
        library_item_id: str,
        family_id: UUID,
        idempotency_key: str,
        parent_id: str,
    ) -> PublicLibraryCopy:
        family_key = str(family_id)
        if (
            family_key not in self.families
            or parent_id not in self.family_parents.get(family_key, set())
        ):
            raise NotFoundError

        item = next(
            (
                candidate
                for candidate in self.library_items.values()
                if str(candidate["id"]) == library_item_id
            ),
            None,
        )
        if item is None:
            raise NotFoundError
        item_id = item.get("id")
        revision = item.get("revision")
        if not isinstance(item_id, UUID) or not isinstance(revision, int):
            raise NotFoundError
        submission = self.library_submissions.get(str(item["submission_id"]))
        if submission is None or submission.status != "published":
            raise NotFoundError

        record_key = (library_item_id, idempotency_key)
        existing_set_id = self.library_copy_idempotency.get(record_key)
        if existing_set_id is not None:
            question_set = self.question_sets[existing_set_id]
            return PublicLibraryCopy(
                library_item_id=item_id,
                library_revision=revision,
                question_set_id=question_set.id,
                family_id=family_id,
                question_count=sum(
                    question.question_set_id == question_set.id
                    for question in self.questions.values()
                ),
                reused_existing=True,
            )

        existing_question_set = next(
            (
                question_set
                for question_set in self.question_sets.values()
                if question_set.family_id == family_id
                and question_set.source_summary.get("public_library_item_id")
                == library_item_id
                and question_set.source_summary.get("public_library_revision") == revision
            ),
            None,
        )
        if existing_question_set is not None:
            self.library_copy_idempotency[record_key] = str(existing_question_set.id)
            return PublicLibraryCopy(
                library_item_id=item_id,
                library_revision=revision,
                question_set_id=existing_question_set.id,
                family_id=family_id,
                question_count=sum(
                    question.question_set_id == existing_question_set.id
                    for question in self.questions.values()
                ),
                reused_existing=True,
            )

        private_content = item.get("private_content")
        snapshot = item.get("snapshot")
        if not isinstance(private_content, dict) or not isinstance(snapshot, dict):
            raise NotFoundError
        private_questions = private_content.get("questions")
        public_questions = snapshot.get("questions")
        private_question_set = private_content.get("question_set")
        public_question_set = snapshot.get("question_set")
        if (
            not isinstance(private_questions, list)
            or not isinstance(public_questions, list)
            or not isinstance(private_question_set, dict)
            or not isinstance(public_question_set, dict)
            or len(private_questions) != len(public_questions)
        ):
            raise NotFoundError

        question_set = QuestionSet(
            family_id=family_id,
            title=str(public_question_set["title"]),
            subject=str(public_question_set["subject"]),
            status=QuestionSetStatus.CONFIRMED,
            source_summary={
                "imported_via": "public_library_copy",
                "public_library_item_id": library_item_id,
                "public_library_revision": revision,
                "question_count": len(public_questions),
                "answer_keys_present": True,
            },
        )
        self.question_sets[str(question_set.id)] = question_set
        public_by_position = {
            int(question["position"]): question
            for question in public_questions
            if isinstance(question, dict)
        }
        for private_question in private_questions:
            if not isinstance(private_question, dict):
                raise NotFoundError
            position = int(private_question["position"])
            public_question = public_by_position.get(position)
            if public_question is None:
                raise NotFoundError
            question = Question(
                family_id=family_id,
                question_set_id=question_set.id,
                position=position,
                type=private_question["type"],
                prompt=str(public_question["prompt"]),
                options=public_question.get("options"),
                answer_key=private_question["answer_key"],
                points=float(private_question["points"]),
            )
            self.questions[str(question.id)] = question

        self.library_copy_idempotency[record_key] = str(question_set.id)
        return PublicLibraryCopy(
            library_item_id=item_id,
            library_revision=revision,
            question_set_id=question_set.id,
            family_id=family_id,
            question_count=len(public_questions),
        )

    async def confirm_question_set(
        self,
        question_set_id: str,
        idempotency_key: str,
        parent_id: str,
    ) -> QuestionSet:
        question_set = self.question_sets.get(question_set_id)
        if question_set is None:
            raise NotFoundError
        record_key = (question_set_id, idempotency_key)
        if record_key not in self.confirm_idempotency:
            question_set.status = QuestionSetStatus.CONFIRMED
            self.question_sets[question_set_id] = question_set
            self.confirm_idempotency[record_key] = question_set_id
        return question_set

    async def assign_question_set(
        self,
        question_set_id: str,
        request: CreateAssignmentRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> Assignment:
        question_set = self.question_sets.get(question_set_id)
        child = self.children.get(str(request.child_id))
        if (
            question_set is None
            or child is None
            or question_set.status != QuestionSetStatus.CONFIRMED
            or child.family_id != question_set.family_id
        ):
            raise NotFoundError
        record_key = (question_set_id, idempotency_key)
        existing_id = self.assignment_idempotency.get(record_key)
        if existing_id is not None:
            return self.assignments[existing_id]
        assignment = Assignment(
            family_id=question_set.family_id,
            question_set_id=question_set.id,
            child_id=request.child_id,
            mode=request.mode,
            time_limit_seconds=request.time_limit_seconds,
            parent_note=request.parent_note,
        )
        self.assignments[str(assignment.id)] = assignment
        self.assignment_idempotency[record_key] = str(assignment.id)
        return assignment

    async def create_upload_intent(
        self,
        request: CreateUploadIntentRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> UploadIntent:
        family_id = str(request.family_id)
        if family_id not in self.families:
            raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing = self.upload_intents.get(record_key)
        if existing is not None:
            return existing
        safe_name = Path(request.filename).name.replace(" ", "-").lower()
        path = f"{family_id}/{request.object_id}/{safe_name}"
        intent = UploadIntent(
            bucket=request.bucket,
            path=path,
            upload_url=f"fixture://private-upload/{request.bucket}/{path}",
        )
        self.upload_intents[record_key] = intent
        if request.bucket.value == "audio":
            self.private_audio_paths.add((family_id, path))
        return intent

    async def create_child_upload_intent(
        self,
        request: CreateUploadIntentRequest,
        child_id: str,
        idempotency_key: str,
    ) -> UploadIntent:
        child = self.children.get(child_id)
        attempt = self.attempts.get(str(request.object_id))
        if (
            child is None
            or attempt is None
            or str(attempt.child_id) != child_id
            or child.family_id != request.family_id
            or request.bucket.value != "responses"
        ):
            raise NotFoundError
        return await self.create_upload_intent(
            request,
            idempotency_key,
            "child-session",
        )

    async def create_library_submission(
        self,
        request: CreateLibrarySubmissionRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> LibrarySubmission:
        question_set = self.question_sets.get(str(request.question_set_id))
        if (
            question_set is None
            or question_set.family_id != request.family_id
            or str(request.family_id) not in self.families
            or parent_id
            not in self.family_parents.get(str(request.family_id), set())
            or question_set.status != QuestionSetStatus.CONFIRMED
        ):
            raise NotFoundError
        if any(
            question.question_set_id == question_set.id
            and question.type == QuestionType.LISTENING
            for question in self.questions.values()
        ):
            raise LibrarySubmissionContainsPrivateAudio
        record_key = (str(request.family_id), idempotency_key)
        existing_id = self.library_idempotency.get(record_key)
        if existing_id is not None:
            return self.library_submissions[existing_id]
        existing_submission = next(
            (
                submission
                for submission in self.library_submissions.values()
                if submission.family_id == request.family_id
                and submission.question_set_id == request.question_set_id
                and submission.status == "pending_review"
            ),
            None,
        )
        if existing_submission is not None:
            self.library_idempotency[record_key] = str(existing_submission.id)
            return existing_submission
        submission = LibrarySubmission(
            family_id=request.family_id,
            question_set_id=request.question_set_id,
        )
        self.library_submissions[str(submission.id)] = submission
        self.library_idempotency[record_key] = str(submission.id)
        return submission

    async def withdraw_library_submission(
        self,
        submission_id: str,
        parent_id: str,
    ) -> LibrarySubmission:
        submission = self.library_submissions.get(submission_id)
        if (
            submission is None
            or parent_id not in self.family_parents.get(str(submission.family_id), set())
        ):
            raise NotFoundError
        if submission.status != "pending_review":
            raise LibrarySubmissionStatusConflict
        submission.status = "withdrawn"
        self.library_submissions[submission_id] = submission
        return submission

    async def review_library_submission(
        self,
        submission_id: str,
        request: ReviewLibrarySubmissionRequest,
        idempotency_key: str,
        parent_id: str,
    ) -> LibrarySubmission:
        submission = self.library_submissions.get(submission_id)
        if submission is None:
            raise NotFoundError
        record_key = (submission_id, idempotency_key)
        existing_id = self.library_review_idempotency.get(record_key)
        if existing_id is not None:
            return self.library_submissions[existing_id]
        if submission.status != "pending_review":
            raise LibrarySubmissionStatusConflict

        if request.decision == "approve":
            question_set = self.question_sets.get(str(submission.question_set_id))
            if question_set is None:
                raise NotFoundError
            questions = sorted(
                (
                    question
                    for question in self.questions.values()
                    if question.question_set_id == submission.question_set_id
                ),
                key=lambda question: question.position,
            )
            self.library_items[submission_id] = {
                "id": uuid4(),
                "submission_id": submission_id,
                "revision": 1,
                "snapshot": {
                    "schema_version": "1.0",
                    "question_set": {
                        "title": question_set.title,
                        "subject": question_set.subject,
                    },
                    "questions": [
                        {
                            "position": question.position,
                            "type": question.type.value,
                            "prompt": question.prompt,
                            "options": question.options,
                            "points": question.points,
                        }
                        for question in questions
                    ],
                },
                "private_content": {
                    "schema_version": "1.0",
                    "question_set": {
                        "locale": "en",
                    },
                    "questions": [
                        {
                            "position": question.position,
                            "type": question.type.value,
                            "answer_key": question.answer_key,
                            "points": question.points,
                        }
                        for question in questions
                    ],
                },
                "metadata": {
                    "title": question_set.title,
                    "subject": question_set.subject,
                    "question_count": len(questions),
                    "content_boundary": "no_answers_no_sources_no_family_data",
                },
            }
            submission.status = "published"
            submission.published_at = datetime.now(UTC)
        else:
            submission.status = "rejected"
        submission.review_note = request.note.strip() if request.note else None
        submission.reviewed_at = datetime.now(UTC)
        self.library_submissions[submission_id] = submission
        self.library_review_idempotency[record_key] = submission_id
        return submission

    async def decide_grading_result(
        self,
        result_id: str,
        request: ParentDecisionRequest,
        parent_id: str,
    ) -> ParentDecision:
        existing = self.parent_decisions.get(result_id)
        if existing is not None:
            return existing
        result = next(
            (
                result
                for results in self.question_results.values()
                for result in results
                if str(result.id) == result_id
            ),
            None,
        )
        if result is None:
            raise NotFoundError
        if parent_id not in self.family_parents.get(str(result.family_id), set()):
            raise NotFoundError
        decision = ParentDecision(
            result=result,
            parent_outcome=request.outcome,
            parent_awarded_points=request.awarded_points,
            parent_comment=request.comment,
        )
        self.parent_decisions[result_id] = decision
        return decision

    async def create_family_invitation(
        self,
        family_id: str,
        request: CreateFamilyInvitationRequest,
        parent_id: str,
        idempotency_key: str,
    ) -> FamilyInvitation:
        family = self.families.get(family_id)
        if family is None:
            raise NotFoundError
        record_key = (family_id, idempotency_key)
        existing_id = self.invitation_idempotency.get(record_key)
        if existing_id is not None:
            return self.family_invitations[existing_id]
        pending_count = sum(
            invitation.family_id == family.id
            and invitation.accepted_at is None
            and invitation.revoked_at is None
            for invitation in self.family_invitations.values()
        )
        if pending_count >= 3:
            raise FamilyParentLimitReached
        invitation = FamilyInvitation(
            family_id=family.id,
            email=request.email.strip().lower(),
            invited_by=parent_id,
        )
        self.family_invitations[str(invitation.id)] = invitation
        self.invitation_idempotency[record_key] = str(invitation.id)
        return invitation

    async def list_pending_invitations(
        self,
        email: str,
    ) -> list[FamilyInvitation]:
        now = datetime.now(UTC)
        return [
            invitation
            for invitation in self.family_invitations.values()
            if invitation.email == email.strip().lower()
            and invitation.accepted_at is None
            and invitation.revoked_at is None
            and invitation.expires_at > now
        ]

    async def accept_family_invitation(
        self,
        invitation_id: str,
        email: str,
        parent_id: str,
    ) -> Family:
        invitation = self.family_invitations.get(invitation_id)
        if (
            invitation is None
            or invitation.email != email.strip().lower()
            or invitation.accepted_at is not None
            or invitation.revoked_at is not None
            or invitation.expires_at <= datetime.now(UTC)
        ):
            raise NotFoundError
        accepted = invitation.model_copy(
            update={"accepted_at": datetime.now(UTC)}
        )
        self.family_invitations[invitation_id] = accepted
        self.family_parents.setdefault(str(invitation.family_id), set()).add(
            parent_id
        )
        return self.families[str(invitation.family_id)]
