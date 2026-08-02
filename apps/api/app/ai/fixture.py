from app.ai.contracts import (
    ExplainCorrectionInput,
    ExplainCorrectionOutput,
    ExtractedSection,
    ExtractSourceInput,
    ExtractSourceOutput,
    GenerateAudioInput,
    GenerateAudioOutput,
    GeneratedQuestion,
    GenerateQuestionsInput,
    GenerateQuestionsOutput,
    GradeResponseInput,
    GradeResponseOutput,
)
from app.domain.models import GradingOutcome, QuestionType


class FixtureAIAdapter:
    """Deterministic contract adapter used by tests; never calls an AI service."""

    def extract_source(self, request: ExtractSourceInput) -> ExtractSourceOutput:
        return ExtractSourceOutput(
            detected_language=request.requested_language or "en",
            sections=[
                ExtractedSection(
                    title="Fixture lesson",
                    text="Present simple and difference-of-squares source material.",
                    page_numbers=[page.page_number for page in request.pages],
                    knowledge_points=["present-simple", "difference-of-squares"],
                )
            ],
            confidence=0.99,
        )

    def generate_questions(
        self,
        request: GenerateQuestionsInput,
    ) -> GenerateQuestionsOutput:
        fixtures = [
            GeneratedQuestion(
                client_id="fixture-choice",
                type=QuestionType.SINGLE_CHOICE,
                prompt="Choose the correct present-simple sentence.",
                options=["She walk.", "She walks.", "She walking."],
                answer_key={"choice": 1},
                grading_guide="Choice 1 is correct.",
                difficulty=request.difficulty,
                knowledge_points=["present-simple"],
            ),
            GeneratedQuestion(
                client_id="fixture-text",
                type=QuestionType.TYPED_TEXT,
                prompt="Complete: He ___ tennis.",
                answer_key={"text": "plays"},
                grading_guide="Accept plays, ignoring surrounding whitespace.",
                difficulty=request.difficulty,
                knowledge_points=["present-simple"],
            ),
            GeneratedQuestion(
                client_id="fixture-handwriting",
                type=QuestionType.HANDWRITING,
                prompt="Show why (a+b)(a-b)=a²-b².",
                answer_key={"reference": "Expand and cancel the middle terms."},
                grading_guide="The reasoning and final identity must both be visible.",
                difficulty=request.difficulty,
                knowledge_points=["difference-of-squares"],
                points=2,
            ),
        ]
        questions = [
            GeneratedQuestion.model_validate(
                fixtures[index % len(fixtures)].model_dump()
                | {"client_id": f"fixture-{index + 1}"}
            )
            for index in range(request.count)
        ]
        return GenerateQuestionsOutput(questions=questions, confidence=0.99)

    def grade_response(self, request: GradeResponseInput) -> GradeResponseOutput:
        expected = request.question.answer_key.get("choice")
        actual = request.response.get("choices")
        correct = expected is not None and actual == [expected]
        feedback = {
            "en": {True: "Correct.", False: "Try again."},
            "ja": {True: "正解です。", False: "もう一度解いてみましょう。"},
            "zh": {True: "正确。", False: "请再试一次。"},
        }[request.language][correct]
        return GradeResponseOutput(
            outcome=(
                GradingOutcome.CORRECT if correct else GradingOutcome.INCORRECT
            ),
            awarded_points=request.question.points if correct else 0,
            confidence=0.99,
            evidence=["Deterministic fixture comparison."],
            feedback=feedback,
        )

    def explain_correction(
        self,
        request: ExplainCorrectionInput,
    ) -> ExplainCorrectionOutput:
        return ExplainCorrectionOutput(
            hint="Check the verb ending or the sign in the middle.",
            explanation="Use the grading guide and compare one step at a time.",
            confidence=0.98,
        )

    def generate_audio(self, request: GenerateAudioInput) -> GenerateAudioOutput:
        return GenerateAudioOutput(
            media_type="audio/mpeg",
            storage_path="fixture/audio/listening.mp3",
            duration_seconds=max(1.0, len(request.transcript.split()) * 0.45),
            confidence=0.99,
        )
