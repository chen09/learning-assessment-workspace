import asyncio
import os
from contextlib import suppress

import uvicorn

from app.worker import run as run_worker


async def run() -> None:
    worker_task = asyncio.create_task(run_worker())
    server = uvicorn.Server(
        uvicorn.Config(
            "app.main:app",
            host="127.0.0.1",
            port=int(os.getenv("E2E_API_PORT", "8018")),
            log_level="info",
        )
    )
    try:
        await server.serve()
    finally:
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task


if __name__ == "__main__":
    asyncio.run(run())
