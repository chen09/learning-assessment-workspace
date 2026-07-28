import cv2
import numpy as np

from app.services.paper_pipeline import (
    A4_PIXEL_SIZE,
    AnswerRegion,
    normalize_paper_scan,
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
