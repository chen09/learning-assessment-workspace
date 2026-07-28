from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import GradingOutcome, QuestionType


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourcePageInput(StrictContract):
    page_number: int = Field(ge=1)
    media_type: Literal["application/pdf", "image/png", "image/jpeg"]
    storage_path: str = Field(min_length=3)


class ExtractSourceInput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    pages: list[SourcePageInput] = Field(min_length=1, max_length=100)
    requested_language: Literal["en", "ja", "zh"] | None = None


class ExtractedSection(StrictContract):
    title: str
    text: str
    page_numbers: list[int]
    knowledge_points: list[str]


class ExtractSourceOutput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    detected_language: Literal["en", "ja", "zh"]
    sections: list[ExtractedSection]
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = []


class GeneratedQuestion(StrictContract):
    client_id: str
    type: QuestionType
    prompt: str
    options: list[str] | None = None
    answer_key: dict[str, Any]
    grading_guide: str
    difficulty: Literal["foundation", "standard", "challenge"]
    knowledge_points: list[str]
    points: float = Field(default=1, gt=0)


class GenerateQuestionsInput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    source: ExtractSourceOutput | None = None
    learning_goal: str | None = None
    subject: str
    target_level: str
    difficulty: Literal["foundation", "standard", "challenge"]
    count: int = Field(ge=1, le=30)


class GenerateQuestionsOutput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    questions: list[GeneratedQuestion]
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = []


class GradeResponseInput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    question: GeneratedQuestion
    response: dict[str, Any]
    attachment_paths: list[str] = []


class GradeResponseOutput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    outcome: GradingOutcome
    awarded_points: float | None
    confidence: float = Field(ge=0, le=1)
    evidence: list[str]
    feedback: str


class ExplainCorrectionInput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    question: GeneratedQuestion
    previous_response: dict[str, Any]
    outcome: GradingOutcome
    language: Literal["en", "ja", "zh"]


class ExplainCorrectionOutput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    hint: str
    explanation: str
    confidence: float = Field(ge=0, le=1)


class GenerateAudioInput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    transcript: str
    language: Literal["en", "ja", "zh"]
    voice_hint: str | None = None


class GenerateAudioOutput(StrictContract):
    schema_version: Literal["1.0"] = "1.0"
    media_type: Literal["audio/mpeg", "audio/mp4"]
    storage_path: str
    duration_seconds: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)


class AIAdapter(Protocol):
    def extract_source(self, request: ExtractSourceInput) -> ExtractSourceOutput: ...

    def generate_questions(
        self, request: GenerateQuestionsInput
    ) -> GenerateQuestionsOutput: ...

    def grade_response(self, request: GradeResponseInput) -> GradeResponseOutput: ...

    def explain_correction(
        self, request: ExplainCorrectionInput
    ) -> ExplainCorrectionOutput: ...

    def generate_audio(self, request: GenerateAudioInput) -> GenerateAudioOutput: ...
