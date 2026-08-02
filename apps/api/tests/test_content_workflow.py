import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.domain.models import CompletedWorksheetStatus, Job, JobStatus, QuestionSetStatus
from app.main import create_app

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


def _structured_question_set() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "question_set": {
            "title": "Lesson 2 interactive practice",
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


def test_parent_can_preview_structured_json_without_creating_a_question_set() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    before = client.get(
        f"/v1/library/families/{fixture['family']['id']}/question-sets",
        headers=PARENT_HEADERS,
    ).json()

    preview = client.post(
        "/v1/question-sets/imports/structured/preview",
        headers=PARENT_HEADERS,
        json=_structured_question_set(),
    )
    after = client.get(
        f"/v1/library/families/{fixture['family']['id']}/question-sets",
        headers=PARENT_HEADERS,
    ).json()

    assert preview.status_code == 200
    assert preview.json()["title"] == "Lesson 2 interactive practice"
    assert preview.json()["question_count"] == 1
    assert preview.json()["answer_keys_present"] is True
    assert preview.json()["questions"][0]["answer_key"] == {"choice": 0}
    assert [item["id"] for item in after] == [item["id"] for item in before]


def test_parent_can_start_completed_worksheet_analysis_for_a_child() -> None:
    """A scanned, already-completed paper starts as a reviewable analysis.

    It must not silently create an assignment or an attempt before the parent
    has checked the AI's question boundaries and scoring draft.
    """
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()

    created = client.post(
        "/v1/completed-worksheets",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "completed-factorisation-day-four",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "title": "4日目・因数分解",
            "subject": "Mathematics",
            "document_language": "ja",
            "feedback_language": "zh",
            "filenames": ["day-4-factorisation.jpg"],
            "response_paths": [
                "family/completed/day-4-factorisation.jpg",
            ],
            "answer_source_paths": [
                "family/answer-keys/day-4-factorisation.pdf",
            ],
        },
    )
    repeated = client.post(
        "/v1/completed-worksheets",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "completed-factorisation-day-four",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "title": "4日目・因数分解",
            "subject": "Mathematics",
            "document_language": "ja",
            "feedback_language": "zh",
            "filenames": ["day-4-factorisation.jpg"],
            "response_paths": [
                "family/completed/day-4-factorisation.jpg",
            ],
            "answer_source_paths": [
                "family/answer-keys/day-4-factorisation.pdf",
            ],
        },
    )

    assert created.status_code == 202
    payload = created.json()
    assert payload["status"] == "processing"
    assert payload["job"]["type"] == "analyze_completed_worksheet"
    assert payload["assignment_id"] is None
    assert payload["attempt_id"] is None
    assert repeated.json()["id"] == payload["id"]

    processed = client.post(
        "/v1/demo/jobs/process-next",
        headers=PARENT_HEADERS,
    )
    refreshed = client.get(
        f"/v1/completed-worksheets/{payload['id']}",
        headers=PARENT_HEADERS,
    )

    assert processed.status_code == 200
    assert processed.json()["status"] == "succeeded"
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "needs_review"
    assert refreshed.json()["job"]["status"] == "succeeded"


def test_parent_can_reopen_a_pending_completed_worksheet_from_the_family_list() -> None:
    """A parent must be able to recover a paper-analysis draft after leaving its page."""
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()

    created = client.post(
        "/v1/completed-worksheets",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "list-pending-completed-worksheet",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "title": "Scanned algebra practice",
            "subject": "Mathematics",
            "document_language": "ja",
            "feedback_language": "en",
            "filenames": ["algebra-practice.jpg"],
            "response_paths": ["family/responses/algebra-practice.jpg"],
        },
    )
    listed = client.get(
        f"/v1/completed-worksheets/families/{fixture['family']['id']}",
        headers=PARENT_HEADERS,
    )

    assert created.status_code == 202
    assert listed.status_code == 200
    assert listed.json() == [
        {
            "id": created.json()["id"],
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "child_nickname": fixture["child"]["nickname"],
            "title": "Scanned algebra practice",
            "subject": "Mathematics",
            "status": "processing",
            "job_status": "queued",
        }
    ]


def test_parent_can_retry_a_failed_completed_worksheet_analysis() -> None:
    """Retry returns the private paper to a pollable processing state."""
    application = create_app()
    client = TestClient(application)
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    created = client.post(
        "/v1/completed-worksheets",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "retry-completed-paper-analysis",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "title": "Retryable completed paper",
            "subject": "Mathematics",
            "document_language": "ja",
            "feedback_language": "ja",
            "filenames": ["retryable-paper.jpg"],
            "response_paths": ["family/completed/retryable-paper.jpg"],
        },
    )
    assert created.status_code == 202
    worksheet_id = created.json()["id"]
    job_id = created.json()["job"]["id"]
    repository = application.state.repository
    repository.jobs[job_id].status = JobStatus.FAILED
    repository.completed_worksheet_imports[worksheet_id].status = (
        CompletedWorksheetStatus.FAILED
    )

    retried = client.post(
        f"/v1/jobs/{job_id}/retry",
        headers=PARENT_HEADERS,
    )
    refreshed = client.get(
        f"/v1/completed-worksheets/{worksheet_id}",
        headers=PARENT_HEADERS,
    )

    assert retried.status_code == 200
    assert retried.json()["status"] == "queued"
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "processing"
    assert refreshed.json()["job"]["status"] == "queued"


