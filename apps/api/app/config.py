from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["local", "test", "staging", "production"] = "local"
    api_version: str = "v1"
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "https://study.hypnochunk.com",
    )
    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_publishable_key: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    child_session_secret: SecretStr = SecretStr("local-development-only-change-me")
    ai_provider: Literal["fixture"] = "fixture"
    repository_backend: Literal["memory", "postgres"] = "memory"
    client_log_path: str = "/tmp/learning-assessment/client-errors.jsonl"
    client_log_max_bytes: int = 5_000_000
    client_log_backup_count: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
