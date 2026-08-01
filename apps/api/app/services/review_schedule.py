from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from app.domain.errors import ReviewRequiresParent
from app.domain.models import (
    CompleteReviewRequest,
    GradingOutcome,
    Question,
    QuestionType,
)
from app.services.grading import normalize_exact_text

INTERVAL_DAYS = (1, 3, 7, 14, 30)
DAILY_REVIEW_LIMIT = 10


def review_answer_mode(
    question_type: QuestionType,
) -> Literal["choice", "text", "tokens", "parent_review"]:
    if question_type in {QuestionType.SINGLE_CHOICE, QuestionType.MULTIPLE_CHOICE}:
        return "choice"
    if question_type == QuestionType.TYPED_TEXT:
        return "text"
    if question_type == QuestionType.WORD_ORDER:
        return "tokens"
    return "parent_review"


def grade_review_answer(
    question: Question,
    request: CompleteReviewRequest,
) -> Literal["correct", "incorrect"]:
    """Grade only answer types that remain safe and deterministic in child review."""

    mode = review_answer_mode(question.type)
    if mode == "parent_review":
        raise ReviewRequiresParent
    if mode == "choice":
        expected_choices = question.answer_key.get("choices")
        if isinstance(expected_choices, list):
            correct = sorted(request.choices or []) == sorted(expected_choices)
        else:
            correct = request.choices == [question.answer_key.get("choice")]
    elif mode == "text":
        alternatives = question.answer_key.get("texts")
        expected_texts = (
            {normalize_exact_text(value) for value in alternatives}
            if isinstance(alternatives, list)
            else {normalize_exact_text(question.answer_key.get("text", ""))}
        )
        correct = normalize_exact_text(request.text or "") in expected_texts
    else:
        correct = (request.tokens or []) == question.answer_key.get("tokens", [])
    return "correct" if correct else "incorrect"


def next_interval_days(
    current_interval_days: int,
    outcome: Literal["correct", "incorrect"],
) -> int:
    if outcome == "incorrect":
        return INTERVAL_DAYS[0]
    try:
        current_index = INTERVAL_DAYS.index(current_interval_days)
    except ValueError:
        current_index = 0
    return INTERVAL_DAYS[min(current_index + 1, len(INTERVAL_DAYS) - 1)]


@dataclass(frozen=True, slots=True)
class ReviewItem:
    question_id: UUID
    due_at: datetime
    stage: int


@dataclass(frozen=True, slots=True)
class NextReview:
    stage: int
    due_at: datetime


def schedule_next(
    *,
    current_stage: int | None,
    outcome: GradingOutcome,
    decided_at: datetime,
) -> NextReview:
    if outcome in {
        GradingOutcome.INCORRECT,
        GradingOutcome.UNCERTAIN,
        GradingOutcome.NEEDS_PARENT_REVIEW,
    }:
        next_stage = 0
    else:
        next_stage = min((current_stage if current_stage is not None else -1) + 1, 4)
    return NextReview(
        stage=next_stage,
        due_at=decided_at + timedelta(days=INTERVAL_DAYS[next_stage]),
    )


def select_daily_review(
    items: list[ReviewItem],
    *,
    now: datetime,
) -> list[ReviewItem]:
    due = (item for item in items if item.due_at <= now)
    return sorted(due, key=lambda item: item.due_at)[:DAILY_REVIEW_LIMIT]