def test_parent_confirmation_turns_completed_worksheet_into_submitted_attempt() -> None:
    """A reviewed paper becomes one immutable submitted attempt, exactly once."""
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    created = client.post(
        "/v1/completed-worksheets",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "completed-confirmation-source",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "title": "Completed English check",
            "subject": "English",
            "document_language": "ja",
            "feedback_language": "ja",
            "filenames": ["completed-check.jpg"],
            "response_paths": ["family/completed/completed-check.jpg"],
        },
    )
    assert created.status_code == 202

    # The analysis worker is the only component allowed to expose a reviewable
    # draft; confirmation must not race an unfinished extraction.
    client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)

    body = {
        "document": _structured_question_set(),
        "responses": [
            {
                "question_position": 1,
                "kind": "photo",
                "answer": {
                    "source_paths": ["untrusted/other-family-paper.jpg"],
                    "page_numbers": [1],
                },
            },
        ],
    }
    headers = {
        **PARENT_HEADERS,
        "Idempotency-Key": "confirm-completed-check",
    }
    invalid_page_reference = client.post(
        f"/v1/completed-worksheets/{created.json()['id']}/confirm",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "reject-missing-completed-page",
        },
        json={
            **body,
            "responses": [
                {
                    **body["responses"][0],
                    "answer": {
                        **body["responses"][0]["answer"],
                        "page_numbers": [2],
                    },
                }
            ],
        },
    )

    assert invalid_page_reference.status_code == 422
    assert "page 2" in invalid_page_reference.json()["detail"]

    confirmed = client.post(
        f"/v1/completed-worksheets/{created.json()['id']}/confirm",
        headers=headers,
        json=body,
    )
    repeated = client.post(
        f"/v1/completed-worksheets/{created.json()['id']}/confirm",
        headers=headers,
        json=body,
    )

    assert confirmed.status_code == 201
    payload = confirmed.json()
    assert payload["completed_worksheet"]["status"] == "grading"
    assert payload["assignment"]["status"] == "grading"
    assert payload["attempt"]["submitted_at"] is not None
    assert payload["grading_job"]["type"] == "grade_submission"
    assert repeated.json()["attempt"]["id"] == payload["attempt"]["id"]
    stored_response = next(
        iter(
            client.app.state.repository.responses_for_attempt(
                payload["attempt"]["id"]
            ).values()
        )
    )
    assert stored_response.answer["source_paths"] == [
        "family/completed/completed-check.jpg"
    ]

    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    processed = client.post(
        "/v1/demo/jobs/process-next",
        headers=PARENT_HEADERS,
    )
    results = client.get(
        f"/v1/attempts/{payload['attempt']['id']}/results",
        headers={"Authorization": f"Bearer {session['access_token']}"},
    )
    assert processed.status_code == 200
    assert results.status_code == 200
    assert results.json()["results"][0]["outcome"] == "needs_parent_review"


def test_parent_can_confirm_structured_json_and_assign_it_without_exposing_answers() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    request = {
        "family_id": fixture["family"]["id"],
        "child_id": fixture["child"]["id"],
        "source_name": "lesson-2.json",
        "document": _structured_question_set(),
    }
    headers = {
        **PARENT_HEADERS,
        "Idempotency-Key": "structured-lesson-two-import",
    }

    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers=headers,
        json=request,
    )
    repeated = client.post(
        "/v1/question-sets/imports/structured",
        headers=headers,
        json=request,
    )

    assert imported.status_code == 201
    assert imported.json()["status"] == "confirmed"
    assert imported.json()["assignment_id"] is not None
    assert repeated.json()["question_set_id"] == imported.json()["question_set_id"]
    assert repeated.json()["assignment_id"] == imported.json()["assignment_id"]
    assert repeated.json()["reused_existing"] is True

    child_session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    work = client.post(
        f"/v1/assignments/{imported.json()['assignment_id']}/start",
        headers={
            "Authorization": f"Bearer {child_session['access_token']}",
        },
    )

    assert work.status_code == 200
    assert work.json()["title"] == "Lesson 2 interactive practice"
    assert work.json()["questions"][0]["prompt"] == "___ it rains, stay home."
    assert "answer_key" not in work.json()["questions"][0]


