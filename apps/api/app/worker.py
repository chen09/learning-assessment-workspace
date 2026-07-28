import asyncio
import logging
import os
import socket
from contextlib import suppress

import structlog

from app.config import get_settings
from app.services.database_jobs import DatabaseJobWorker


async def run() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    worker = DatabaseJobWorker(
        database_url=settings.database_url,
        worker_name=f"{socket.gethostname()}:{os.getpid()}",
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
