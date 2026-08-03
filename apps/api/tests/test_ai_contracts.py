import json

import pytest
from PIL import Image
from pydantic import ValidationError

from app.ai.codex_cli import CodexCLIGradingAdapter
from app.ai.contracts import (
    CompletedWorksheetAnalysisInput,
    ExtractSourceInput,
    GeneratedQuestion,
    GenerateQuestionsInput,
    GradeResponseInput,
    GradeResponseOutput,
    SourcePageInput,
)
from app.ai.fixture import FixtureAIAdapter
from app.ai.handwriting import render_strokes_png
from app.config import Settings
from app.domain.models import (
    GradingOutcome,
    Job,
    Question,
    QuestionType,
    ResponseKind,
    SavedResponse,
)
from app.services.database_jobs import _visual_adapter_for_family
from app.services.grading import FixtureGrader, grade_response_with_ai


def _grading_prompt_from_command(command: list[str]) -> str:
    return next(value for value in command if value.startswith("Grade one anonymous"))


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
            language="zh",
            question=first.questions[0],
            response={"kind": "choice", "choices": [1]},
        )
    )

    assert first == second
    assert len(first.questions) == 3
    assert 0 <= extracted.confidence <= 1
    assert grade.outcome == "correct"
    assert grade.confidence >= 0.95
    assert grade.feedback == "正确。"


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
        schema_path = command[command.index("--output-schema") + 1]
        with open(schema_path, encoding="utf-8") as schema_file:
            observed["output_schema"] = json.load(schema_file)
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
    output_schema = observed["output_schema"]
    assert isinstance(output_schema, dict)
    assert set(output_schema["required"]) == set(output_schema["properties"])
    assert set(output_schema["$defs"]["GradeAnnotation"]["required"]) == {
        "kind",
        "page_index",
        "x",
        "y",
        "width",
        "height",
        "label",
    }
    assert grade.outcome == "correct"
    assert grade.awarded_points == 2
    assert grade.confidence == 0.94


def test_codex_cli_grades_private_photo_pages_in_order(tmp_path) -> None:
    observed: dict[str, object] = {}
    first_page = tmp_path / "answer-page-1.png"
    second_page = tmp_path / "answer-page-2.png"
    Image.new("RGB", (20, 20), "white").save(first_page)
    Image.new("RGB", (20, 20), "white").save(second_page)

    def fake_runner(command: list[str], _timeout_seconds: int) -> None:
        observed["command"] = command
        image_paths = [
            command[index + 1]
            for index, value in enumerate(command)
            if value == "--image"
        ]
        observed["image_paths"] = image_paths
        observed["prompt"] = _grading_prompt_from_command(command)
        output_path = command[command.index("--output-last-message") + 1]
        with open(output_path, "w", encoding="utf-8") as output:
            output.write(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "outcome": "correct",
                        "awarded_points": 1,
                        "confidence": 0.98,
                        "evidence": ["The photographed answer is legible."],
                        "feedback": "Correct.",
                    }
                )
            )

    grade = CodexCLIGradingAdapter(runner=fake_runner).grade_response(
        GradeResponseInput(
            question=GeneratedQuestion(
                client_id="photo-question",
                type="handwriting",
                prompt="因数分解しなさい。",
                answer_key={"reference": "(x - 2)(x + 2)"},
                grading_guide="Accept equivalent factorisations.",
                difficulty="standard",
                knowledge_points=["factorisation"],
                points=1,
            ),
            response={
                "kind": "photo",
                "paths": ["family-id/response/page-1.png"],
            },
            attachment_paths=[str(first_page), str(second_page)],
            language="ja",
        )
    )

    assert observed["image_paths"] == [str(first_page), str(second_page)]
    command = observed["command"]
    assert isinstance(command, list)
    assert command.index(str(observed["prompt"])) < command.index("--image")
    assert "photographed answer" in str(observed["prompt"])
    assert "page order" in str(observed["prompt"])
    assert grade.outcome == GradingOutcome.CORRECT


