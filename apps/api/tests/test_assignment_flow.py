from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.domain.models import JobStatus, ReviewItemView
from app.main import create_app
from app.repositories.memory import MemoryRepository

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


def start_fixture_assignment(
    client: TestClient,
) -> tuple[dict[str, object], dict[str, str], dict[str, object]]:
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {"Authorization": f"Bearer {session['access_token']}"}
    work = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/start",
        headers=child_headers,
    ).json()
    return fixture, child_headers, work


def test_parent_can_bootstrap_the_fixture_assignment() -> None:
    client = TestClient(create_app())

    response = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS)

    assert response.status_code == 201
    payload = response.json()
    assert payload["family"]["name"] == "Demo family"
    assert payload["child"]["nickname"] == "Alex"
    assert payload["question_set"]["status"] == "confirmed"
    assert payload["assignment"]["status"] == "assigned"
    assert [question["type"] for question in payload["questions"]] == [
        "single_choice",
        "typed_text",
        "handwriting",
    ]
    printable = client.get(
        f"/v1/assignments/{payload['assignment']['id']}/printable",
        headers=PARENT_HEADERS,
    )
    assert printable.status_code == 200
    assert printable.json()["template_version"] == "a4-v1"
    assert printable.json()["title"] == "Algebra and English warm-up"
    assert len(printable.json()["questions"]) == 3


def test_child_can_skip_todays_reviews_without_resetting_their_interval() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {"Authorization": f"Bearer {session['access_token']}"}
    repository = client.app.state.repository
    review = ReviewItemView(
        id=uuid4(),
        child_id=UUID(fixture["child"]["id"]),
        source_question_id=UUID(fixture["questions"][0]["id"]),
        prompt="Choose the correct expansion.",
        type="single_choice",
        options=["a² − b²", "a² + b²", "a² − 2ab + b²"],
        answer_mode="choice",
        due_on=datetime.now(UTC).date(),
        interval_days=7,
        level="standard",
    )
    repository.review_items[str(review.id)] = review

    skipped = client.post("/v1/reviews/today/skip", headers=child_headers)
    today = client.get("/v1/reviews/today", headers=child_headers)

    assert skipped.status_code == 200
    assert skipped.json() == [
        {
            "item_id": str(review.id),
            "old_interval_days": 7,
            "new_interval_days": 7,
            "next_due_on": str(datetime.now(UTC).date() + timedelta(days=1)),
        }
    ]
    assert today.json() == []


def test_child_review_requires_an_answer_and_is_graded_server_side() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {"Authorization": f"Bearer {session['access_token']}"}
    repository = client.app.state.repository
    typed_question = fixture["questions"][1]
    first_review = ReviewItemView(
        id=uuid4(),
        child_id=UUID(fixture["child"]["id"]),
        source_question_id=UUID(typed_question["id"]),
        prompt=typed_question["prompt"],
        due_on=datetime.now(UTC).date(),
        interval_days=3,
        level="standard",
        type="typed_text",
        options=None,
        answer_mode="text",
    )
    second_review = first_review.model_copy(update={"id": uuid4(), "interval_days": 1})
    handwriting_question = fixture["questions"][2]
    handwriting_review = ReviewItemView(
        id=uuid4(),
        child_id=UUID(fixture["child"]["id"]),
        source_question_id=UUID(handwriting_question["id"]),
        prompt=handwriting_question["prompt"],
        due_on=datetime.now(UTC).date(),
        interval_days=1,
        level="standard",
        type="handwriting",
        options=None,
        answer_mode="parent_review",
    )
    repository.review_items[str(first_review.id)] = first_review
    repository.review_items[str(second_review.id)] = second_review
    repository.review_items[str(handwriting_review.id)] = handwriting_review

    today = client.get("/v1/reviews/today", headers=child_headers)

    assert today.status_code == 200
    assert today.json()[0] == {
        "id": str(first_review.id),
        "source_question_id": typed_question["id"],
        "prompt": typed_question["prompt"],
        "due_on": str(datetime.now(UTC).date()),
        "interval_days": 3,
        "level": "standard",
        "type": "typed_text",
        "options": None,
        "answer_mode": "text",
    }
    assert "answer_key" not in today.text

    fabricated = client.post(
        f"/v1/reviews/{first_review.id}/complete",
        headers=child_headers,
        json={"outcome": "correct"},
    )
    wrong = client.post(
        f"/v1/reviews/{first_review.id}/complete",
        headers=child_headers,
        json={"text": "go"},
    )
    correct = client.post(
        f"/v1/reviews/{second_review.id}/complete",
        headers=child_headers,
        json={"text": "goes"},
    )
    visual_review = client.post(
        f"/v1/reviews/{handwriting_review.id}/complete",
        headers=child_headers,
        json={},
    )

    assert fabricated.status_code == 422
    assert wrong.status_code == 200
    assert wrong.json() == {
        "item_id": str(first_review.id),
        "old_interval_days": 3,
        "new_interval_days": 1,
        "next_due_on": str(datetime.now(UTC).date() + timedelta(days=1)),
        "outcome": "incorrect",
    }
    assert correct.status_code == 200
    assert correct.json()["new_interval_days"] == 3
    assert correct.json()["outcome"] == "correct"
    assert visual_review.status_code == 409
    assert visual_review.json()["detail"]["code"] == "review_requires_parent"


