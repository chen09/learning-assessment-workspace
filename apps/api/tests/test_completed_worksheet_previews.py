import pytest

from app.domain.models import CompletedWorksheetImport, Job
from app.repositories.postgres import PostgresRepository


@pytest.mark.asyncio
async def test_completed_worksheet_preview_only_contains_signed_response_urls() -> None:
    """Original scans stay private paths; the parent receives brief URLs only."""
    repository = PostgresRepository(
        "postgresql+asyncpg://unused:unused@127.0.0.1/unused",
        supabase_url="https://supabase.example.test",
        service_role_key="test-service-role",
    )
    imported = CompletedWorksheetImport(
        family_id="00000000-0000-0000-0000-000000000001",
        child_id="00000000-0000-0000-0000-000000000002",
        title="Completed factorisation paper",
        subject="Mathematics",
        document_language="ja",
        feedback_language="zh",
        filenames=["page-1.jpg", "page-2.jpg"],
        response_paths=[
            "family-1/attempt-1/page-1.jpg",
            "family-1/attempt-1/page-2.jpg",
        ],
        answer_source_paths=["family-1/answers/private-key.pdf"],
        job=Job(
            family_id="00000000-0000-0000-0000-000000000001",
            subject_id="00000000-0000-0000-0000-000000000003",
            type="analyze_completed_worksheet",
        ),
    )

    async def sign_only_the_uploaded_scan(paths: list[str]) -> dict[str, str]:
        assert paths == imported.response_paths
        return {
            imported.response_paths[1]: "https://storage.example.test/signed/page-2",
            imported.response_paths[0]: "https://storage.example.test/signed/page-1",
        }

    repository._sign_response_photo_urls = sign_only_the_uploaded_scan  # type: ignore[method-assign]
    try:
        previewed = await repository._with_completed_worksheet_previews(imported)
    finally:
        await repository.close()

    assert previewed.response_paths == imported.response_paths
    assert previewed.answer_source_paths == imported.answer_source_paths
    assert previewed.response_preview_urls == [
        "https://storage.example.test/signed/page-1",
        "https://storage.example.test/signed/page-2",
    ]


@pytest.mark.asyncio
async def test_completed_worksheet_preview_hides_all_pages_when_signing_is_incomplete() -> None:
    """A partial Storage reply must not shift a later page under an earlier label."""
    repository = PostgresRepository(
        "postgresql+asyncpg://unused:unused@127.0.0.1/unused",
        supabase_url="https://supabase.example.test",
        service_role_key="test-service-role",
    )
    imported = CompletedWorksheetImport(
        family_id="00000000-0000-0000-0000-000000000001",
        child_id="00000000-0000-0000-0000-000000000002",
        title="Completed factorisation paper",
        subject="Mathematics",
        document_language="ja",
        feedback_language="zh",
        filenames=["page-1.jpg", "page-2.jpg"],
        response_paths=[
            "family-1/attempt-1/page-1.jpg",
            "family-1/attempt-1/page-2.jpg",
        ],
        job=Job(
            family_id="00000000-0000-0000-0000-000000000001",
            subject_id="00000000-0000-0000-0000-000000000003",
            type="analyze_completed_worksheet",
        ),
    )

    async def sign_only_one_page(paths: list[str]) -> dict[str, str]:
        assert paths == imported.response_paths
        return {imported.response_paths[1]: "https://storage.example.test/signed/page-2"}

    repository._sign_response_photo_urls = sign_only_one_page  # type: ignore[method-assign]
    try:
        previewed = await repository._with_completed_worksheet_previews(imported)
    finally:
        await repository.close()

    assert previewed.response_preview_urls == []
