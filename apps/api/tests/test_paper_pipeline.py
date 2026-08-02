import cv2
import numpy as np
import pytest
from pypdf import PdfWriter

from app.services.database_jobs import (
    _completed_worksheet_failure_code,
    fixture_job_handler,
)
from app.services.paper_pipeline import (
    A4_PIXEL_SIZE,
    AnswerRegion,
    normalize_paper_scan,
    render_pdf_pages,
    split_answer_regions,
)


def synthetic_scan() -> bytes:
    image = np.full((1500, 1100, 3), 220, dtype=np.uint8)
    page = np.array([[80, 60], [1010, 110], [1040, 1430], [55, 1390]])
    cv2.fillConvexPoly(image, page, (255, 255, 255))
    cv2.polylines(image, [page], True, (0, 0, 0), 10)
    cv2.putText(
        image,
        "a2 - b2",
        (220, 650),
        cv2.FONT_HERSHEY_SIMPLEX,
        2,
        (0, 0, 0),
        5,
    )
    encoded, result = cv2.imencode(".jpg", image)
    assert encoded
    return result.tobytes()


def test_paper_scan_is_rectified_to_a4_and_split_by_question_coordinates() -> None:
    image_bytes = synthetic_scan()

    normalized = normalize_paper_scan(image_bytes)
    answers = split_answer_regions(
        image_bytes,
        [
            AnswerRegion(
                question_id="question-1",
                x=0.1,
                y=0.25,
                width=0.8,
                height=0.35,
            )
        ],
    )
    decoded_answer = cv2.imdecode(
        np.frombuffer(answers[0].jpeg_bytes, dtype=np.uint8),
        cv2.IMREAD_COLOR,
    )

    assert normalized.shape[1::-1] == A4_PIXEL_SIZE
    assert len(answers) == 1
    assert answers[0].question_id == "question-1"
    assert decoded_answer is not None
    assert decoded_answer.shape[0] > 400


def test_completed_pdf_is_rendered_to_one_image_per_page(tmp_path) -> None:
    """Whole-paper visual grading must see every PDF page in reading order."""
    pdf_path = tmp_path / "completed-paper.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.add_blank_page(width=612, height=792)
    with pdf_path.open("wb") as output:
        writer.write(output)

    pages = render_pdf_pages(pdf_path, tmp_path / "rendered")

    assert [page.name for page in pages] == ["page-1.png", "page-2.png"]
    assert all(cv2.imread(str(page)) is not None for page in pages)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("The scan PDF has more than 100 pages.", "pdf_too_many_pages"),
        ("The scan is not a readable PDF.", "pdf_unreadable"),
        ("PDF rendering timed out.", "pdf_render_timeout"),
        ("Worksheet scan exceeds the 15 MB analysis limit.", "scan_too_large"),
        ("Worksheet scan has more than 100 analysis pages.", "scan_too_many_pages"),
        ("Storage service temporarily failed.", "worker_error"),
    ],
)
def test_completed_paper_failures_use_safe_parent_facing_codes(
    message: str,
    expected: str,
) -> None:
    """Raw errors never become parent-facing completed-paper copy."""
    assert _completed_worksheet_failure_code(RuntimeError(message)) == expected


@pytest.mark.asyncio
async def test_completed_paper_without_an_allowed_ai_adapter_stays_manual_review() -> None:
    executed: list[tuple[str, object, object]] = []

    class FakeConnection:
        async def fetchrow(self, _query: str, _worksheet_id: object):
            return {
                "id": "worksheet-1",
                "family_id": "family-1",
                "child_id": "child-1",
                "title": "Completed worksheet",
                "subject": "English",
                "document_language": "en",
                "feedback_language": "zh",
                "filenames": ["page-1.jpg"],
                "response_paths": ["family-1/worksheet/page-1.jpg"],
                "answer_source_paths": ["family-1/worksheet/answer-key.jpg"],
                "reference_source_paths": [],
            }

        async def execute(self, query: str, worksheet_id: object, extraction: object):
            executed.append((query, worksheet_id, extraction))

    result = await fixture_job_handler(
        FakeConnection(),  # type: ignore[arg-type]
        {
            "type": "analyze_completed_worksheet",
            "subject_id": "worksheet-1",
        },
    )

    assert result["adapter"] == "fixture-v1"
    assert result["status"] == "needs_review"
    assert len(executed) == 1
    extraction = executed[0][2]
    assert isinstance(extraction, str)
    assert '"needs_parent_confirmation"' in extraction
    assert '"question_units": []' in extraction