def test_child_pin_opens_a_scoped_assignment_session() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    assignments = client.get("/v1/assignments", headers=child_headers)

    assert work["title"] == "Algebra and English warm-up"
    assert work["assignment"]["status"] == "in_progress"
    assert work["attempt"]["sequence"] == 1
    assert len(work["questions"]) == 3
    assert all("answer_key" not in question for question in work["questions"])
    assert assignments.status_code == 200
    assert assignments.json() == [
        {
            "id": work["assignment"]["id"],
            "title": "Algebra and English warm-up",
            "status": "in_progress",
            "mode": "practice",
            "time_limit_seconds": None,
            "parent_note": None,
            "question_count": 3,
            "latest_attempt_id": work["attempt"]["id"],
        }
    ]


def test_child_history_returns_the_unfinished_attempt_for_resuming() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)

    history = client.get("/v1/history/child", headers=child_headers)

    assert history.status_code == 200
    assert history.json() == [
        {
            "assignment_id": work["assignment"]["id"],
            "attempt_id": work["attempt"]["id"],
            "child_id": work["assignment"]["child_id"],
            "child_nickname": "Alex",
            "title": "Algebra and English warm-up",
            "status": "in_progress",
            "submitted_at": None,
            "awarded_points": 0.0,
            "available_points": 4.0,
            "correction_count": 0,
        }
    ]


def test_parent_history_includes_safe_source_labels_but_child_history_does_not() -> None:
    client = TestClient(create_app())
    fixture, child_headers, work = start_fixture_assignment(client)
    repository: MemoryRepository = client.app.state.repository
    question_set_id = fixture["question_set"]["id"]
    question_set = repository.question_sets[question_set_id]
    repository.question_sets[question_set_id] = question_set.model_copy(
        update={
            "source_summary": {
                "source_material_title": "Lesson 1 textbook",
                "source_material_subject": "English",
            }
        }
    )

    parent_history = client.get(
        f"/v1/history/families/{fixture['family']['id']}",
        headers=PARENT_HEADERS,
    )
    child_history = client.get("/v1/history/child", headers=child_headers)
    parent_review = client.get(
        f"/v1/grading-results/attempts/{work['attempt']['id']}",
        headers=PARENT_HEADERS,
    )

    assert parent_history.status_code == 200
    assert parent_history.json()[0]["source_material_title"] == "Lesson 1 textbook"
    assert parent_history.json()[0]["source_material_subject"] == "English"
    assert child_history.status_code == 200
    assert "source_material_title" not in child_history.json()[0]
    assert "source_material_subject" not in child_history.json()[0]
    assert parent_review.status_code == 200
    assert parent_review.json()["source_material_title"] == "Lesson 1 textbook"
    assert parent_review.json()["source_material_subject"] == "English"


def test_parent_can_withdraw_unstarted_assignment_before_child_can_open_it() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()
    session = client.post(
        f"/v1/children/{fixture['child']['id']}/sessions",
        json={"pin": "123456"},
    ).json()
    child_headers = {"Authorization": f"Bearer {session['access_token']}"}

    withdrawn = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/withdraw",
        headers=PARENT_HEADERS,
    )
    unavailable = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/start",
        headers=child_headers,
    )
    assignments = client.get("/v1/assignments", headers=child_headers)

    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "withdrawn"
    assert unavailable.status_code == 404
    assert assignments.json() == []


