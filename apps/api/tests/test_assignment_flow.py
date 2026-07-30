from fastapi.testclient import TestClient

from app.domain.models import JobStatus
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
            "question_count": 3,
            "latest_attempt_id": work["attempt"]["id"],
        }
    ]


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
    for question, (kind, answer) in zip(questions, answers, strict=True):
        save = client.put(
            f"/v1/attempts/{attempt_id}/responses/{question['id']}",
            headers=child_headers,
            json={"kind": kind, "answer": answer, "expected_version": 0},
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
