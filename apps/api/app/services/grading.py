import unicodedata
from datetime import UTC, datetime
from typing import Any, Protocol

from app.ai.contracts import (
    GeneratedQuestion,
    GradeResponseInput,
    GradeResponseOutput,
)
from app.domain.models import (
    GradingOutcome,
    Job,
    JobStatus,
    Question,
    QuestionResult,
    ResponseKind,
    SavedResponse,
)


class VisualGradingAdapter(Protocol):
    version: str

    def grade_response(
        self,
        request: GradeResponseInput,
    ) -> GradeResponseOutput: ...


def normalize_exact_text(value: object) -> str:
    normalized = unicodedata.normalize("NFKC", str(value))
    return " ".join(normalized.split()).casefold()


class FixtureGrader:
    """Deterministic grader for development and contract tests only."""

    version = "fixture-v1"

    def grade(
        self,
        job: Job,
        question: Question,
        response: SavedResponse | None,
    ) -> QuestionResult:
        outcome: GradingOutcome
        awarded_points: float | None
        confidence: float
        feedback: dict[str, Any]
        if response is None:
            outcome = GradingOutcome.INCORRECT
            awarded_points = 0
            confidence = 1
            feedback = {
                "summary": "No answer was submitted.",
                "action": "Review this question and try it again.",
            }
        elif response.kind in {
            ResponseKind.STROKES,
            ResponseKind.PHOTO,
        }:
            outcome = GradingOutcome.NEEDS_PARENT_REVIEW
            awarded_points = None
            confidence = 0
            feedback = {
                "summary": "Waiting for a parent to review.",
                "action": "A parent can mark this answer correct or incorrect.",
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
            alternatives = question.answer_key.get("texts")
            if isinstance(alternatives, list):
                expected_texts = {
                    normalize_exact_text(value) for value in alternatives
                }
            else:
                expected_texts = {
                    normalize_exact_text(question.answer_key.get("text", ""))
                }
            actual_text = normalize_exact_text(response.answer.get("text", ""))
            correct = actual_text in expected_texts
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


def grade_response_with_ai(
    job: Job,
    question: Question,
    response: SavedResponse | None,
    *,
    visual_adapter: VisualGradingAdapter | None,
    grading_guide: str = "",
    minimum_confidence: float = 0.75,
) -> QuestionResult:
    if (
        visual_adapter is None
        or response is None
        or response.kind != ResponseKind.STROKES
    ):
        return FixtureGrader().grade(job, question, response)
    grade = visual_adapter.grade_response(
        GradeResponseInput(
            question=GeneratedQuestion(
                client_id=str(question.id),
                type=question.type,
                prompt=question.prompt,
                options=question.options,
                answer_key=question.answer_key,
                grading_guide=grading_guide,
                difficulty="standard",
                knowledge_points=[],
                points=question.points,
            ),
            response={
                "kind": response.kind.value,
                **response.answer,
            },
        )
    )
    outcome = grade.outcome
    awarded_points = grade.awarded_points
    if grade.confidence < minimum_confidence:
        outcome = GradingOutcome.UNCERTAIN
        awarded_points = None
    return QuestionResult(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        outcome=outcome,
        awarded_points=awarded_points,
        confidence=grade.confidence,
        feedback={
            "summary": grade.feedback,
            "action": (
                "Continue to the next question."
                if outcome == GradingOutcome.CORRECT
                else (
                    "Review the feedback and try this question again."
                    if outcome == GradingOutcome.INCORRECT
                    else "Ask a parent to confirm this answer."
                )
            ),
            "evidence": grade.evidence,
        },
        grader_version=visual_adapter.version,
    )
