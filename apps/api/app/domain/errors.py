class DomainError(Exception):
    """Base class for expected domain failures."""


class NotFoundError(DomainError):
    pass


class ResponseVersionConflict(DomainError):
    def __init__(self, current_version: int) -> None:
        self.current_version = current_version
        super().__init__(f"Expected response version does not match {current_version}.")


class SubmittedAttemptImmutable(DomainError):
    pass


class SubmittedQuestionImmutable(DomainError):
    pass


class QuestionAnswerRequired(DomainError):
    pass


class ReviewRequiresParent(DomainError):
    """A visual or listening review cannot be self-graded in the child flow."""

    pass


class ListeningReplayLimitReached(DomainError):
    pass


class FamilyParentLimitReached(DomainError):
    pass


class AssignmentStatusConflict(DomainError):
    pass


class ParentDecisionInvalid(DomainError):
    pass


class LibrarySubmissionStatusConflict(DomainError):
    pass


class LibrarySubmissionContainsPrivateAudio(DomainError):
    """Audio cannot enter the public library until asset sharing is explicit."""

    pass
