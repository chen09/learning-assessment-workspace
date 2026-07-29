from datetime import UTC, datetime, timedelta
from pathlib import Path

from argon2 import PasswordHasher

from app.domain.errors import (
    FamilyParentLimitReached,
    NotFoundError,
    ResponseVersionConflict,
    SubmittedAttemptImmutable,
)
from app.domain.models import (
    Assignment,
    AssignmentStatus,
    AssignmentWork,
    Attempt,
    AttemptResults,
    Child,
    ChildAssignmentSummary,
    CompleteReviewRequest,
    CreateAssignmentRequest,
    CreateChildRequest,
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
    LibrarySubmission,
    ParentAttemptReview,
    ParentDecision,
    ParentDecisionRequest,
    ParentReviewItem,
    PrintableAssignment,
    Question,
    QuestionResult,
    QuestionSet,
    QuestionSetDraft,
    QuestionSetImport,
    QuestionSetStatus,
    QuestionType,
    QuestionView,
    ReviewCompletion,
    ReviewItemView,
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
        self.jobs: dict[str, Job] = {}
        self.question_results: dict[str, list[QuestionResult]] = {}
        self.submission_idempotency: dict[tuple[str, str], str] = {}
        self.child_pin_hashes: dict[str, str] = {}
        self.child_pin_failures: dict[str, int] = {}
        self.child_pin_locked_until: dict[str, datetime] = {}
        self.imports: dict[str, QuestionSetImport] = {}
        self.import_idempotency: dict[tuple[str, str], str] = {}
        self.confirm_idempotency: dict[tuple[str, str], str] = {}
        self.assignment_idempotency: dict[tuple[str, str], str] = {}
        self.upload_intents: dict[tuple[str, str], UploadIntent] = {}
        self.library_submissions: dict[str, LibrarySubmission] = {}
        self.library_idempotency: dict[tuple[str, str], str] = {}
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
            questions=[
                QuestionView.model_validate(question.model_dump()) for question in questions
            ],
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
        if assignment is None or str(assignment.child_id) != child_id:
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
                QuestionView.model_validate(question.model_dump()) for question in questions
            ],
        )

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
        return response

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
        if existing_job_id is not None:
            return SubmissionReceipt(
                assignment=assignment,
                attempt=attempt,
                job=self.jobs[existing_job_id],
            )
        if attempt.submitted_at is not None:
            raise SubmittedAttemptImmutable

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
        self.question_results[str(job.subject_id)] = results
        self.jobs[str(job.id)] = job
        attempt = self.attempts[str(job.subject_id)]
        assignment = self.assignments[str(attempt.assignment_id)]
        assignment.status = AssignmentStatus.RESULTS_READY
        self.assignments[str(assignment.id)] = assignment
        for result in results:
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
                and attempt.submitted_at is not None
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
    ) -> list[HistoryItem]:
        if parent_id not in self.family_parents.get(family_id, set()):
            raise NotFoundError
        items: list[HistoryItem] = []
        for child in self.children.values():
            if str(child.family_id) == family_id:
                items.extend(await self.list_child_history(str(child.id)))
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
        return AttemptResults(
            attempt_id=attempt.id,
            complete=len(results) == len(questions),
            results=results,
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
            complete=len(results) == len(questions),
            awarded_points=awarded_points,
            available_points=sum(question.points for question in questions),
            correct_count=correct_count,
            correction_count=correction_count,
            pending_review_count=len(reviews),
            reviews=reviews,
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
                QuestionView.model_validate(question.model_dump())
                for question in questions
            ],
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
        if family_id not in self.families:
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
        ):
            raise NotFoundError
        record_key = (str(request.family_id), idempotency_key)
        existing_id = self.library_idempotency.get(record_key)
        if existing_id is not None:
            return self.library_submissions[existing_id]
        submission = LibrarySubmission(
            family_id=request.family_id,
            question_set_id=request.question_set_id,
        )
        self.library_submissions[str(submission.id)] = submission
        self.library_idempotency[record_key] = str(submission.id)
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
