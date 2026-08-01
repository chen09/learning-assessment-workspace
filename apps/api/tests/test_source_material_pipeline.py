import json

import pytest

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