def test_codex_cli_extracts_private_source_pages_without_storage_paths(tmp_path) -> None:
    observed: dict[str, object] = {}
    source_page = tmp_path / "source-page.png"
    Image.new("RGB", (20, 20), "white").save(source_page)

    def fake_runner(command: list[str], timeout_seconds: int) -> None:
        observed["command"] = command
        observed["timeout_seconds"] = timeout_seconds
        schema_path = command[command.index("--output-schema") + 1]
        with open(schema_path, encoding="utf-8") as schema_file:
            observed["output_schema"] = json.load(schema_file)
        output_path = command[command.index("--output-last-message") + 1]
        with open(output_path, "w", encoding="utf-8") as output:
            output.write(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "detected_language": "ja",
                        "sections": [
                            {
                                "title": "Lesson 1",
                                "text": "Private textbook wording.",
                                "page_numbers": [1],
                                "knowledge_points": [
                                    "等位接続詞 and / but / or / so"
                                ],
                            }
                        ],
                        "confidence": 0.91,
                        "warnings": [],
                    }
                )
            )

    result = CodexCLIGradingAdapter(runner=fake_runner).extract_source_material(
        ExtractSourceInput(
            requested_language="ja",
            pages=[
                SourcePageInput(
                    page_number=1,
                    media_type="image/jpeg",
                    storage_path="family-id/sources/private-book-page.jpg",
                )
            ],
        ),
        source_page_images=[source_page],
    )

    command = observed["command"]
    assert isinstance(command, list)
    assert command[:2] == ["codex", "exec"]
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert command.count("--image") == 1
    prompt = next(value for value in command if value.startswith("Read anonymous"))
    assert "family-id" not in prompt
    assert "private-book-page" not in prompt
    assert command.index(prompt) < command.index("--image")
    assert observed["timeout_seconds"] == 180
    assert result.detected_language == "ja"
    assert result.sections[0].knowledge_points == ["等位接続詞 and / but / or / so"]


def test_codex_cli_only_returns_a_parent_review_draft_for_completed_paper(
    tmp_path,
) -> None:
    observed: dict[str, object] = {}
    page_path = tmp_path / "worksheet.png"
    Image.new("RGB", (20, 20), "white").save(page_path)

    def fake_runner(command: list[str], timeout_seconds: int) -> None:
        observed["command"] = command
        observed["timeout_seconds"] = timeout_seconds
        schema_path = command[command.index("--output-schema") + 1]
        with open(schema_path, encoding="utf-8") as schema_file:
            observed["output_schema"] = json.load(schema_file)
        output_path = command[command.index("--output-last-message") + 1]
        with open(output_path, "w", encoding="utf-8") as output:
            output.write(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "status": "needs_parent_confirmation",
                        "document": {
                            "question_set": {
                                "title": "Factorisation review",
                                "subject": "Mathematics",
                                "locale": "ja",
                                "difficulty": "standard",
                                "instructions": "Answer every question.",
                                "estimated_minutes": 10,
                            },
                            "knowledge_tags": [
                                {"code": "factorisation", "label": "Factorisation"}
                            ],
                            "questions": [
                                {
                                    "position": 1,
                                    "type": "handwriting",
                                    "prompt": "因数分解しなさい。",
                                    "options": [],
                                    "answer_key": {"reference": "(x - 4)(x + 4)"},
                                    "rubric": {"grading_mode": "parent_review"},
                                    "points": 1,
                                    "knowledge_code": "factorisation",
                                }
                            ],
                        },
                        "answer_regions": [
                            {
                                "question_position": 1,
                                "page_numbers": [1],
                                "legibility": "clear",
                            }
                        ],
                        "confidence": 0.82,
                        "warnings": ["Parent confirmation is required."],
                    }
                )
            )

    result = CodexCLIGradingAdapter(runner=fake_runner).analyze_completed_worksheet(
        CompletedWorksheetAnalysisInput(
            document_language="ja",
            feedback_language="zh",
            source_page_count=1,
        ),
        response_page_images=[page_path],
    )

    command = observed["command"]
    assert isinstance(command, list)
    assert command[:2] == ["codex", "exec"]
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert command.count("--image") == 1
    completed_prompt = next(
        value for value in command if value.startswith("Read anonymous images")
    )
    assert command.index(completed_prompt) < command.index("--image")
    assert "needs_parent_confirmation" in completed_prompt
    output_schema = observed["output_schema"]
    assert isinstance(output_schema, dict)
    assert '"additionalProperties": true' not in json.dumps(output_schema)
    assert observed["timeout_seconds"] == 180
    assert result.status == "needs_parent_confirmation"
    assert result.document.questions[0].type == QuestionType.HANDWRITING


