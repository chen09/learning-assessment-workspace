from fastapi.testclient import TestClient

from app.main import create_app

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


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

    response = client.post(
        "/v1/library/submissions",
        headers={**PARENT_HEADERS, "Idempotency-Key": "publish-demo-set"},
        json={
            "family_id": fixture["family"]["id"],
            "question_set_id": fixture["question_set"]["id"],
        },
    )

    assert response.status_code == 202
    assert response.json()["status"] == "pending_review"
    assert response.json()["published_at"] is None
