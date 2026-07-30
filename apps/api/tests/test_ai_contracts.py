import pytest
from PIL import Image
from pydantic import ValidationError

from app.ai.codex_cli import CodexCLIGradingAdapter
from app.ai.contracts import (
    ExtractSourceInput,
    GeneratedQuestion,
    GenerateQuestionsInput,
    GradeResponseInput,
    GradeResponseOutput,
    SourcePageInput,
)
from app.ai.fixture import FixtureAIAdapter
from app.ai.handwriting import render_strokes_png
from app.domain.models import (
    GradingOutcome,
    Job,
    Question,
    QuestionType,
    ResponseKind,
    SavedResponse,
)
from app.services.grading import FixtureGrader, grade_response_with_ai


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


def test_handwriting_strokes_render_to_a_clean_png(tmp_path) -> None:
    image_path = render_strokes_png(
        {
            "canvas_size": {"width": 1200, "height": 700},
            "strokes": [
                {
                    "points": [
                        {"x": 100, "y": 150, "pressure": 0.5},
                        {"x": 420, "y": 360, "pressure": 0.7},
                    ],
                    "width": 4,
                    "eraser": False,
                }
            ],
        },
        tmp_path / "answer.png",
    )

    with Image.open(image_path) as rendered:
        assert rendered.format == "PNG"
        assert rendered.size == (1200, 700)
        assert rendered.getbbox() == (0, 0, 1200, 700)
        assert rendered.getpixel((260, 255)) != (255, 255, 255)


def test_codex_cli_grades_anonymous_handwriting_with_a_locked_down_command() -> None:
    observed: dict[str, object] = {}

    def fake_runner(command: list[str], timeout_seconds: int) -> None:
        observed["command"] = command
        observed["timeout_seconds"] = timeout_seconds
        image_path = command[command.index("--image") + 1]
        with Image.open(image_path) as rendered:
            observed["image_format"] = rendered.format
        output_path = command[command.index("--output-last-message") + 1]
        with open(output_path, "w", encoding="utf-8") as output:
            output.write(
                """
                {
                  "schema_version": "1.0",
                  "outcome": "correct",
                  "awarded_points": 2,
                  "confidence": 0.94,
                  "evidence": ["The handwritten sentence joins both clauses with that."],
                  "feedback": "The sentence is grammatically complete."
                }
                """
            )

    adapter = CodexCLIGradingAdapter(
        runner=fake_runner,
        timeout_seconds=60,
    )
    grade = adapter.grade_response(
        GradeResponseInput(
            question=GeneratedQuestion(
                client_id="question-32",
                type="handwriting",
                prompt=(
                    "Combine the sentences with that: "
                    "I think. This plan is useful."
                ),
                answer_key={
                    "reference": "I think that this plan is useful."
                },
                grading_guide=(
                    "Accept an equivalent complete sentence using that."
                ),
                difficulty="standard",
                knowledge_points=["that-clause"],
                points=2,
            ),
            response={
                "kind": "strokes",
                "canvas_size": {"width": 1200, "height": 700},
                "strokes": [
                    {
                        "points": [[100, 150], [420, 360]],
                        "width": 4,
                    }
                ],
            },
        )
    )

    command = observed["command"]
    assert isinstance(command, list)
    assert command[:2] == ["codex", "exec"]
    assert "--ephemeral" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert "--ignore-user-config" in command
    assert "--ignore-rules" in command
    assert observed["image_format"] == "PNG"
    assert observed["timeout_seconds"] == 60
    assert grade.outcome == "correct"
    assert grade.awarded_points == 2
    assert grade.confidence == 0.94


def test_low_confidence_visual_grade_is_routed_to_human_review() -> None:
    class LowConfidenceVisualAdapter:
        version = "codex-cli-v1"

        def grade_response(
            self,
            _request: GradeResponseInput,
        ) -> GradeResponseOutput:
            return GradeResponseOutput(
                outcome="correct",
                awarded_points=2,
                confidence=0.62,
                evidence=["The final words are hard to distinguish."],
                feedback="The answer may be correct, but the image is unclear.",
            )

    job = Job(
        family_id="00000000-0000-0000-0000-000000000001",
        subject_id="00000000-0000-0000-0000-000000000002",
    )
    question = Question(
        family_id=job.family_id,
        question_set_id="00000000-0000-0000-0000-000000000003",
        position=1,
        type=QuestionType.HANDWRITING,
        prompt="Combine the sentences with that.",
        answer_key={"reference": "I think that this plan is useful."},
        points=2,
    )
    response = SavedResponse(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        kind=ResponseKind.STROKES,
        answer={"strokes": [{"points": [[10, 10], [20, 20]]}]},
    )

    result = grade_response_with_ai(
        job,
        question,
        response,
        visual_adapter=LowConfidenceVisualAdapter(),
        grading_guide="Accept an equivalent complete sentence.",
        minimum_confidence=0.75,
    )

    assert result.outcome == "uncertain"
    assert result.awarded_points is None
    assert result.confidence == 0.62
    assert result.grader_version == "codex-cli-v1"
    assert result.feedback["evidence"] == [
        "The final words are hard to distinguish."
    ]


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


@pytest.mark.parametrize(
    ("answer_key", "actual_text"),
    [
        ({"text": "She goes home."}, "  SHE   GOES HOME.  "),
        ({"text": "ABC 123"}, "ＡＢＣ　１２３"),
        ({"texts": ["do not", "don't"]}, "DON'T"),
    ],
)
def test_fixture_grader_normalizes_exact_text_and_accepts_alternatives(
    answer_key: dict[str, object],
    actual_text: str,
) -> None:
    job = Job(
        family_id="00000000-0000-0000-0000-000000000001",
        subject_id="00000000-0000-0000-0000-000000000002",
    )
    question = Question(
        family_id=job.family_id,
        question_set_id="00000000-0000-0000-0000-000000000003",
        position=1,
        type=QuestionType.TYPED_TEXT,
        prompt="Fixture",
        answer_key=answer_key,
    )
    response = SavedResponse(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        kind=ResponseKind.TEXT,
        answer={"text": actual_text},
    )

    result = FixtureGrader().grade(job, question, response)

    assert result.outcome == GradingOutcome.CORRECT
    assert result.awarded_points == question.points


@pytest.mark.parametrize("response_kind", [ResponseKind.STROKES, ResponseKind.PHOTO])
def test_fixture_grader_routes_visual_answers_to_parent_review(
    response_kind: ResponseKind,
) -> None:
    job = Job(
        family_id="00000000-0000-0000-0000-000000000001",
        subject_id="00000000-0000-0000-0000-000000000002",
    )
    question = Question(
        family_id=job.family_id,
        question_set_id="00000000-0000-0000-0000-000000000003",
        position=1,
        type=QuestionType.HANDWRITING,
        prompt="Show your work.",
        answer_key={"reference": "Parent review"},
    )
    response = SavedResponse(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        kind=response_kind,
        answer={"strokes": []} if response_kind == ResponseKind.STROKES else {"paths": []},
    )

    result = FixtureGrader().grade(job, question, response)

    assert result.outcome == GradingOutcome.NEEDS_PARENT_REVIEW
    assert result.awarded_points is None
    assert result.confidence == 0
    assert result.feedback["summary"] == "Waiting for a parent to review."
