from fastapi.testclient import TestClient

from app.main import create_app

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


def test_parent_language_preference_is_saved_for_the_next_signed_in_session() -> None:
    client = TestClient(create_app())

    initial = client.get("/v1/profiles/me/language", headers=PARENT_HEADERS)
    updated = client.put(
        "/v1/profiles/me/language",
        headers=PARENT_HEADERS,
        json={"ui_language": "zh"},
    )
    next_session = client.get(
        "/v1/profiles/me/language",
        headers=PARENT_HEADERS,
    )

    assert initial.status_code == 200
    assert initial.json() == {"ui_language": "en"}
    assert updated.status_code == 200
    assert updated.json() == {"ui_language": "zh"}
    assert next_session.status_code == 200
    assert next_session.json() == {"ui_language": "zh"}


def test_parent_language_preference_requires_a_parent_session() -> None:
    client = TestClient(create_app())

    response = client.put(
        "/v1/profiles/me/language",
        json={"ui_language": "ja"},
    )

    assert response.status_code == 401
