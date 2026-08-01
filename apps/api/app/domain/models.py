from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class QuestionSetStatus(StrEnum):
    DRAFT = "draft"
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    CONFIRMED = "confirmed"


class AssignmentStatus(StrEnum):
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    GRADING = "grading"
    RESULTS_READY = "results_ready"
    CORRECTING = "correcting"
    COMPLETED = "completed"
    WITHDRAWN = "withdrawn"
    STOPPED = "stopped"


class QuestionType(StrEnum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    TYPED_TEXT = "typed_text"
    WORD_ORDER = "word_order"
    HANDWRITING = "handwriting"
    PHOTO = "photo"
    LISTENING = "listening"


class ResponseKind(StrEnum):
    CHOICE = "choice"
    TEXT = "text"
    TOKENS = "tokens"
    STROKES = "strokes"
    PHOTO = "photo"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class GradingOutcome(StrEnum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    UNCERTAIN = "uncertain"
    NEEDS_PARENT_REVIEW = "needs_parent_review"


class Family(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str


class CreateFamilyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CreateFamilyInvitationRequest(BaseModel):
    email: str = Field(
        min_length=3,
        max_length=254,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )


class FamilyInvitation(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    email: str
    invited_by: str
    expires_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC) + timedelta(days=7)
    )
    accepted_at: datetime | None = None
    revoked_at: datetime | None = None
    external_notification_sent: Literal[False] = False


class Child(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    nickname: str
    grade_stage: str
    ui_language: Literal["zh", "ja", "en"] = "en"


class CreateChildRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=40)
    grade_stage: str = Field(min_length=1, max_length=60)
    pin: str = Field(pattern=r"^\d{6}$")
    ui_language: Literal["zh", "ja", "en"] = "en"


class UpdateChildPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{6}$")


class UpdateChildLanguageRequest(BaseModel):
    ui_language: Literal["zh", "ja", "en"]


class ManagementPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{6}$")


class ManagementPinStatus(BaseModel):
    configured: bool


class ManagementUnlockResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class ManagementUnlockClaims(BaseModel):
    sub: str
    family_id: UUID
    parent_id: str
    scope: Literal["manage_child_pin"]
    exp: datetime


class QuestionSet(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    title: str
    subject: str
    status: QuestionSetStatus
    source_summary: dict[str, Any] = Field(default_factory=dict)


class ListeningConfig(BaseModel):
    """Private configuration saved with a listening question.

    The storage path and transcript never travel in the default child question
    shape. Repositories explicitly create a signed, short-lived view for an
    active attempt instead.
    """

    audio_path: str = Field(min_length=1, max_length=500)
    replay_limit: int = Field(default=2, ge=0, le=10)
    transcript: str | None = Field(default=None, max_length=10_000)
    transcript_policy: Literal["never", "after_submission", "always"] = "never"


class ListeningQuestionView(BaseModel):
    """The safe, child-facing subset of a listening question.

    Audio URLs are absent until the child deliberately starts a permitted
    playback. This prevents a work payload from becoming a reusable media URL.
    """

    audio_url: str | None = None
    replay_limit: int = Field(ge=0, le=10)
    play_count: int = Field(default=0, ge=0, le=10)
    transcript: str | None = None


class Question(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    question_set_id: UUID
    position: int
    type: QuestionType
    prompt: str
    options: list[str] | None = None
    answer_key: dict[str, Any]
    points: float = 1
    listening: ListeningConfig | None = Field(default=None, exclude=True)


class QuestionView(BaseModel):
    id: UUID
    position: int
    type: QuestionType
    prompt: str
    options: list[str] | None = None
    points: float
    listening: ListeningQuestionView | None = None


class Assignment(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    question_set_id: UUID
    child_id: UUID
    status: AssignmentStatus = AssignmentStatus.ASSIGNED
    mode: str = "practice"
    time_limit_seconds: int | None = None
    parent_note: str | None = Field(default=None, max_length=300)


class ChildAssignmentSummary(BaseModel):
    id: UUID
    title: str
    status: AssignmentStatus
    mode: str
    time_limit_seconds: int | None
    parent_note: str | None = None
    question_count: int
    latest_attempt_id: UUID | None = None


class DemoBootstrap(BaseModel):
    family: Family
    child: Child
    question_set: QuestionSet
    assignment: Assignment
    questions: list[QuestionView]


class ChildSessionRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{6}$")


class ChildSessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    child_id: UUID
    family_id: UUID
    nickname: str
    ui_language: Literal["zh", "ja", "en"]


class ChildSessionClaims(BaseModel):
    sub: str
    family_id: UUID
    child_id: UUID
    scope: str
    exp: datetime


class Attempt(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    assignment_id: UUID
    child_id: UUID
    sequence: int = 1
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    submitted_at: datetime | None = None


class SaveResponseRequest(BaseModel):
    kind: ResponseKind
    answer: dict[str, Any]
    expected_version: int = Field(ge=0)


class SavedResponse(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    attempt_id: UUID
    question_id: UUID
    kind: ResponseKind
    answer: dict[str, Any]
    # Present only when this response contains private answer photos and the
    # current viewer is entitled to see them. These short-lived URLs are never
    # persisted as part of the answer payload.
    photo_urls: list[str] = Field(default_factory=list)
    version: int = 1
    saved_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AssignmentWork(BaseModel):
    title: str
    assignment: Assignment
    attempt: Attempt
    questions: list[QuestionView]
    responses: list[SavedResponse] = Field(default_factory=list)
    submitted_question_ids: list[UUID] = Field(default_factory=list)


class PrintableAssignment(BaseModel):
    assignment: Assignment
    title: str
    questions: list[QuestionView]
    template_version: Literal["a4-v1"] = "a4-v1"


class Job(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    subject_id: UUID
    type: str = "grade_submission"
    status: JobStatus = JobStatus.QUEUED
    payload: dict[str, Any] = Field(default_factory=dict)
    attempt_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None


class SubmissionReceipt(BaseModel):
    assignment: Assignment
    attempt: Attempt
    job: Job


class QuestionSubmissionReceipt(BaseModel):
    attempt_id: UUID
    question_id: UUID
    job: Job


class ListeningPlaybackReceipt(BaseModel):
    question_id: UUID
    play_count: int = Field(ge=0, le=10)
    replay_limit: int = Field(ge=0, le=10)
    audio_url: str


class QuestionResult(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    attempt_id: UUID
    question_id: UUID
    outcome: GradingOutcome
    awarded_points: float | None
    confidence: float
    feedback: dict[str, Any]
    grader_version: str = "fixture-v1"
    transcript: str | None = None


class AttemptResults(BaseModel):
    attempt_id: UUID
    complete: bool
    results: list[QuestionResult]


class ParentReviewItem(BaseModel):
    result_id: UUID
    question_id: UUID
    question_position: int
    question_prompt: str
    question_type: QuestionType
    question_points: float
    response_kind: ResponseKind
    response_answer: dict[str, Any]
    photo_urls: list[str] = Field(default_factory=list)
    automated_outcome: GradingOutcome
    automated_feedback: dict[str, Any]


class ResponseRevision(BaseModel):
    """A privacy-preserving record of a photo-answer change.

    The timeline deliberately contains no object path, filename, signed URL,
    or image metadata. The parent's current-answer preview is the only place
    that can expose a currently attached private image.
    """

    question_id: UUID
    question_position: int
    response_version: int
    change: Literal["photo_added", "photo_updated", "photo_removed"]
    previous_page_count: int = Field(ge=0)
    page_count: int = Field(ge=0)
    saved_at: datetime


class ParentAttemptReview(BaseModel):
    attempt_id: UUID
    child_nickname: str
    title: str
    source_material_title: str | None = None
    source_material_subject: str | None = None
    complete: bool
    awarded_points: float
    available_points: float
    correct_count: int
    correction_count: int
    pending_review_count: int
    reviews: list[ParentReviewItem]
    response_revisions: list[ResponseRevision] = Field(default_factory=list)


class ReviewItemView(BaseModel):
    id: UUID
    child_id: UUID = Field(exclude=True)
    source_question_id: UUID
    prompt: str
    type: QuestionType
    options: list[str] | None
    answer_mode: Literal["choice", "text", "tokens", "parent_review"]
    due_on: date
    interval_days: int
    level: Literal["reinforcement", "standard", "challenge"]


class CompleteReviewRequest(BaseModel):
    """A child answer; the server derives correctness from the source question."""

    model_config = ConfigDict(extra="forbid")

    choices: list[int] | None = Field(default=None, max_length=20)
    text: str | None = Field(default=None, max_length=5000)
    tokens: list[str] | None = Field(default=None, max_length=100)


class ReviewCompletion(BaseModel):
    item_id: UUID
    old_interval_days: int
    new_interval_days: int
    next_due_on: date
    outcome: Literal["correct", "incorrect"] | None = None


class HistoryItem(BaseModel):
    assignment_id: UUID
    attempt_id: UUID | None
    child_id: UUID
    child_nickname: str
    title: str
    status: AssignmentStatus
    submitted_at: datetime | None
    awarded_points: float
    available_points: float
    correction_count: int


class ParentHistoryItem(HistoryItem):
    """Parent-only history metadata; never returned by the child history route."""

    source_material_title: str | None = None
    source_material_subject: str | None = None


class CreateDeletionRequest(BaseModel):
    family_id: UUID
    target_type: Literal["family", "child", "asset"]
    target_id: UUID


class DeletionRequestView(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    target_type: Literal["family", "child", "asset"]
    target_id: UUID
    requested_at: datetime
    purge_after: datetime
    restored_at: datetime | None = None


class ParentDecisionRequest(BaseModel):
    outcome: Literal["correct", "incorrect"]
    awarded_points: float | None = Field(default=None, ge=0)
    comment: str | None = Field(default=None, max_length=500)


class ParentDecision(BaseModel):
    result: QuestionResult
    parent_outcome: Literal["correct", "incorrect"]
    parent_awarded_points: float | None
    parent_comment: str | None
    reviewed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ImportPurpose(StrEnum):
    USE_AS_QUESTIONS = "use_as_questions"
    GENERATE_SIMILAR = "generate_similar"


class CreateImportRequest(BaseModel):
    family_id: UUID
    filenames: list[str] = Field(min_length=1, max_length=30)
    source_paths: list[str] = Field(default_factory=list, max_length=30)
    answer_filenames: list[str] = Field(default_factory=list, max_length=10)
    answer_source_paths: list[str] = Field(default_factory=list, max_length=10)
    reference_filenames: list[str] = Field(default_factory=list, max_length=30)
    reference_source_paths: list[str] = Field(default_factory=list, max_length=30)
    purpose: ImportPurpose
    title: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=80)


class QuestionSetImport(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    question_set_id: UUID
    filenames: list[str]
    source_paths: list[str] = Field(default_factory=list)
    answer_filenames: list[str] = Field(default_factory=list)
    answer_source_paths: list[str] = Field(default_factory=list)
    reference_filenames: list[str] = Field(default_factory=list)
    reference_source_paths: list[str] = Field(default_factory=list)
    purpose: ImportPurpose
    status: QuestionSetStatus = QuestionSetStatus.NEEDS_REVIEW
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class CompletedWorksheetStatus(StrEnum):
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    CONFIRMED = "confirmed"
    GRADING = "grading"
    RESULTS_READY = "results_ready"
    FAILED = "failed"


class CreateCompletedWorksheetRequest(BaseModel):
    """A parent-uploaded paper that already contains a child's answers."""

    family_id: UUID
    child_id: UUID
    title: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=80)
    document_language: Literal["en", "ja", "zh"]
    feedback_language: Literal["en", "ja", "zh"]
    filenames: list[str] = Field(min_length=1, max_length=100)
    response_paths: list[str] = Field(min_length=1, max_length=100)
    answer_source_paths: list[str] = Field(default_factory=list, max_length=30)
    reference_source_paths: list[str] = Field(default_factory=list, max_length=100)


class CompletedWorksheetImport(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    child_id: UUID
    title: str
    subject: str
    document_language: Literal["en", "ja", "zh"]
    feedback_language: Literal["en", "ja", "zh"]
    filenames: list[str]
    response_paths: list[str]
    answer_source_paths: list[str] = Field(default_factory=list)
    reference_source_paths: list[str] = Field(default_factory=list)
    extraction: dict[str, Any] = Field(default_factory=dict)
    status: CompletedWorksheetStatus = CompletedWorksheetStatus.PROCESSING
    assignment_id: UUID | None = None
    attempt_id: UUID | None = None
    job: Job
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class CompletedWorksheetResponseInput(BaseModel):
    """One reviewed answer region from an already-completed paper."""

    question_position: int = Field(gt=0)
    kind: ResponseKind = ResponseKind.PHOTO
    answer: dict[str, Any] = Field(default_factory=dict)


class CompletedWorksheetConfirmation(BaseModel):
    """The durable learning records created from a parent-confirmed scan."""

    completed_worksheet: CompletedWorksheetImport
    question_set_id: UUID
    assignment: Assignment
    attempt: Attempt
    grading_job: Job


class QuestionSetDraft(BaseModel):
    question_set: QuestionSet
    questions: list[Question]


class FamilyLibraryQuestionSet(BaseModel):
    id: UUID
    family_id: UUID
    title: str
    subject: str
    status: QuestionSetStatus
    question_count: int = Field(ge=0)
    source_summary: dict[str, Any] = Field(default_factory=dict)


class CreateAssignmentRequest(BaseModel):
    child_id: UUID
    mode: Literal["practice", "exam"] = "practice"
    time_limit_seconds: int | None = Field(default=None, ge=60, le=14_400)
    parent_note: str | None = Field(default=None, max_length=300)


class UploadBucket(StrEnum):
    SOURCES = "sources"
    RESPONSES = "responses"
    AUDIO = "audio"
    DERIVED = "derived"


class CreateUploadIntentRequest(BaseModel):
    family_id: UUID
    bucket: UploadBucket
    object_id: UUID
    filename: str = Field(min_length=1, max_length=180)
    content_type: Literal[
        "application/pdf",
        "image/png",
        "image/jpeg",
        "audio/mpeg",
        "audio/mp4",
    ]


class UploadIntent(BaseModel):
    bucket: UploadBucket
    path: str
    upload_url: str
    expires_in: int = 300


class CreateLibrarySubmissionRequest(BaseModel):
    family_id: UUID
    question_set_id: UUID
    rights_confirmed: Literal[True]
    privacy_confirmed: Literal[True]


class LibrarySubmission(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    family_id: UUID
    question_set_id: UUID
    status: Literal["pending_review", "published", "rejected", "withdrawn"] = (
        "pending_review"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    published_at: datetime | None = None
    review_note: str | None = None
    reviewed_at: datetime | None = None


class LibraryReviewSubmission(BaseModel):
    """Reviewer-safe metadata; never includes sources, answers, or child work."""

    id: UUID
    question_set_id: UUID
    title: str
    subject: str
    question_count: int
    created_at: datetime


class ReviewLibrarySubmissionRequest(BaseModel):
    """An explicit, auditable decision by a configured library reviewer."""

    decision: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=600)


class LibraryReviewerAccess(BaseModel):
    is_reviewer: bool


class PublicLibraryItem(BaseModel):
    """Anonymous metadata for a published, reusable question set."""

    id: UUID
    title: str
    subject: str
    question_count: int
    revision: int
    published_at: datetime


class CopyPublicLibraryItemRequest(BaseModel):
    family_id: UUID


class PublicLibraryCopy(BaseModel):
    """A new family-owned question set copied from an immutable revision."""

    library_item_id: UUID
    library_revision: int
    question_set_id: UUID
    family_id: UUID
    question_count: int
    reused_existing: bool = False