def test_parent_can_stop_started_assignment_without_allowing_more_changes() -> None:
    client = TestClient(create_app())
    fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    question_id = work["questions"][0]["id"]
    saved = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [0]},
            "expected_version": 0,
        },
    )

    stopped = client.post(
        f"/v1/assignments/{fixture['assignment']['id']}/stop",
        headers=PARENT_HEADERS,
    )
    later_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [1]},
            "expected_version": 1,
        },
    )
    later_question_submit = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question_id}/submit",
        headers={**child_headers, "Idempotency-Key": "stopped-question-submit"},
    )
    later_attempt_submit = client.post(
        f"/v1/attempts/{attempt_id}/submit",
        headers={**child_headers, "Idempotency-Key": "stopped-attempt-submit"},
    )
    reopened = client.get(
        f"/v1/attempts/{attempt_id}/work",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "stopped"
    assert later_save.status_code == 404
    assert later_question_submit.status_code == 404
    assert later_attempt_submit.status_code == 404
    assert reopened.status_code == 404


def test_parent_can_attach_a_short_note_when_assigning_work() -> None:
    client = TestClient(create_app())
    fixture = client.post("/v1/demo/bootstrap", headers=PARENT_HEADERS).json()

    assigned = client.post(
        f"/v1/question-sets/{fixture['question_set']['id']}/assignments",
        headers={**PARENT_HEADERS, "Idempotency-Key": "assign-with-note"},
        json={
            "child_id": fixture["child"]["id"],
            "parent_note": "先独立完成，再和我一起检查。",
        },
    )

    assert assigned.status_code == 201
    assert assigned.json()["parent_note"] == "先独立完成，再和我一起检查。"


def test_five_wrong_child_pins_lock_entry_for_five_minutes() -> None:
    client = TestClient(create_app())
    child_id = client.post(
        "/v1/demo/bootstrap", headers=PARENT_HEADERS
    ).json()["child"]["id"]

    for _ in range(4):
        response = client.post(
            f"/v1/children/{child_id}/sessions",
            json={"pin": "000000"},
        )
        assert response.status_code == 401

    fifth_response = client.post(
        f"/v1/children/{child_id}/sessions",
        json={"pin": "000000"},
    )
    locked_response = client.post(
        f"/v1/children/{child_id}/sessions",
        json={"pin": "123456"},
    )

    assert fifth_response.status_code == 423
    assert locked_response.status_code == 423
    assert locked_response.json()["detail"] == "Child entry is temporarily locked."


def test_autosave_rejects_a_stale_response_version() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    question_id = work["questions"][0]["id"]
    body = {
        "kind": "choice",
        "answer": {"choices": [0]},
        "expected_version": 0,
    }

    first_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json=body,
    )
    stale_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json=body,
    )

    assert first_save.status_code == 200
    assert first_save.json()["version"] == 1
    assert stale_save.status_code == 409
    assert stale_save.json() == {
        "detail": {
            "code": "response_version_conflict",
            "current_version": 1,
        }
    }


