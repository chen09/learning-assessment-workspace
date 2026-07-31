from fastapi.testclient import TestClient

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