def test_codex_cli_requests_feedback_in_the_child_language() -> None:
    observed: dict[str, str] = {}

    def fake_runner(command: list[str], _timeout_seconds: int) -> None:
        observed["prompt"] = _grading_prompt_from_command(command)
        output_path = command[command.index("--output-last-message") + 1]
        with open(output_path, "w", encoding="utf-8") as output:
            output.write(
                """
                {
                  "schema_version": "1.0",
                  "outcome": "incorrect",
                  "awarded_points": 0,
                  "confidence": 0.95,
                  "evidence": ["目的地が書かれていません。"],
                  "feedback": "Canada を含む完全な文に直しましょう。"
                }
                """
            )

    grade = CodexCLIGradingAdapter(runner=fake_runner).grade_response(
        GradeResponseInput(
            language="ja",
            question=GeneratedQuestion(
                client_id="question-33",
                type="handwriting",
                prompt="Write a sentence about a trip to Canada.",
                answer_key={"reference": "Ms. Brown moved to Canada."},
                grading_guide="The destination Canada is required.",
                difficulty="standard",
                knowledge_points=["past-tense"],
                points=2,
            ),
            response={
                "kind": "strokes",
                "canvas_size": {"width": 900, "height": 420},
                "strokes": [
                    {
                        "points": [[100, 150], [420, 360]],
                        "width": 4,
                    }
                ],
            },
        )
    )

    assert "Response language: Japanese (ja)." in observed["prompt"]
    assert grade.feedback == "Canada を含む完全な文に直しましょう。"


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
                annotations=[
                    {
                        "kind": "underline",
                        "x": 0.68,
                        "y": 0.54,
                        "width": 0.21,
                        "height": 0.08,
                        "label": "Check these words.",
                    }
                ],
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
        feedback_language="zh",
    )

    assert result.outcome == "uncertain"
    assert result.awarded_points is None
    assert result.confidence == 0.62
    assert result.grader_version == "codex-cli-v1"
    assert result.feedback["evidence"] == ["The final words are hard to distinguish."]
    assert result.feedback["annotations"] == [
        {
            "kind": "underline",
            "page_index": 0,
            "x": 0.68,
            "y": 0.54,
            "width": 0.21,
            "height": 0.08,
            "label": "Check these words.",
        }
    ]
    assert result.feedback["action"] == "请家长确认这份答案。"


def test_photo_response_uses_visual_grader_only_with_private_attachment() -> None:
    observed: list[GradeResponseInput] = []

    class PhotoVisualAdapter:
        version = "codex-cli-v1"

        def grade_response(self, request: GradeResponseInput) -> GradeResponseOutput:
            observed.append(request)
            return GradeResponseOutput(
                outcome="correct",
                awarded_points=2,
                confidence=0.98,
                evidence=["The photographed work is readable."],
                feedback="Correct.",
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
        prompt="因数分解しなさい。",
        answer_key={"reference": "(x - 2)(x + 2)"},
        points=2,
    )
    response = SavedResponse(
        family_id=job.family_id,
        attempt_id=job.subject_id,
        question_id=question.id,
        kind=ResponseKind.PHOTO,
        answer={"paths": ["family-id/attempt/page-1.jpg"]},
    )

    result = grade_response_with_ai(
        job,
        question,
        response,
        visual_adapter=PhotoVisualAdapter(),
        attachment_paths=["/private/worker/page-1.jpg"],
        feedback_language="ja",
    )

    assert result.outcome == GradingOutcome.CORRECT
    assert observed[0].attachment_paths == ["/private/worker/page-1.jpg"]
    assert observed[0].response["kind"] == "photo"

    unavailable = grade_response_with_ai(
        job,
        question,
        response,
        visual_adapter=PhotoVisualAdapter(),
        feedback_language="ja",
    )

    assert unavailable.outcome == GradingOutcome.NEEDS_PARENT_REVIEW
    assert len(observed) == 1


def test_visual_grading_adapter_is_limited_to_allowed_families() -> None:
    adapter = FixtureAIAdapter()

    assert (
        _visual_adapter_for_family(
            adapter,
            family_id="family-a",
            allowed_family_ids=frozenset({"family-a"}),
        )
        is adapter
    )
    assert (
        _visual_adapter_for_family(
            adapter,
            family_id="family-b",
            allowed_family_ids=frozenset({"family-a"}),
        )
        is None
    )


def test_codex_family_allowlist_is_loaded_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CODEX_FAMILY_IDS", '["family-a", "family-b"]')

    settings = Settings(_env_file=None)

    assert settings.codex_family_ids == ("family-a", "family-b")


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