def test_attempt_work_restores_saved_handwriting_and_canvas_size() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    question_id = work["questions"][2]["id"]
    answer = {
        "strokes": [
            {
                "points": [
                    {"x": 20, "y": 30, "pressure": 0.5},
                    {"x": 80, "y": 90, "pressure": 0.5},
                ],
                "width": 2.5,
                "eraser": False,
            }
        ],
        "canvas_size": {"width": 1200, "height": 700},
    }

    saved = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json={
            "kind": "strokes",
            "answer": answer,
            "expected_version": 0,
        },
    )
    reopened = client.get(
        f"/v1/attempts/{attempt_id}/work",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert reopened.status_code == 200
    assert reopened.json()["responses"] == [
        {
            **saved.json(),
            "answer": answer,
        }
    ]


def test_child_can_submit_one_answer_without_closing_the_attempt() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    first_question, second_question = work["questions"][:2]

    saved = client.put(
        f"/v1/attempts/{attempt_id}/responses/{first_question['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [0]},
            "expected_version": 0,
        },
    )
    submitted = client.post(
        f"/v1/attempts/{attempt_id}/questions/{first_question['id']}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-one-answer",
        },
    )
    locked_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{first_question['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [1]},
            "expected_version": 1,
        },
    )
    other_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{second_question['id']}",
        headers=child_headers,
        json={
            "kind": "text",
            "answer": {"text": "go"},
            "expected_version": 0,
        },
    )
    processed = client.post(
        "/v1/demo/jobs/process-next",
        headers=PARENT_HEADERS,
    )
    results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )
    reopened = client.get(
        f"/v1/attempts/{attempt_id}/work",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert submitted.status_code == 202
    assert submitted.json()["question_id"] == first_question["id"]
    assert submitted.json()["job"]["status"] == "queued"
    assert locked_save.status_code == 409
    assert locked_save.json()["detail"] == {
        "code": "submitted_question_is_immutable"
    }
    assert other_save.status_code == 200
    assert processed.status_code == 200
    assert results.status_code == 200
    assert results.json()["complete"] is False
    assert [
        (result["question_id"], result["outcome"])
        for result in results.json()["results"]
    ] == [(first_question["id"], "correct")]
    assert reopened.status_code == 200
    assert reopened.json()["attempt"]["submitted_at"] is None
    assert reopened.json()["submitted_question_ids"] == [first_question["id"]]


def test_child_can_regrade_the_same_answer_without_creating_a_duplicate() -> None:
    app = create_app()
    client = TestClient(app)
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    question_id = work["questions"][0]["id"]

    saved = client.put(
        f"/v1/attempts/{attempt_id}/responses/{question_id}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [0]},
            "expected_version": 0,
        },
    )
    first_submission = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question_id}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-before-regrade",
        },
    )
    client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)
    first_results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )

    regrade = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question_id}/regrade",
        headers={
            **child_headers,
            "Idempotency-Key": "regrade-same-answer",
        },
    )
    repeated_request = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question_id}/regrade",
        headers={
            **child_headers,
            "Idempotency-Key": "regrade-same-answer",
        },
    )
    regrade_job_id = regrade.json()["job"]["id"]
    job_url = (
        f"/v1/attempts/{attempt_id}/questions/{question_id}"
        f"/grading-jobs/{regrade_job_id}"
    )
    queued_status = client.get(job_url, headers=child_headers)
    client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)
    completed_status = client.get(job_url, headers=child_headers)
    reopened = client.get(
        f"/v1/attempts/{attempt_id}/work",
        headers=child_headers,
    )
    final_results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert first_submission.status_code == 202
    assert regrade.status_code == 202
    assert regrade.json()["job"]["id"] != first_submission.json()["job"]["id"]
    assert repeated_request.status_code == 202
    assert repeated_request.json()["job"]["id"] == regrade_job_id
    assert queued_status.status_code == 200
    assert queued_status.json()["status"] == "queued"
    assert completed_status.status_code == 200
    assert completed_status.json()["status"] == "succeeded"
    assert reopened.json()["attempt"]["id"] == attempt_id
    assert reopened.json()["responses"] == [
        {
            **saved.json(),
            "answer": {"choices": [0]},
        }
    ]
    assert reopened.json()["submitted_question_ids"] == [question_id]
    assert len(first_results.json()["results"]) == 1
    assert len(final_results.json()["results"]) == 1


def test_child_redoes_one_graded_answer_in_a_new_immutable_attempt() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    question = work["questions"][0]

    client.put(
        f"/v1/attempts/{attempt_id}/responses/{question['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [0]},
            "expected_version": 0,
        },
    )
    client.post(
        f"/v1/attempts/{attempt_id}/questions/{question['id']}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-before-single-retry",
        },
    )
    client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)

    retry = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question['id']}/retry",
        headers={
            **child_headers,
            "Idempotency-Key": "single-question-retry",
        },
    )
    repeated = client.post(
        f"/v1/attempts/{attempt_id}/questions/{question['id']}/retry",
        headers={
            **child_headers,
            "Idempotency-Key": "single-question-retry",
        },
    )

    assert retry.status_code == 200
    assert repeated.status_code == 200
    assert repeated.json()["attempt"]["id"] == retry.json()["attempt"]["id"]
    assert retry.json()["attempt"]["id"] != attempt_id
    assert [item["id"] for item in retry.json()["questions"]] == [question["id"]]
    assert retry.json()["responses"] == []
    assert retry.json()["submitted_question_ids"] == []
    retry_attempt_id = retry.json()["attempt"]["id"]
    retry_save = client.put(
        f"/v1/attempts/{retry_attempt_id}/responses/{question['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [1]},
            "expected_version": 0,
        },
    )
    retry_submit = client.post(
        f"/v1/attempts/{retry_attempt_id}/questions/{question['id']}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-single-retry-answer",
        },
    )
    client.post("/v1/demo/jobs/process-next", headers=PARENT_HEADERS)
    retry_results = client.get(
        f"/v1/attempts/{retry_attempt_id}/results",
        headers=child_headers,
    )
    original_results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )
    assert retry_save.status_code == 200
    assert retry_submit.status_code == 202
    assert retry_results.status_code == 200
    assert retry_results.json()["results"][0]["outcome"] == "incorrect"
    assert original_results.status_code == 200
    assert original_results.json()["results"][0]["outcome"] == "correct"


