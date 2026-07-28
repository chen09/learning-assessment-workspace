from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from app.domain.models import GradingOutcome

INTERVAL_DAYS = (1, 3, 7, 14, 30)
DAILY_REVIEW_LIMIT = 10


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