def test_fixture_grading_uses_the_childs_selected_feedback_language() -> None:
    """The development worker must mirror production's child-language contract."""
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    language = client.put(
        f"/v1/children/{fixture['child']['id']}/language",
        headers=PARENT_HEADERS,
        json={"ui_language": "zh"},
    )
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {"Authorization": f"Bearer {session['access_token']}"}
    work = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/start",
        headers=child_headers,
    ).json()
    question = work["questions"][0]
    saved = client.put(
        f"/v1/attempts/{work['attempt']['id']}/responses/{question['id']}",
        headers=child_headers,
        json={"kind": "choice", "answer": {"choices": [0]}, "expected_version": 0},
    )
    submitted = client.post(
        f"/v1/attempts/{work['attempt']['id']}/questions/{question['id']}/submit",
        headers={**child_headers, "Idempotency-Key": "submit-zh-feedback"},
    )
    processed = client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)
    results = client.get(
        f"/v1/attempts/{work['attempt']['id']}/results",
        headers=child_headers,
    )

    assert language.status_code == 200
    assert saved.status_code == 200
    assert submitted.status_code == 202
    assert processed.status_code == 200
    assert results.json()["results"][0]["feedback"] == {
        "summary": "正确。",
        "action": "继续做下一题。",
    }


def test_listening_question_uses_private_audio_and_hides_transcript_until_submission() -> None:
    """A child receives a private audio URL only after a permitted playback."""
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    audio_intent = client.post(
        "/v1/uploads/intents",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "listening-audio-upload-intent",
        },
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "audio",
            "object_id": "4e4e1e8b-bd3a-438d-8e1c-04fb8c7e8713",
            "filename": "lesson-two.mp3",
            "content_type": "audio/mpeg",
        },
    )
    assert audio_intent.status_code == 201

    document = _structured_question_set()
    questions = document["questions"]
    assert isinstance(questions, list)
    questions[0].update(
        {
            "type": "listening",
            "prompt": "Listen and choose the place.",
            "options": ["The library", "School"],
            "answer_key": {"choice": 1},
            "listening": {
                "audio_path": audio_intent.json()["path"],
                "replay_limit": 1,
                "transcript": "I walk to school every morning.",
                "transcript_policy": "after_submission",
            },
        }
    )
    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "structured-listening-import",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "lesson-two-listening.json",
            "document": document,
        },
    )
    assert imported.status_code == 201

    child_session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    work = client.post(
        f"/v1/assignments/{imported.json()['assignment_id']}/start",
        headers={"Authorization": f"Bearer {child_session['access_token']}"},
    )

    assert work.status_code == 200
    listening = work.json()["questions"][0]["listening"]
    assert listening["audio_url"] is None
    assert listening["replay_limit"] == 1
    assert listening["play_count"] == 0
    assert listening["transcript"] is None
    assert audio_intent.json()["path"] not in str(work.json())

    child_headers = {"Authorization": f"Bearer {child_session['access_token']}"}
    played = client.post(
        f"/v1/attempts/{work.json()['attempt']['id']}/questions/"
        f"{work.json()['questions'][0]['id']}/audio-playbacks",
        headers=child_headers,
    )
    replay_blocked = client.post(
        f"/v1/attempts/{work.json()['attempt']['id']}/questions/"
        f"{work.json()['questions'][0]['id']}/audio-playbacks",
        headers=child_headers,
    )
    reopened = client.get(
        f"/v1/attempts/{work.json()['attempt']['id']}/work",
        headers=child_headers,
    )

    assert played.status_code == 200
    assert played.json()["audio_url"].startswith("fixture://private-audio/")
    assert played.json()["play_count"] == 1
    assert replay_blocked.status_code == 409
    assert replay_blocked.json()["detail"]["code"] == "listening_replay_limit_reached"
    assert reopened.json()["questions"][0]["listening"]["play_count"] == 1

    saved = client.put(
        f"/v1/attempts/{work.json()['attempt']['id']}/responses/"
        f"{work.json()['questions'][0]['id']}",
        headers=child_headers,
        json={"kind": "choice", "answer": {"choices": [1]}, "expected_version": 0},
    )
    submitted = client.post(
        f"/v1/attempts/{work.json()['attempt']['id']}/questions/"
        f"{work.json()['questions'][0]['id']}/submit",
        headers={**child_headers, "Idempotency-Key": "submit-listening-question"},
    )
    processed = client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)
    results = client.get(
        f"/v1/attempts/{work.json()['attempt']['id']}/results",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert submitted.status_code == 202
    assert processed.status_code == 200
    assert results.json()["complete"] is True
    assert results.json()["results"][0]["transcript"] == "I walk to school every morning."


def test_question_figure_is_private_but_available_to_the_assigned_child() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    figure_intent = client.post(
        "/v1/uploads/intents",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "question-figure-upload-intent",
        },
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "sources",
            "object_id": "d4f53bbc-f4cb-42e5-8baf-bcb9ffcb3d4b",
            "filename": "difference-of-squares.png",
            "content_type": "image/png",
        },
    )
    assert figure_intent.status_code == 201

    document = _structured_question_set()
    questions = document["questions"]
    assert isinstance(questions, list)
    questions[0]["figure"] = {
        "image_path": figure_intent.json()["path"],
        "alt_text": "Difference of squares diagram",
    }
    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers={**PARENT_HEADERS, "Idempotency-Key": "structured-figure-import"},
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "figure-question.json",
            "document": document,
        },
    )
    assert imported.status_code == 201

    child_session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    work = client.post(
        f"/v1/assignments/{imported.json()['assignment_id']}/start",
        headers={"Authorization": f"Bearer {child_session['access_token']}"},
    )

    assert work.status_code == 200
    figure = work.json()["questions"][0]["figure"]
    assert figure["image_url"].startswith("fixture://private-figure/")
    assert figure["alt_text"] == "Difference of squares diagram"
    assert "image_path" not in work.json()["questions"][0]["figure"]