def test_submitting_the_whole_attempt_marks_unanswered_questions_incorrect() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    questions = work["questions"]

    saved = client.put(
        f"/v1/attempts/{attempt_id}/responses/{questions[0]['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [0]},
            "expected_version": 0,
        },
    )
    submitted = client.post(
        f"/v1/attempts/{attempt_id}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-with-unanswered",
        },
    )
    repeated_submission = client.post(
        f"/v1/attempts/{attempt_id}/submit",
        headers={
            **child_headers,
            "Idempotency-Key": "submit-with-unanswered",
        },
    )
    processed = client.post(
        "/v1/demo/jobs/process-next",
        headers=PARENT_HEADERS,
    )
    results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )

    assert saved.status_code == 200
    assert submitted.status_code == 202
    assert repeated_submission.status_code == 202
    assert repeated_submission.json()["job"]["id"] == submitted.json()["job"]["id"]
    assert processed.status_code == 200
    assert results.status_code == 200
    assert results.json()["complete"] is True
    assert [result["outcome"] for result in results.json()["results"]] == [
        "correct",
        "incorrect",
        "incorrect",
    ]
    assert results.json()["results"][1]["awarded_points"] == 0
    assert results.json()["results"][1]["feedback"] == {
        "summary": "No answer was submitted.",
        "action": "Review this question and try it again.",
    }


