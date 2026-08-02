import unicodedata
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

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


def localized_feedback_action(
    language: Literal["en", "ja", "zh"],
    outcome: GradingOutcome,
) -> str:
    actions = {
        "en": {
            GradingOutcome.CORRECT: "Continue to the next question.",
            GradingOutcome.INCORRECT: "Review the feedback and try this question again.",
            "review": "Ask a parent to confirm this answer.",
        },
        "ja": {
            GradingOutcome.CORRECT: "次の問題へ進んでください。",
            GradingOutcome.INCORRECT: (
                "フィードバックを確認して、この問題をもう一度解いてください。"
            ),
            "review": "保護者にこの答えを確認してもらってください。",
        },
        "zh": {
            GradingOutcome.CORRECT: "继续做下一题。",
            GradingOutcome.INCORRECT: "查看批语后，重新完成这道题。",
            "review": "请家长确认这份答案。",
        },
    }
    return actions[language].get(outcome, actions[language]["review"])


def localized_fixture_feedback(
    language: Literal["en", "ja", "zh"],
    *,
    summary: str,
    action: str,
) -> dict[str, str]:
    messages = {
        "en": {
            "no_answer": "No answer was submitted.",
            "parent_review": "Waiting for a parent to review.",
            "correct": "Correct.",
            "incorrect": "Not quite yet.",
            "try_again": "Review this question and try it again.",
            "parent_decision": "A parent can mark this answer correct or incorrect.",
            "keep_going": "Keep going.",
            "check_sign": "Check the sign in the middle and try again.",
            "nice_work": "Nice work.",
            "check_verb": "Check the subject and the verb ending.",
            "order_correct": "The order is right.",
            "order_again": "Find the subject and verb first.",
            "unsupported": "This answer type needs review.",
        },
        "ja": {
            "no_answer": "解答が送信されていません。",
            "parent_review": "保護者の確認待ちです。",
            "correct": "正解です。",
            "incorrect": "もう少しです。",
            "try_again": "この問題を確認して、もう一度解いてください。",
            "parent_decision": "保護者がこの解答の正誤を確認できます。",
            "keep_going": "この調子で次の問題へ進みましょう。",
            "check_sign": "途中の符号を確認して、もう一度解いてください。",
            "nice_work": "よくできました。",
            "check_verb": "主語と動詞の語尾を確認してください。",
            "order_correct": "語順は正しいです。",
            "order_again": "まず主語と動詞を見つけましょう。",
            "unsupported": "この解答形式は確認が必要です。",
        },
        "zh": {
            "no_answer": "尚未提交答案。",
            "parent_review": "等待家长确认。",
            "correct": "正确。",
            "incorrect": "还差一点。",
            "try_again": "请查看这道题后重新作答。",
            "parent_decision": "家长可以确认这份答案是否正确。",
            "keep_going": "继续做下一题。",
            "check_sign": "请检查中间的符号后重做。",
            "nice_work": "做得很好。",
            "check_verb": "请检查主语和动词词尾。",
            "order_correct": "词序正确。",
            "order_again": "先找出主语和动词。",
            "unsupported": "这种作答形式需要确认。",
        },
    }
    translated = messages[language]
    return {"summary": translated[summary], "action": translated[action]}


class FixtureGrader:
    """Deterministic grader for development and contract tests only."""

    version = "fixture-v1"

    def grade(
        self,
        job: Job,
        question: Question,
        response: SavedResponse | None,
        *,
        feedback_language: Literal["en", "ja", "zh"] = "en",
    ) -> QuestionResult:
        outcome: GradingOutcome
        awarded_points: float | None
        confidence: float
        feedback: dict[str, Any]
        if response is None:
            outcome = GradingOutcome.INCORRECT
            awarded_points = 0
            confidence = 1
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="no_answer",
                action="try_again",
            )
        elif response.kind in {
            ResponseKind.STROKES,
            ResponseKind.PHOTO,
        }:
            outcome = GradingOutcome.NEEDS_PARENT_REVIEW
            awarded_points = None
            confidence = 0
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="parent_review",
                action="parent_decision",
            )
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
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="correct" if correct else "incorrect",
                action="keep_going" if correct else "check_sign",
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
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="correct" if correct else "incorrect",
                action="nice_work" if correct else "check_verb",
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
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="correct" if correct else "incorrect",
                action="order_correct" if correct else "order_again",
            )
        else:
            outcome = GradingOutcome.NEEDS_PARENT_REVIEW
            awarded_points = None
            confidence = 0
            feedback = localized_fixture_feedback(
                feedback_language,
                summary="unsupported",
                action="parent_decision",
            )

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
    feedback_language: Literal["en", "ja", "zh"] = "en",
) -> QuestionResult:
    if (
        visual_adapter is None
        or response is None
        or response.kind != ResponseKind.STROKES
    ):
        return FixtureGrader().grade(
            job,
            question,
            response,
            feedback_language=feedback_language,
        )
    grade = visual_adapter.grade_response(
        GradeResponseInput(
            language=feedback_language,
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
            "action": localized_feedback_action(feedback_language, outcome),
            "evidence": grade.evidence,
            "annotations": [
                annotation.model_dump() for annotation in grade.annotations
            ],
        },
        grader_version=visual_adapter.version,
    )
