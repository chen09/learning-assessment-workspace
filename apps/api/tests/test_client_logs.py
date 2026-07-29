import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.client_logs import ClientLogWriter


def test_frontend_api_error_is_written_as_bounded_structured_data(
    tmp_path: Path,
) -> None:
    application = create_app()
    log_path = tmp_path / "client-errors.jsonl"
    application.state.client_log_writer = ClientLogWriter(log_path)
    client = TestClient(application)

    response = client.post(
        "/v1/client-logs",
        headers={"Origin": "https://study.hypnochunk.com"},
        json={
            "event": "api_request_failed",
            "page": "/parent/family/",
            "request_method": "PUT",
            "request_path": (
                "/v1/families/4b052a32-b6db-4980-97e4-2f308cca5ff2/"
                "management-pin"
            ),
            "status_code": 401,
            "error_code": "parent_session_required",
            "occurred_at": "2026-07-29T11:38:52Z",
        },
    )

    assert response.status_code == 202
    records = [
        json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert records == [
        {
            "error_code": "parent_session_required",
            "event": "api_request_failed",
            "occurred_at": "2026-07-29T11:38:52Z",
            "page": "/parent/family/",
            "request_method": "PUT",
            "request_path": (
                "/v1/families/4b052a32-b6db-4980-97e4-2f308cca5ff2/"
                "management-pin"
            ),
            "status_code": 401,
        }
    ]


def test_client_log_rejects_request_bodies_and_tokens(tmp_path: Path) -> None:
    application = create_app()
    log_path = tmp_path / "client-errors.jsonl"
    application.state.client_log_writer = ClientLogWriter(log_path)
    client = TestClient(application)

    response = client.post(
        "/v1/client-logs",
        headers={"Origin": "https://study.hypnochunk.com"},
        json={
            "event": "api_request_failed",
            "page": "/parent/family/",
            "request_method": "PUT",
            "request_path": "/v1/families/family-1/management-pin",
            "status_code": 401,
            "error_code": "parent_session_required",
            "occurred_at": "2026-07-29T11:38:52Z",
            "request_body": {"pin": "000000"},
            "authorization": "Bearer secret",
        },
    )

    assert response.status_code == 422
    assert not log_path.exists()


def test_client_log_rotates_before_exceeding_its_disk_budget(tmp_path: Path) -> None:
    log_path = tmp_path / "client-errors.jsonl"
    writer = ClientLogWriter(log_path, max_bytes=1, backup_count=1)

    writer.write({"event": "first"})
    writer.write({"event": "second"})

    assert json.loads(log_path.read_text(encoding="utf-8")) == {"event": "second"}
    assert json.loads(
        Path(f"{log_path}.1").read_text(encoding="utf-8")
    ) == {"event": "first"}