def test_structured_import_rejects_a_question_figure_not_owned_by_the_family() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    document = _structured_question_set()
    questions = document["questions"]
    assert isinstance(questions, list)
    questions[0]["figure"] = {
        "image_path": "another-family/question-figure.png",
        "alt_text": "Untrusted figure",
    }

    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers={**PARENT_HEADERS, "Idempotency-Key": "reject-foreign-figure"},
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "foreign-figure.json",
            "document": document,
        },
    )

    assert imported.status_code == 422
    assert "figure" in imported.json()["detail"].lower()


def test_listening_question_set_cannot_copy_private_audio_into_public_library() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    audio_intent = client.post(
        "/v1/uploads/intents",
        headers={**PARENT_HEADERS, "Idempotency-Key": "library-listening-audio"},
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "audio",
            "object_id": "1b39ec7e-f4a4-4da1-a164-177c600620c1",
            "filename": "private-listening.mp3",
            "content_type": "audio/mpeg",
        },
    )
    assert audio_intent.status_code == 201
    document = _structured_question_set()
    questions = document["questions"]
    assert isinstance(questions, list)
    questions[0].update(
        {
            "type": "listening",
            "options": ["School", "Library"],
            "answer_key": {"choice": 0},
            "listening": {"audio_path": audio_intent.json()["path"]},
        }
    )
    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers={**PARENT_HEADERS, "Idempotency-Key": "library-listening-import"},
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "private-listening.json",
            "document": document,
        },
    )
    assert imported.status_code == 201

    submitted = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "share-private-listening"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": imported.json()["question_set_id"],
            "rights_confirmed": True,
            "privacy_confirmed": True,
        },
    )

    assert submitted.status_code == 409
    assert submitted.json()["detail"]["code"] == (
        "library_submission_contains_private_audio"
    )


def test_parent_can_assign_structured_json_as_a_timed_exam() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    imported = client.post(
        "/v1/question-sets/imports/structured",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "structured-timed-exam-import",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "timed-lesson.json",
            "assignment_mode": "exam",
            "time_limit_seconds": 900,
            "document": _structured_question_set(),
        },
    )

    assert imported.status_code == 201
    child_session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    work = client.post(
        f"/v1/assignments/{imported.json()['assignment_id']}/start",
        headers={"Authorization": f"Bearer {child_session['access_token']}"},
    )

    assert work.status_code == 200
    assert work.json()["assignment"]["mode"] == "exam"
    assert work.json()["assignment"]["time_limit_seconds"] == 900


def test_structured_exam_requires_a_time_limit() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    response = client.post(
        "/v1/question-sets/imports/structured",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "structured-exam-no-time",
        },
        json={
            "family_id": fixture["family"]["id"],
            "child_id": fixture["child"]["id"],
            "source_name": "invalid-timed-lesson.json",
            "assignment_mode": "exam",
            "document": _structured_question_set(),
        },
    )

    assert response.status_code == 422


