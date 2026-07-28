from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.domain.models import ManagementUnlockClaims, ManagementUnlockResponse


class ManagementUnlockService:
    def __init__(
        self,
        secret: str,
        lifetime: timedelta = timedelta(minutes=10),
    ) -> None:
        self._secret = secret
        self._lifetime = lifetime
        self._password_hasher = PasswordHasher()

    def hash_pin(self, pin: str) -> str:
        return self._password_hasher.hash(pin)

    def verify_pin(self, pin_hash: str, pin: str) -> bool:
        try:
            return self._password_hasher.verify(pin_hash, pin)
        except VerifyMismatchError:
            return False

    def create(self, family_id: str, parent_id: str) -> ManagementUnlockResponse:
        now = datetime.now(UTC)
        expires_at = now + self._lifetime
        token = jwt.encode(
            {
                "sub": f"parent-management:{parent_id}",
                "family_id": family_id,
                "parent_id": parent_id,
                "scope": "manage_child_pin",
                "iat": now,
                "exp": expires_at,
            },
            self._secret,
            algorithm="HS256",
        )
        return ManagementUnlockResponse(
            access_token=token,
            expires_in=int(self._lifetime.total_seconds()),
        )

    def decode(self, token: str) -> ManagementUnlockClaims:
        payload = jwt.decode(token, self._secret, algorithms=["HS256"])
        return ManagementUnlockClaims.model_validate(payload)
