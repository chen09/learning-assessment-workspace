import json
from pathlib import Path

import pytest

from app.ai.codex_cli import CodexCLIGradingAdapter
from app.services.database_jobs import fixture_job_handler


@pytest.mark.asyncio
async def test_production_source_material_waits_for_a_structured_draft(
) -> None:
    executed: list[tuple[str, tuple[object, ...]]] = []

    class FakeConnection:
        async def fetchrow(self, _query: str, _import_id: object):
            return {
                "id": "import-1",
                "family_id": "family-1",
                "question_set_id": "question-set-1",
                "filenames": ["lesson.pdf"],
                "answer_filenames": ["answers.pdf"],
                "reference_filenames": ["textbook.pdf"],
                "subject": "English",
            }

        async def execute(self, query: str, *args: object):
            executed.append((query, args))

    result = await fixture_job_handler(
        FakeConnection(),  # type: ignore[arg-type]
        {"type": "extract_source", "subject_id": "import-1"},
        allow_fixture_source_generation=False,
    )

    assert result["status"] == "needs_review"
    assert result["question_count"] == 0
    assert result["generation_status"] == "awaiting_structured_draft"
    question_set_update = next(
        args for query, args in executed if "update public.question_sets" in query
    )
    source_summary = json.loads(str(question_set_update[1]))
    assert source_summary == {
        "schema_version": "1.0",
        "artifact_kind": "private_source_material",
        "generation_status": "awaiting_structured_draft",
        "source_file_count": 1,
        "answer_key_file_count": 1,
        "reference_file_count": 1,
    }


@pytest.mark.asyncio
async def test_allowed_family_extracts_private_source_to_knowledge_points(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    executed: list[tuple[str, tuple[object, ...]]] = []
    observed_paths: list[str] = []
    source_page = tmp_path / "private-source-page.png"
    source_page.write_bytes(b"not-read-by-fake-runner")

    class FakeConnection:
        async def fetchrow(self, _query: str, _import_id: object):
            return {
                "id": "import-1",
                "family_id": "family-1",
                "question_set_id": "question-set-1",
                "filenames": ["worksheet.pdf"],
                "source_paths": ["family-1/imports/worksheet.pdf"],
                "answer_filenames": ["answers.pdf"],
                "answer_source_paths": ["family-1/imports/answers.pdf"],
                "reference_filenames": ["textbook.jpg"],
                "reference_source_paths": ["family-1/imports/textbook.jpg"],
                "subject": "English",
            }

        async def execute(self, query: str, *args: object):
            executed.append((query, args))

    async def fake_download(**kwargs: object) -> list[Path]:
        observed_paths.extend(kwargs["paths"])  # type: ignore[arg-type]
        return [source_page]

    def fake_runner(command: list[str], _timeout_seconds: int) -> None:
        output_path = command[command.index("--output-last-message") + 1]
        Path(output_path).write_text(
            json.dumps(
                {
                    "schema_version": "1.0",
                    "detected_language": "ja",
                    "sections": [
                        {
                            "title": "Lesson 1",
                            "text": "Never persisted textbook text.",
                            "page_numbers": [1],
                            "knowledge_points": [
                                "等位接続詞 and / but / or / so",
                                "感嘆文",
                            ],
                        }
                    ],
                    "confidence": 0.93,
                    "warnings": ["Page 1 is slightly tilted."],
                }
            ),
            encoding="utf-8",
        )

    monkeypatch.setattr(
        "app.services.database_jobs._download_private_analysis_pages",
        fake_download,
    )
    result = await fixture_job_handler(
        FakeConnection(),  # type: ignore[arg-type]
        {"type": "extract_source", "subject_id": "import-1"},
        visual_adapter=CodexCLIGradingAdapter(runner=fake_runner),
        allowed_visual_family_ids=frozenset({"family-1"}),
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role-for-test",
        allow_fixture_source_generation=False,
    )

    assert observed_paths == [
        "family-1/imports/worksheet.pdf",
        "family-1/imports/textbook.jpg",
    ]
    assert result["adapter"] == "codex-cli-v1"
    assert result["question_count"] == 0
    assert result["generation_status"] == "source_extracted"
    question_set_update = next(
        args for query, args in executed if "update public.question_sets" in query
    )
    source_summary = json.loads(str(question_set_update[1]))
    assert source_summary == {
        "schema_version": "1.0",
        "artifact_kind": "private_source_material",
        "generation_status": "source_extracted",
        "source_file_count": 1,
        "answer_key_file_count": 1,
        "reference_file_count": 1,
        "knowledge_points": ["等位接続詞 and / but / or / so", "感嘆文"],
        "extraction_confidence": 0.93,
        "extraction_section_count": 1,
        "extraction_warnings": ["Page 1 is slightly tilted."],
    }
    assert "Never persisted textbook text." not in json.dumps(source_summary)
