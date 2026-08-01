import asyncio
import logging
import os
import socket
from contextlib import suppress
from functools import partial

import structlog

from app.ai.codex_cli import CodexCLIGradingAdapter
from app.config import get_settings
from app.services.database_jobs import DatabaseJobWorker, fixture_job_handler


async def run() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    visual_adapter = (
        CodexCLIGradingAdapter(
            executable=settings.codex_executable,
            model=settings.codex_model,
            timeout_seconds=settings.codex_timeout_seconds,
        )
        if settings.ai_provider == "codex_cli"
        else None
    )
    worker = DatabaseJobWorker(
        database_url=settings.database_url,
        worker_name=f"{socket.gethostname()}:{os.getpid()}",
        handler=partial(
            fixture_job_handler,
            visual_adapter=visual_adapter,
            allowed_visual_family_ids=frozenset(settings.codex_family_ids),
            minimum_confidence=settings.ai_minimum_confidence,
            supabase_url=settings.supabase_url,
            supabase_service_role_key=settings.supabase_service_role_key.get_secret_value(),
            allow_fixture_source_generation=settings.app_env != "production",
        ),
    )
    stop = asyncio.Event()
    structlog.get_logger(__name__).info("worker_started")
    while not stop.is_set():
        processed = await worker.run_once()
        if processed:
            continue
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=2)


if __name__ == "__main__":
    asyncio.run(run())