def test_import_stays_in_review_then_can_be_confirmed_and_assigned() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    body = {
        "family_id": fixture["family"]["id"],
        "filenames": ["lesson-1.pdf", "textbook-page.png"],
        "purpose": "generate_similar",
        "title": "Lesson 1 similar practice",
        "subject": "English",
    }
    headers = {**PARENT_HEADERS, "Idempotency-Key": "import-lesson-one"}

    imported = client.post("/v1/question-sets/imports", headers=headers, json=body)
    repeated = client.post("/v1/question-sets/imports", headers=headers, json=body)

    assert imported.status_code == 202
    payload = imported.json()
    assert payload["status"] == "needs_review"
    assert payload["filenames"] == body["filenames"]
    assert repeated.json()["id"] == payload["id"]

    draft = client.get(
        f"/v1/question-sets/{payload['question_set_id']}",
        headers=PARENT_HEADERS,
    )
    assert draft.status_code == 200
    assert draft.json()["question_set"]["status"] == "needs_review"
    assert len(draft.json()["questions"]) == 3

    confirmed = client.post(
        f"/v1/question-sets/{payload['question_set_id']}/confirm",
        headers={**PARENT_HEADERS, "Idempotency-Key": "confirm-lesson-one"},
    )
    assigned = client.post(
        f"/v1/question-sets/{payload['question_set_id']}/assignments",
        headers={**PARENT_HEADERS, "Idempotency-Key": "assign-lesson-one"},
        json={
            "child_id": fixture["child"]["id"],
            "mode": "practice",
            "time_limit_seconds": None,
        },
    )

    assert confirmed.json()["status"] == "confirmed"
    assert assigned.status_code == 201
    assert assigned.json()["status"] == "assigned"


def test_parent_can_retry_a_failed_source_import_without_losing_the_source() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    imported = client.post(
        "/v1/question-sets/imports",
        headers={**PARENT_HEADERS, "Idempotency-Key": "retry-source-import"},
        json={
            "family_id": fixture["family"]["id"],
            "filenames": ["private-textbook.pdf"],
            "purpose": "generate_similar",
            "title": "Private textbook",
            "subject": "English",
        },
    ).json()
    repository = client.app.state.repository
    question_set = repository.question_sets[imported["question_set_id"]]
    source_import = repository.imports[imported["id"]]
    question_set.status = QuestionSetStatus.PROCESSING
    source_import.status = QuestionSetStatus.PROCESSING
    failed_job = Job(
        family_id=question_set.family_id,
        subject_id=source_import.id,
        type="extract_source",
        status=JobStatus.FAILED,
    )
    repository.jobs[str(failed_job.id)] = failed_job

    draft = client.get(
        f"/v1/question-sets/{imported['question_set_id']}",
        headers=PARENT_HEADERS,
    )
    retried = client.post(
        f"/v1/jobs/{failed_job.id}/retry",
        headers=PARENT_HEADERS,
    )

    assert draft.status_code == 200
    assert draft.json()["question_set"]["status"] == "processing"
    assert draft.json()["import_job"] is not None
    assert draft.json()["import_job"]["id"] == str(failed_job.id)
    assert draft.json()["import_job"]["type"] == "extract_source"
    assert draft.json()["import_job"]["status"] == "failed"
    assert retried.status_code == 200
    assert retried.json()["status"] == "queued"
    assert repository.question_sets[imported["question_set_id"]].status == (
        QuestionSetStatus.PROCESSING
    )
    assert repository.imports[imported["id"]].status == QuestionSetStatus.PROCESSING


def test_library_marks_a_failed_source_import_as_retryable() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    imported = client.post(
        "/v1/question-sets/imports",
        headers={**PARENT_HEADERS, "Idempotency-Key": "library-failed-import"},
        json={
            "family_id": fixture["family"]["id"],
            "filenames": ["private-textbook.pdf"],
            "purpose": "generate_similar",
            "title": "Private textbook",
            "subject": "English",
        },
    ).json()
    repository = client.app.state.repository
    question_set = repository.question_sets[imported["question_set_id"]]
    source_import = repository.imports[imported["id"]]
    question_set.status = QuestionSetStatus.PROCESSING
    source_import.status = QuestionSetStatus.PROCESSING
    failed_job = Job(
        family_id=question_set.family_id,
        subject_id=source_import.id,
        type="extract_source",
        status=JobStatus.FAILED,
    )
    repository.jobs[str(failed_job.id)] = failed_job

    library = client.get(
        f"/v1/library/families/{fixture['family']['id']}/question-sets",
        headers=PARENT_HEADERS,
    )

    assert library.status_code == 200
    card = next(
        item
        for item in library.json()
        if item["id"] == imported["question_set_id"]
    )
    assert card["status"] == "processing"
    assert card["import_job_status"] == "failed"


