from fastapi.testclient import TestClient

from app.main import create_app

PARENT_HEADERS = {"Authorization": "Bearer parent-fixture"}


def test_parent_creates_family_and_child_then_rotates_child_pin() -> None:
    client = TestClient(create_app())
    family_headers = {
        **PARENT_HEADERS,
        "Idempotency-Key": "create-family-onboarding",
    }
    family = client.post(
        "/v1/families",
        headers=family_headers,
        json={"name": "Maya family"},
    )
    repeated_family = client.post(
        "/v1/families",
        headers=family_headers,
        json={"name": "Maya family"},
    )

    assert family.status_code == 201
    assert repeated_family.json()["id"] == family.json()["id"]
    family_id = family.json()["id"]

    child = client.post(
        f"/v1/families/{family_id}/children",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "create-child-alex",
        },
        json={
            "nickname": "Alex",
            "grade_stage": "Junior high 1",
            "pin": "123456",
            "ui_language": "en",
        },
    )
    listed = client.get(
        f"/v1/families/{family_id}/children",
        headers=PARENT_HEADERS,
    )

    assert child.status_code == 201
    assert [item["nickname"] for item in listed.json()] == ["Alex"]
    child_id = child.json()["id"]
    locked_rotation = client.put(
        f"/v1/children/{child_id}/pin",
        headers=PARENT_HEADERS,
        json={"pin": "654321"},
    )
    management_pin = client.put(
        f"/v1/families/{family_id}/management-pin",
        headers=PARENT_HEADERS,
        json={"pin": "246810"},
    )
    management_pin_status = client.get(
        f"/v1/families/{family_id}/management-pin",
        headers=PARENT_HEADERS,
    )
    rejected_replacement = client.put(
        f"/v1/families/{family_id}/management-pin",
        headers=PARENT_HEADERS,
        json={"pin": "135790"},
    )
    child_session = client.post(
        f"/v1/children/{child_id}/sessions",
        json={"pin": "123456"},
    )
    rejected_child_token = client.put(
        f"/v1/children/{child_id}/pin",
        headers={
            **PARENT_HEADERS,
            "X-Management-Unlock": child_session.json()["access_token"],
        },
        json={"pin": "654321"},
    )
    wrong_unlock = client.post(
        f"/v1/families/{family_id}/management-unlock",
        headers=PARENT_HEADERS,
        json={"pin": "111111"},
    )
    unlock = client.post(
        f"/v1/families/{family_id}/management-unlock",
        headers=PARENT_HEADERS,
        json={"pin": "246810"},
    )
    rotated = client.put(
        f"/v1/children/{child_id}/pin",
        headers={
            **PARENT_HEADERS,
            "X-Management-Unlock": unlock.json()["access_token"],
        },
        json={"pin": "654321"},
    )
    old_pin = client.post(
        f"/v1/children/{child_id}/sessions",
        json={"pin": "123456"},
    )
    new_pin = client.post(
        f"/v1/children/{child_id}/sessions",
        json={"pin": "654321"},
    )

    assert locked_rotation.status_code == 401
    assert management_pin.status_code == 204
    assert management_pin_status.json() == {"configured": True}
    assert rejected_replacement.status_code == 401
    assert rejected_child_token.status_code == 401
    assert wrong_unlock.status_code == 401
    assert unlock.status_code == 200
    assert unlock.json()["expires_in"] == 600
    assert rotated.status_code == 200
    assert old_pin.status_code == 401
    assert new_pin.status_code == 201

    deleted = client.post(
        "/v1/deletions",
        headers={
            **PARENT_HEADERS,
            "Idempotency-Key": "delete-child-alex",
        },
        json={
            "family_id": family_id,
            "target_type": "child",
            "target_id": child_id,
        },
    )
    restored = client.post(
        f"/v1/deletions/{deleted.json()['id']}/restore",
        headers=PARENT_HEADERS,
    )

    assert deleted.status_code == 202
    assert restored.status_code == 200
    assert restored.json()["restored_at"] is not None
