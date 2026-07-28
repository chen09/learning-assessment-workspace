from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import create_app

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


def test_invite_expires_in_seven_days_and_sends_no_external_notification() -> None:
    client = TestClient(create_app())
    family_id = client.post(
        "/v1/demo/bootstrap",
        headers=PARENT_HEADERS,
    ).json()["family"]["id"]
    before = datetime.now(UTC)

    response = client.post(
        f"/v1/families/{family_id}/invitations",
        headers={**PARENT_HEADERS, "Idempotency-Key": "invite-second-parent"},
        json={"email": "Second.Parent@Example.Test"},
    )

    assert response.status_code == 201
    payload = response.json()
    expires_at = datetime.fromisoformat(payload["expires_at"])
    assert before + timedelta(days=7) <= expires_at <= datetime.now(UTC) + timedelta(
        days=7,
        seconds=1,
    )
    assert payload["email"] == "second.parent@example.test"
    assert payload["external_notification_sent"] is False


def test_owner_plus_three_pending_parents_is_the_family_limit() -> None:
    client = TestClient(create_app())
    family_id = client.post(
        "/v1/demo/bootstrap",
        headers=PARENT_HEADERS,
    ).json()["family"]["id"]

    for index in range(3):
        response = client.post(
            f"/v1/families/{family_id}/invitations",
            headers={**PARENT_HEADERS, "Idempotency-Key": f"invite-parent-{index}"},
            json={"email": f"parent-{index}@example.test"},
        )
        assert response.status_code == 201

    rejected = client.post(
        f"/v1/families/{family_id}/invitations",
        headers={**PARENT_HEADERS, "Idempotency-Key": "invite-parent-four"},
        json={"email": "parent-4@example.test"},
    )

    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "family_parent_limit_reached"


def test_verified_matching_email_can_discover_and_accept_invitation() -> None:
    client = TestClient(create_app())
    family_id = client.post(
        "/v1/demo/bootstrap",
        headers=PARENT_HEADERS,
    ).json()["family"]["id"]
    invitation = client.post(
        f"/v1/families/{family_id}/invitations",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "invite-current-fixture-parent",
        },
        json={"email": "parent@example.test"},
    ).json()

    pending = client.get(
        "/v1/invitations/pending",
        headers=PARENT_HEADERS,
    )
    accepted = client.post(
        f"/v1/invitations/{invitation['id']}/accept",
        headers=PARENT_HEADERS,
    )

    assert [item["id"] for item in pending.json()] == [invitation["id"]]
    assert accepted.status_code == 200
    assert accepted.json()["id"] == family_id
