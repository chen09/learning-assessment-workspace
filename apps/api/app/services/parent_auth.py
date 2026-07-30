from dataclasses import dataclass

import httpx


class ParentAuthenticationError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ParentIdentity:
    user_id: str
    email: str | None
    email_verified: bool


class SupabaseParentAuthService:
    def __init__(
        self,
        *,
        supabase_url: str,
        publishable_key: str,
        allow_fixture: bool,
    ) -> None:
        self._supabase_url = supabase_url.rstrip("/")
        self._publishable_key = publishable_key
        self._allow_fixture = allow_fixture

    async def authenticate(self, token: str) -> ParentIdentity:
        if token == "parent-fixture" and self._allow_fixture:
            return ParentIdentity(
                user_id="parent-fixture",
                email="parent@example.test",
                email_verified=True,
            )
        if not self._publishable_key:
            raise ParentAuthenticationError
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(
                    f"{self._supabase_url}/auth/v1/user",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "apikey": self._publishable_key,
                    },
                )
        except httpx.HTTPError as error:
            raise ParentAuthenticationError from error
        if response.status_code != 200:
            raise ParentAuthenticationError
        payload = response.json()
        user_id = payload.get("id")
        if not isinstance(user_id, str):
            raise ParentAuthenticationError
        email = payload.get("email")
        return ParentIdentity(
            user_id=user_id,
            email=email if isinstance(email, str) else None,
            email_verified=payload.get("email_confirmed_at") is not None,
        )
