from datetime import UTC, datetime

from app.domain.models import (
    GradingOutcome,
    Job,
    JobStatus,
    Question,
    QuestionResult,
    ResponseKind,
    SavedResponse,
)


class FixtureGrader:
    """Deterministic grader for development and contract tests only."""

    version = "fixture-v1"

    def grade(
        self,
        job: Job,
        question: Question,
        response: SavedResponse | None,
    ) -> QuestionResult:
        if response is None or response.kind in {
            ResponseKind.STROKES,
            ResponseKind.PHOTO,
        }:
            outcome = GradingOutcome.UNCERTAIN
            awarded_points = None
            confidence = 0.35
            feedback = {
                "summary": "I could not read this reliably.",
                "action": "Ask a parent to review it or upload a clearer answer.",
            }
        elif response.kind == ResponseKind.CHOICE:
            choices = response.answer.get("choices", [])
            expected_choices = question.answer_key.get("choices")
            if isinstance(expected_choices, list):
                correct = sorted(choices) == sorted(expected_choices)
            else:
                expected = question.answer_key.get("choice")
                correct = choices == [expected]
            outcome = (
                GradingOutcome.CORRECT if correct else GradingOutcome.INCORRECT
            )
            awarded_points = question.points if correct else 0
            confidence = 0.99
            feedback = (
                {"summary": "Correct.", "action": "Keep going."}
                if correct
                else {
                    "summary": "Not quite yet.",
                    "action": "Check the sign in the middle and try again.",
                }
            )
        elif response.kind == ResponseKind.TEXT:
            expected_text = str(question.answer_key.get("text", "")).strip().casefold()
            actual_text = str(response.answer.get("text", "")).strip().casefold()
            correct = actual_text == expected_text
            outcome = (
                GradingOutcome.CORRECT if correct else GradingOutcome.INCORRECT
            )
            awarded_points = question.points if correct else 0
            confidence = 0.98
            feedback = (
                {"summary": "Correct.", "action": "Nice work."}
                if correct
                else {
                    "summary": "Try once more.",
                    "action": "Check the subject and the verb ending.",
                }
            )
        elif response.kind == ResponseKind.TOKENS:
            expected_tokens = question.answer_key.get("tokens", [])
            actual_tokens = response.answer.get("tokens", [])
            correct = actual_tokens == expected_tokens
            outcome = (
                GradingOutcome.CORRECT if correct else GradingOutcome.INCORRECT
            )
            awarded_points = question.points if correct else 0
            confidence = 0.99
            feedback = (
                {"summary": "Correct.", "action": "The order is right."}
                if correct
                else {
                    "summary": "Try the order again.",
                    "action": "Find the subject and verb first.",
                }
            )
        else:
            outcome = GradingOutcome.NEEDS_PARENT_REVIEW
            awarded_points = None
            confidence = 0
            feedback = {
                "summary": "This answer type needs review.",
                "action": "Ask a parent to review it.",
            }

        return QuestionResult(
            family_id=job.family_id,
            attempt_id=job.subject_id,
            question_id=question.id,
            outcome=outcome,
            awarded_points=awarded_points,
            confidence=confidence,
            feedback=feedback,
            grader_version=self.version,
        )

    def mark_succeeded(self, job: Job) -> Job:
        job.status = JobStatus.SUCCEEDED
        job.completed_at = datetime.now(UTC)
        return job
