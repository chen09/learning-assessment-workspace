from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.api.assignments import router as assignments_router
from app.api.attempts import router as attempts_router
from app.api.children import router as children_router
from app.api.deletions import router as deletions_router
from app.api.demo import router as demo_router
from app.api.families import router as families_router
from app.api.grading_results import router as grading_results_router
from app.api.history import router as history_router
from app.api.invitations import router as invitations_router
from app.api.jobs import router as jobs_router
from app.api.library import router as library_router
from app.api.question_sets import router as question_sets_router
from app.api.reviews import router as reviews_router
from app.api.uploads import router as uploads_router
from app.config import get_settings
from app.repositories.memory import MemoryRepository
from app.repositories.postgres import PostgresRepository
from app.services.child_sessions import ChildSessionService
from app.services.management_unlock import ManagementUnlockService
from app.services.parent_auth import SupabaseParentAuthService


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["learning-assessment-api"] = "learning-assessment-api"
    api_version: str
    ai_provider: str


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.app_env in {"staging", "production"} and (
        settings.repository_backend != "postgres"
    ):
        raise RuntimeError(
            "Staging and production require REPOSITORY_BACKEND=postgres."
        )
    repository = (
        PostgresRepository(
            settings.database_url,
            supabase_url=settings.supabase_url,
            service_role_key=settings.supabase_service_role_key.get_secret_value(),
        )
        if settings.repository_backend == "postgres"
        else MemoryRepository()
    )

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        yield
        if isinstance(repository, PostgresRepository):
            await repository.close()

    application = FastAPI(
        title="Learning Assessment API",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.repository = repository
    application.state.child_session_service = ChildSessionService(
        settings.child_session_secret.get_secret_value()
    )
    application.state.management_unlock_service = ManagementUnlockService(
        settings.child_session_secret.get_secret_value()
    )
    application.state.parent_auth_service = SupabaseParentAuthService(
        supabase_url=settings.supabase_url,
        publishable_key=settings.supabase_publishable_key,
        allow_fixture=settings.app_env in {"local", "test"},
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Management-Unlock",
        ],
    )
    application.include_router(children_router)
    application.include_router(assignments_router)
    application.include_router(attempts_router)
    application.include_router(demo_router)
    application.include_router(question_sets_router)
    application.include_router(uploads_router)
    application.include_router(library_router)
    application.include_router(grading_results_router)
    application.include_router(families_router)
    application.include_router(reviews_router)
    application.include_router(history_router)
    application.include_router(invitations_router)
    application.include_router(deletions_router)
    application.include_router(jobs_router)

    @application.get("/healthz", response_model=HealthResponse)
    async def health() -> HealthResponse:
        settings = get_settings()
        return HealthResponse(
            api_version=settings.api_version,
            ai_provider=settings.ai_provider,
        )

    return application


app = create_app()
