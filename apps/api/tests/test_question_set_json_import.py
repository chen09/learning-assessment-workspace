import json

import pytest
from pydantic import ValidationError

from app.tools.import_question_set import document_checksum, parse_import_document


def _valid_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "question_set": {
            "title": "Lesson 2 practice",
            "subject": "English",
            "locale": "ja",
            "difficulty": "standard",
            "source_mode": "convert",
            "instructions": "Answer every question.",
            "estimated_minutes": 20,
            "source_summary": {"unit": "Lesson 2"},
        },
        "knowledge_tags": [
            {"code": "if-condition", "label": "if condition"},
        ],
        "questions": [
            {
                "position": 1,
                "type": "single_choice",
                "prompt": "___ it rains, stay home.",
                "options": ["If", "Because"],
                "answer_key": {"choice": 0},
                "rubric": {"grading_mode": "exact"},
                "points": 1,
                "knowledge_code": "if-condition",
            },
        ],
    }


def test_parse_valid_ai_question_set() -> None:
    document = parse_import_document(json.dumps(_valid_payload()))

    assert document.question_set.title == "Lesson 2 practice"
    assert document.questions[0].answer_key == {"choice": 0}
    assert document.question_count == 1
    assert document.total_points == 1


def test_rejects_non_contiguous_question_positions() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0]["position"] = 2

    with pytest.raises(ValidationError, match="positions must be contiguous"):
        parse_import_document(json.dumps(payload))


def test_rejects_question_with_unknown_knowledge_code() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0]["knowledge_code"] = "missing-code"

    with pytest.raises(ValidationError, match="unknown knowledge code"):
        parse_import_document(json.dumps(payload))


def test_rejects_single_choice_answer_outside_options() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0]["answer_key"] = {"choice": 2}

    with pytest.raises(ValidationError, match="choice answer must index an option"):
        parse_import_document(json.dumps(payload))


def test_rejects_word_order_answer_with_different_token_inventory() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0].update(
        {
            "type": "word_order",
            "options": ["I", "study", "."],
            "answer_key": {"tokens": ["I", "study", "English", "."]},
        }
    )

    with pytest.raises(ValidationError, match="same token inventory"):
        parse_import_document(json.dumps(payload))


def test_document_checksum_is_independent_of_json_formatting() -> None:
    payload = _valid_payload()
    compact = parse_import_document(json.dumps(payload, separators=(",", ":")))
    pretty = parse_import_document(json.dumps(payload, indent=2))

    assert document_checksum(compact) == document_checksum(pretty)


def test_rejects_duplicate_knowledge_codes() -> None:
    payload = _valid_payload()
    tags = payload["knowledge_tags"]
    assert isinstance(tags, list)
    tags.append({"code": "if-condition", "label": "duplicate"})

    with pytest.raises(ValidationError, match="Knowledge tag codes must be unique"):
        parse_import_document(json.dumps(payload))


def test_rejects_exact_text_question_without_accepted_answers() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0].update(
        {
            "type": "typed_text",
            "options": [],
            "answer_key": {"texts": []},
        }
    )

    with pytest.raises(ValidationError, match="accepted answer"):
        parse_import_document(json.dumps(payload))


def test_rejects_handwriting_question_without_parent_review_reference() -> None:
    payload = _valid_payload()
    questions = payload["questions"]
    assert isinstance(questions, list)
    questions[0].update(
        {
            "type": "handwriting",
            "options": [],
            "answer_key": {},
            "rubric": {"grading_mode": "exact"},
        }
    )

    with pytest.raises(ValidationError, match="parent_review"):
        parse_import_document(json.dumps(payload))
