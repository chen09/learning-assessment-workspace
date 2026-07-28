import pytest
from pydantic import ValidationError

from app.ai.contracts import (
    ExtractSourceInput,
    GenerateQuestionsInput,
    GradeResponseInput,
    SourcePageInput,
)
from app.ai.fixture import FixtureAIAdapter
from app.domain.models import (
    Job,
    Question,
    QuestionType,
    ResponseKind,
    SavedResponse,
)
from app.services.grading import FixtureGrader


def test_ai_contracts_forbid_unversioned_extra_fields() -> None:
    with pytest.raises(ValidationError):
        ExtractSourceInput.model_validate(
            {
                "schema_version": "1.0",
                "pages": [
                    {
                        "page_number": 1,
                        "media_type": "application/pdf",
                        "storage_path": "family/source/page.pdf",
                        "unexpected": True,
                    }
                ],
            }
        )


def test_fixture_adapter_is_deterministic_and_reports_confidence() -> None:
    adapter = FixtureAIAdapter()
    extracted = adapter.extract_source(
        ExtractSourceInput(
            pages=[
                SourcePageInput(
                    page_number=1,
                    media_type="application/pdf",
                    storage_path="family/source/lesson.pdf",
                )
            ]
        )
    )
    first = adapter.generate_questions(
        GenerateQuestionsInput(
            source=extracted,
            subject="English",
            target_level="junior-high-1",
            difficulty="standard",
            count=3,
        )
    )
    second = adapter.generate_questions(
        GenerateQuestionsInput(
            source=extracted,
            subject="English",
            target_level="junior-high-1",
            difficulty="standard",
            count=3,
        )
    )
    grade = adapter.grade_response(
        GradeResponseInput(
            question=first.questions[0],
            response={"kind": "choice", "choices": [1]},
        )
    )

    assert first == second
    assert len(first.questions) == 3
    assert 0 <= extracted.confidence <= 1
    assert grade.outcome == "correct"
    assert grade.confidence >= 0.95


@pytest.mark.parametrize(
    ("question_type", "answer_key", "response_kind", "answer"),
    [
        (
            QuestionType.MULTIPLE_CHOICE,
            {"choices": [0, 2]},
            ResponseKind.CHOICE,
            {"choices": [2, 0]},
        ),
        (
            QuestionType.WORD_ORDER,
            {"tokens": ["She", "walks", "home."]},
            ResponseKind.TOKENS,
            {"tokens": ["She", "walks", "home."]},
        ),
    ],
)
def test_fixture_grader_supports_multiple_choice_and_word_order(
    question_type: QuestionType,
    answer_key: dict[str, object],
    response_kind: ResponseKind,
    answer: dict[str, object],
) -> None:
    job = Job(
        family_id="00000000-0000-0000-0000-000000000001",
        subject_id="00000000-0000-0000-0000-000000000002",
    )
    question = Question(
        family_id=job.family_id,
        question_set_id="00000000-0000-0000-0000-000000000003",
        position=1,
        type=question_type,
        prompt="Fixture",
        options=["She", "walks", "home."],
        answer_key=answer_key,
    )
    response = SavedResponse(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        kind=response_kind,
        answer=answer,
    )

    result = FixtureGrader().grade(job, question, response)

    assert result.outcome == "correct"
    assert result.awarded_points == question.points
