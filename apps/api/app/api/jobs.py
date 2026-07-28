from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import Repository, get_repository, require_parent
from app.domain.errors import NotFoundError
from app.domain.models import Job

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


@router.post("/{job_id}/retry", response_model=Job)
async def retry_job(
    job_id: UUID,
    repository: Annotated[Repository, Depends(get_repository)],
    parent_id: Annotated[str, Depends(require_parent)],
) -> Job:
    try:
        return await repository.retry_job(str(job_id), parent_id)
    except NotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The failed job is not available for retry.",
        ) from error
