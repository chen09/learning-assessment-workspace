from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.domain.models import GradingOutcome
from app.services.review_schedule import ReviewItem, schedule_next, select_daily_review


def test_review_interval_advances_and_error_resets_to_one_day() -> None:
    now = datetime(2026, 7, 28, 9, tzinfo=UTC)

    first = schedule_next(
        current_stage=None,
        outcome=GradingOutcome.INCORRECT,
        decided_at=now,
    )
    second = schedule_next(
        current_stage=first.stage,
        outcome=GradingOutcome.CORRECT,
        decided_at=first.due_at,
    )
    reset = schedule_next(
        current_stage=4,
        outcome=GradingOutcome.INCORRECT,
        decided_at=now,
    )

    assert first.stage == 0
    assert first.due_at == now + timedelta(days=1)
    assert second.stage == 1
    assert second.due_at == first.due_at + timedelta(days=3)
    assert reset.stage == 0
    assert reset.due_at == now + timedelta(days=1)


def test_daily_review_is_capped_at_ten_due_questions() -> None:
    now = datetime(2026, 7, 28, 9, tzinfo=UTC)
    items = [
        ReviewItem(
            question_id=uuid4(),
            due_at=now - timedelta(minutes=index),
            stage=index % 5,
        )
        for index in range(15)
    ]

    selected = select_daily_review(items, now=now)

    assert len(selected) == 10
    assert selected == sorted(items, key=lambda item: item.due_at)[:10]