def test_submission_is_immutable_and_fixture_grading_releases_full_results() -> None:
    client = TestClient(create_app())
    _fixture, child_headers, work = start_fixture_assignment(client)
    attempt_id = work["attempt"]["id"]
    questions = work["questions"]
    answers = [
        ("choice", {"choices": [0]}),
        ("text", {"text": "go"}),
        (
            "strokes",
            {"strokes": [{"points": [[10, 10], [20, 20]], "width": 2}]},
        ),
    ]
    photo_uploaded = client.put(
        f"/v1/attempts/{attempt_id}/responses/{questions[2]['id']}",
        headers=child_headers,
        json={
            "kind": "photo",
            "answer": {"paths": ["family/attempt/first-photo.png"]},
            "expected_version": 0,
        },
    )
    assert photo_uploaded.status_code == 200

    for index, (question, (kind, answer)) in enumerate(
        zip(questions, answers, strict=True)
    ):
        save = client.put(
            f"/v1/attempts/{attempt_id}/responses/{question['id']}",
            headers=child_headers,
            json={
                "kind": kind,
                "answer": answer,
                "expected_version": 1 if index == 2 else 0,
            },
        )
        assert save.status_code == 200

    submitted = client.post(
        f"/v1/attempts/{attempt_id}/submit",
        headers={**child_headers, "Idempotency-Key": "submit-demo-attempt"},
    )
    immutable_save = client.put(
        f"/v1/attempts/{attempt_id}/responses/{questions[0]['id']}",
        headers=child_headers,
        json={
            "kind": "choice",
            "answer": {"choices": [1]},
            "expected_version": 1,
        },
    )
    processed = client.post(
        "/v1/demo/jobs/process-next",
        headers=PARENT_HEADERS,
    )
    results = client.get(
        f"/v1/attempts/{attempt_id}/results",
        headers=child_headers,
    )

    assert submitted.status_code == 202
    assert submitted.json()["job"]["status"] == "queued"
    assert immutable_save.status_code == 409
    assert processed.status_code == 200
    assert results.status_code == 200
    assert results.json()["complete"] is True
    assert [result["outcome"] for result in results.json()["results"]] == [
        "correct",
        "incorrect",
        "needs_parent_review",
    ]
    parent_results = client.get(
        f"/v1/grading-results/attempts/{attempt_id}",
        headers=PARENT_HEADERS,
    )
    child_cannot_open_parent_results = client.get(
        f"/v1/grading-results/attempts/{attempt_id}",
        headers=child_headers,
    )

    assert parent_results.status_code == 200
    assert parent_results.json()["child_nickname"] == "Alex"
    assert parent_results.json()["title"] == "Algebra and English warm-up"
    assert parent_results.json()["awarded_points"] == 1
    assert parent_results.json()["available_points"] == 4
    assert parent_results.json()["correct_count"] == 1
    assert parent_results.json()["correction_count"] == 1
    assert parent_results.json()["pending_review_count"] == 1
    revisions = parent_results.json()["response_revisions"]
    assert [
        {
            key: revision[key]
            for key in (
                "question_id",
                "question_position",
                "response_version",
                "change",
                "previous_page_count",
                "page_count",
            )
        }
        for revision in revisions
    ] == [
        {
            "question_id": questions[2]["id"],
            "question_position": 3,
            "response_version": 2,
            "change": "photo_removed",
            "previous_page_count": 1,
            "page_count": 0,
        },
        {
            "question_id": questions[2]["id"],
            "question_position": 3,
            "response_version": 1,
            "change": "photo_added",
            "previous_page_count": 0,
            "page_count": 1,
        },
    ]
    assert all("paths" not in revision for revision in revisions)
    assert all("saved_at" in revision for revision in revisions)
    assert parent_results.json()["reviews"] == [
        {
            "result_id": results.json()["results"][2]["id"],
            "question_id": questions[2]["id"],
            "question_position": 3,
            "question_prompt": "Show why (a + b)(a - b) = a² - b².",
            "question_type": "handwriting",
            "question_points": 2,
            "response_kind": "strokes",
            "response_answer": answers[2][1],
            "photo_urls": [],
            "automated_outcome": "needs_parent_review",
            "automated_feedback": {
                "summary": "Waiting for a parent to review.",
                "action": "A parent can mark this answer correct or incorrect.",
            },
        }
    ]
    assert child_cannot_open_parent_results.status_code == 401
    uncertain_result_id = results.json()["results"][2]["id"]
    parent_decision = client.post(
        f"/v1/grading-results/{uncertain_result_id}/parent-decision",
        headers={**PARENT_HEADERS, "Idempotency-Key": "decide-handwriting-result"},
        json={
            "outcome": "correct",
            "awarded_points": 2,
            "comment": "The steps and final answer are clear.",
        },
    )

    assert parent_decision.status_code == 200
    assert parent_decision.json()["parent_outcome"] == "correct"
    assert parent_decision.json()["parent_awarded_points"] == 2
    resolved_parent_results = client.get(
        f"/v1/grading-results/attempts/{attempt_id}",
        headers=PARENT_HEADERS,
    )
    assert resolved_parent_results.status_code == 200
    assert resolved_parent_results.json()["awarded_points"] == 3
    assert resolved_parent_results.json()["correct_count"] == 2
    assert resolved_parent_results.json()["pending_review_count"] == 0
    assert resolved_parent_results.json()["reviews"] == []
    correction = client.post(
        f"/v1/attempts/{attempt_id}/correction",
        headers={
            **child_headers,
            "Idempotency-Key": "correct-demo-attempt",
        },
    )
    assert correction.status_code == 200
    assert correction.json()["assignment"]["status"] == "correcting"
    assert [question["id"] for question in correction.json()["questions"]] == [
        questions[1]["id"]
    ]


def test_parent_can_manually_retry_a_failed_background_job() -> None:
    application = create_app()
    client = TestClient(application)
    _fixture, child_headers, work = start_fixture_assignment(client)
    submitted = client.post(
        f"/v1/attempts/{work['attempt']['id']}/submit",
        headers={**child_headers, "Idempotency-Key": "submit-for-manual-retry"},
    )
    job_id = submitted.json()["job"]["id"]
    repository = application.state.repository
    assert isinstance(repository, MemoryRepository)
    repository.jobs[job_id].status = JobStatus.FAILED
    repository.jobs[job_id].attempt_count = 3

    retried = client.post(
        f"/v1/jobs/{job_id}/retry",
        headers=PARENT_HEADERS,
    )

    assert retried.status_code == 200
    assert retried.json()["status"] == "queued"
    assert retried.json()["attempt_count"] == 0
