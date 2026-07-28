from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.models import DemoBootstrap, Job
from app.repositories.memory import MemoryRepository
from app.services.jobs import FixtureJobProcessor

router = APIRouter(prefix="/v1/demo", tags=["demo"])


@router.post(
    "/bootstrap",
    response_model=DemoBootstrap,
    status_code=status.HTTP_201_CREATED,
)
async def bootstrap_demo(
    repository: Annotated[Repository, Depends(get_repository)],
    _parent_id: Annotated[str, Depends(require_parent)],
) -> DemoBootstrap:
    return await repository.bootstrap_demo()


@router.post("/jobs/process-next", response_model=Job)
async def process_next_fixture_job(
    repository: Annotated[Repository, Depends(get_repository)],
    _parent_id: Annotated[str, Depends(require_parent)],
) -> Job:
    if not isinstance(repository, MemoryRepository):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Fixture job processing is disabled.",
        )
    job = FixtureJobProcessor(repository).process_next()
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No queued fixture job is available.",
        )
    return job