def test_lesson_one_import_keeps_answer_key_private_and_creates_real_questions() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    body = {
        "family_id": fixture["family"]["id"],
        "filenames": ["english_lesson1_similar_practice.pdf"],
        "source_paths": ["family/import/questions.pdf"],
        "answer_filenames": ["english_lesson1_similar_answer_key.pdf"],
        "answer_source_paths": ["family/import/answer-key.pdf"],
        "reference_filenames": ["lesson1-textbook-and-examples.pdf"],
        "reference_source_paths": ["family/import/reference.pdf"],
        "purpose": "use_as_questions",
        "title": "Lesson 1 同レベル変形練習",
        "subject": "English",
    }

    imported = client.post(
        "/v1/question-sets/imports",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "import-real-lesson-one",
        },
        json=body,
    )

    assert imported.status_code == 202
    assert imported.json()["filenames"] == body["filenames"]
    assert imported.json()["answer_filenames"] == body["answer_filenames"]
    assert imported.json()["answer_source_paths"] == body["answer_source_paths"]
    assert imported.json()["reference_filenames"] == body["reference_filenames"]
    assert (
        imported.json()["reference_source_paths"]
        == body["reference_source_paths"]
    )

    draft = client.get(
        f"/v1/question-sets/{imported.json()['question_set_id']}",
        headers=PARENT_HEADERS,
    )
    assert draft.status_code == 200
    questions = draft.json()["questions"]
    assert draft.json()["question_set"]["source_summary"] == {
        "schema_version": "1.0",
        "unit": "Lesson 1 · What Are Your Plans for the Vacation?",
        "artifact_kind": "ai_generated_practice",
        "knowledge_points": [
            "and / but / or / so",
            "imperative + and / or",
            "when / while / after / before",
            "present tense in future time clauses",
            "How / What exclamations",
        ],
        "reference_file_count": 1,
    }
    assert len(questions) == 49
    assert questions[0]["prompt"].endswith(
        "Emma ___ Leo are in the music club."
    )
    assert questions[0]["options"] == ["and", "but", "so"]
    assert questions[0]["answer_key"] == {"choice": 0}
    assert questions[-1]["prompt"].endswith(
        "We saw a waterfall. How beautiful ___!"
    )
    assert questions[-1]["answer_key"] == {"choice": 1}

    library = client.get(
        f"/v1/library/families/{fixture['family']['id']}/question-sets",
        headers=PARENT_HEADERS,
    )
    assert library.status_code == 200
    lesson_item = next(
        item
        for item in library.json()
        if item["id"] == imported.json()["question_set_id"]
    )
    assert lesson_item["title"] == "Lesson 1 同レベル変形練習"
    assert lesson_item["question_count"] == 49
    assert lesson_item["status"] == "needs_review"
    assert lesson_item["source_summary"]["artifact_kind"] == (
        "ai_generated_practice"
    )

    client.post(
        f"/v1/question-sets/{imported.json()['question_set_id']}/confirm",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "confirm-real-lesson-one",
        },
    )
    assignment = client.post(
        f"/v1/question-sets/{imported.json()['question_set_id']}/assignments",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "assign-real-lesson-one",
        },
        json={
            "child_id": fixture["child"]["id"],
            "mode": "exam",
            "time_limit_seconds": 2700,
        },
    ).json()
    child_session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    work = client.post(
        f"/v1/assignments/{assignment['id']}/start",
        headers={
            "Authorization": f"Bearer {child_session['access_token']}",
        },
    )

    assert work.status_code == 200
    assert len(work.json()["questions"]) == 49
    assert all("answer_key" not in question for question in work.json()["questions"])
    assert "answer" not in str(work.json()).casefold()


def test_upload_intent_is_private_and_scoped_to_the_family() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()

    response = client.post(
        "/v1/uploads/intents",
        headers={**PARENT_HEADERS, "Idempotency-Key": "upload-response-photo"},
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "responses",
            "object_id": fixture["assignment"]["id"],
            "filename": "IMG_1024.JPG",
            "content_type": "image/jpeg",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["bucket"] == "responses"
    assert payload["path"].startswith(
        f"{fixture['family']['id']}/{fixture['assignment']['id']}/"
    )
    assert payload["upload_url"].startswith("fixture://private-upload/")
    assert payload["expires_in"] == 300


def test_child_can_only_request_response_uploads_for_their_family() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {
        "Authorization": f"Bearer {session['access_token']}",
        "Idempotency-Key": "child-response-photo",
    }
    work = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/start",
        headers=child_headers,
    ).json()

    accepted = client.post(
        "/v1/uploads/child-intents",
        headers=child_headers,
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "responses",
            "object_id": work["attempt"]["id"],
            "filename": "answer.jpg",
            "content_type": "image/jpeg",
        },
    )
    rejected = client.post(
        "/v1/uploads/child-intents",
        headers=child_headers,
        json={
            "family_id": fixture["family"]["id"],
            "bucket": "sources",
            "object_id": work["attempt"]["id"],
            "filename": "source.jpg",
            "content_type": "image/jpeg",
        },
    )

    assert accepted.status_code == 201
    assert accepted.json()["bucket"] == "responses"
    assert rejected.status_code == 404


