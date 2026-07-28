from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_service_capabilities() -> None:
    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "learning-assessment-api",
        "api_version": "v1",
        "ai_provider": "fixture",
    }
