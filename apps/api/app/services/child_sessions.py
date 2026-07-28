from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.domain.models import Child, ChildSessionClaims, ChildSessionResponse


class ChildSessionService:
    def __init__(self, secret: str, lifetime: timedelta = timedelta(hours=12)) -> None:
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

    def create(self, child: Child) -> ChildSessionResponse:
        now = datetime.now(UTC)
        expires_at = now + self._lifetime
        claims = {
            "sub": f"child:{child.id}",
            "family_id": str(child.family_id),
            "child_id": str(child.id),
            "scope": "child",
            "iat": now,
            "exp": expires_at,
        }
        access_token = jwt.encode(claims, self._secret, algorithm="HS256")
        return ChildSessionResponse(
            access_token=access_token,
            expires_in=int(self._lifetime.total_seconds()),
            child_id=child.id,
            family_id=child.family_id,
            nickname=child.nickname,
            ui_language=child.ui_language,
        )

    def decode(self, token: str) -> ChildSessionClaims:
        payload = jwt.decode(token, self._secret, algorithms=["HS256"])
        return ChildSessionClaims.model_validate(payload)