def test_library_submission_enters_review_instead_of_becoming_public() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()

    missing_confirmations = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "publish-without-rights"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
        },
    )
    response = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "publish-demo-set"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
            "rights_confirmed": True,
            "privacy_confirmed": True,
        },
    )

    assert missing_confirmations.status_code == 422
    assert response.status_code == 202
    assert response.json()["status"] == "pending_review"
    assert response.json()["published_at"] is None

    repeated_submission = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "publish-demo-set-again"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
            "rights_confirmed": True,
            "privacy_confirmed": True,
        },
    )
    pending_submissions = client.get(
        f"/v1/library/families/{fixture['family']['id']}/submissions",
        headers=PARENT_HEADERS,
    )

    assert repeated_submission.status_code == 202
    assert repeated_submission.json()["id"] == response.json()["id"]
    assert pending_submissions.status_code == 200
    assert [submission["id"] for submission in pending_submissions.json()] == [
        response.json()["id"]
    ]

    unrelated_parent = client.post(
        "/v1/library/submissions",
        headers={
            "Authorization": "Bearer another-parent",
            "Idempotency-Key": "publish-from-another-family",
        },
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
            "rights_confirmed": True,
            "privacy_confirmed": True,
        },
    )
    assert unrelated_parent.status_code == 401


def test_parent_can_withdraw_a_pending_library_submission_without_publishing() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    created = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "publish-then-withdraw"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
            "rights_confirmed": True,
            "privacy_confirmed": True,
        },
    )

    withdrawn = client.post(
        f"/v1/library/submissions/{created.json()['id']}/withdraw",
        headers=PARENT_HEADERS,
    )
    repeated_withdrawal = client.post(
        f"/v1/library/submissions/{created.json()['id']}/withdraw",
        headers=PARENT_HEADERS,
    )
    submissions = client.get(
        f"/v1/library/families/{fixture['family']['id']}/submissions",
        headers=PARENT_HEADERS,
    )

    assert created.status_code == 202
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "withdrawn"
    assert withdrawn.json()["published_at"] is None
    assert repeated_withdrawal.status_code == 409
    assert submissions.status_code == 200
    assert submissions.json()[0]["status"] == "withdrawn"


def test_library_review_api_is_closed_without_an_explicit_reviewer() -> None:
    client = TestClient(create_app())

    list_response = client.get(
        "/v1/library/review/submissions",
        headers=PARENT_HEADERS,
    )
    decision_response = client.post(
        "/v1/library/review/submissions/00000000-0000-0000-0000-000000000000/decision",
        headers={**PARENT_HEADERS, "Idempotency-Key": "blocked-review-decision"},
        json={"decision": "approve"},
    )

    assert list_response.status_code == 403
    assert list_response.json()["detail"]["code"] == "library_reviewer_required"
    assert decision_response.status_code == 403
    assert decision_response.json()["detail"]["code"] == "library_reviewer_required"


def test_config_can_load_an_explicit_library_reviewer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Kept close to the behavior test: an empty production setting grants nobody.
    monkeypatch.setenv("LIBRARY_REVIEWER_PARENT_IDS", '["parent-fixture"]')

    settings = Settings(_env_file=None)

    assert settings.library_reviewer_parent_ids == ("parent-fixture",)


def test_explicit_reviewer_only_sees_safe_pending_submission_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIBRARY_REVIEWER_PARENT_IDS", '["parent-fixture"]')
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
        client.post(
            "/v1/library/submissions",
            headers={**PARENT_HEADERS, "Idempotency-Key": "safe-review-list"},
            json={
                "family_id": fixture["family"]["id"],
                "question_set_id": fixture["question_set"]["id"],
                "rights_confirmed": True,
                "privacy_confirmed": True,
            },
        )

        response = client.get("/v1/library/review/submissions", headers=PARENT_HEADERS)

        assert response.status_code == 200
        assert response.json()[0]["title"] == fixture["question_set"]["title"]
        assert set(response.json()[0]) == {
            "id",
            "question_set_id",
            "title",
            "subject",
            "question_count",
            "created_at",
        }
    finally:
        get_settings.cache_clear()


def test_explicit_reviewer_can_publish_a_sanitized_library_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIBRARY_REVIEWER_PARENT_IDS", '["parent-fixture"]')
    get_settings.cache_clear()
    try:
        application = create_app()
        client = TestClient(application)
        fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
        created = client.post(
            "/v1/library/submissions",
            headers={**PARENT_HEADERS, "Idempotency-Key": "approve-sanitized-set"},
            json={
                "family_id": fixture["family"]["id"],
                "question_set_id": fixture["question_set"]["id"],
                "rights_confirmed": True,
                "privacy_confirmed": True,
            },
        )

        approved = client.post(
            f"/v1/library/review/submissions/{created.json()['id']}/decision",
            headers={**PARENT_HEADERS, "Idempotency-Key": "approve-sanitized-set-v1"},
            json={"decision": "approve", "note": "Safe to publish."},
        )
        repeated = client.post(
            f"/v1/library/review/submissions/{created.json()['id']}/decision",
            headers={**PARENT_HEADERS, "Idempotency-Key": "approve-sanitized-set-v1"},
            json={"decision": "approve", "note": "Safe to publish."},
        )
        family_submissions = client.get(
            f"/v1/library/families/{fixture['family']['id']}/submissions",
            headers=PARENT_HEADERS,
        )

        assert approved.status_code == 200
        assert approved.json()["status"] == "published"
        assert approved.json()["published_at"] is not None
        assert approved.json()["review_note"] == "Safe to publish."
        assert repeated.status_code == 200
        assert repeated.json()["id"] == approved.json()["id"]
        assert family_submissions.json()[0]["status"] == "published"

        repository = application.state.repository
        snapshot = repository.library_items[created.json()["id"]]["snapshot"]
        serialized_snapshot = str(snapshot)
        assert "answer_key" not in serialized_snapshot
        assert "source_summary" not in serialized_snapshot
        assert "family_id" not in serialized_snapshot
        assert snapshot["questions"]
    finally:
        get_settings.cache_clear()


def test_explicit_reviewer_can_reject_once_but_not_change_a_final_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIBRARY_REVIEWER_PARENT_IDS", '["parent-fixture"]')
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
        created = client.post(
            "/v1/library/submissions",
            headers={**PARENT_HEADERS, "Idempotency-Key": "reject-review-set"},
            json={
                "family_id": fixture["family"]["id"],
                "question_set_id": fixture["question_set"]["id"],
                "rights_confirmed": True,
                "privacy_confirmed": True,
            },
        )

        rejected = client.post(
            f"/v1/library/review/submissions/{created.json()['id']}/decision",
            headers={**PARENT_HEADERS, "Idempotency-Key": "reject-review-set-v1"},
            json={"decision": "reject", "note": "Please remove copyrighted text."},
        )
        changed = client.post(
            f"/v1/library/review/submissions/{created.json()['id']}/decision",
            headers={**PARENT_HEADERS, "Idempotency-Key": "reject-review-set-v2"},
            json={"decision": "approve"},
        )

        assert rejected.status_code == 200
        assert rejected.json()["status"] == "rejected"
        assert rejected.json()["published_at"] is None
        assert changed.status_code == 409
        assert changed.json()["detail"]["code"] == "library_submission_cannot_be_reviewed"
    finally:
        get_settings.cache_clear()


def test_parent_can_copy_a_published_library_item_without_receiving_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LIBRARY_REVIEWER_PARENT_IDS", '["parent-fixture"]')
    get_settings.cache_clear()
    try:
        application = create_app()
        client = TestClient(application)
        fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
        submitted = client.post(
            "/v1/library/submissions",
            headers={**PARENT_HEADERS, "Idempotency-Key": "publish-copy-source"},
            json={
                "family_id": fixture["family"]["id"],
                "question_set_id": fixture["question_set"]["id"],
                "rights_confirmed": True,
                "privacy_confirmed": True,
            },
        )
        approved = client.post(
            f"/v1/library/review/submissions/{submitted.json()['id']}/decision",
            headers={**PARENT_HEADERS, "Idempotency-Key": "publish-copy-source-v1"},
            json={"decision": "approve"},
        )
        destination_family = client.post(
            "/v1/families",
            headers={**PARENT_HEADERS, "Idempotency-Key": "public-library-destination"},
            json={"name": "Copied library family"},
        )

        public_items = client.get("/v1/library/items", headers=PARENT_HEADERS)
        item = public_items.json()[0]
        copied = client.post(
            f"/v1/library/items/{item['id']}/copies",
            headers={**PARENT_HEADERS, "Idempotency-Key": "copy-public-item-v1"},
            json={"family_id": destination_family.json()["id"]},
        )
        repeated = client.post(
            f"/v1/library/items/{item['id']}/copies",
            headers={**PARENT_HEADERS, "Idempotency-Key": "copy-public-item-v1"},
            json={"family_id": destination_family.json()["id"]},
        )
        destination_sets = client.get(
            f"/v1/library/families/{destination_family.json()['id']}/question-sets",
            headers=PARENT_HEADERS,
        )

        assert approved.status_code == 200
        assert public_items.status_code == 200
        assert set(item) == {
            "id",
            "title",
            "subject",
            "question_count",
            "revision",
            "published_at",
        }
        assert copied.status_code == 201
        assert copied.json()["family_id"] == destination_family.json()["id"]
        assert copied.json()["reused_existing"] is False
        assert repeated.status_code == 201
        assert repeated.json()["question_set_id"] == copied.json()["question_set_id"]
        assert repeated.json()["reused_existing"] is True
        assert destination_sets.json()[0]["source_summary"] == {
            "imported_via": "public_library_copy",
            "public_library_item_id": item["id"],
            "public_library_revision": 1,
            "question_count": item["question_count"],
            "answer_keys_present": True,
        }

        copied_question = application.state.repository.questions[
            next(
                question_id
                for question_id, question in application.state.repository.questions.items()
                if str(question.question_set_id) == copied.json()["question_set_id"]
            )
        ]
        assert copied_question.answer_key == {"choice": 0}
    finally:
        get_settings.cache_clear()
