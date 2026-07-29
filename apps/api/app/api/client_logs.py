from datetime import datetime
from typing import Literal, cast

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.config import get_settings
from app.services.client_logs import ClientLogWriter

router = APIRouter(prefix="/v1/client-logs", tags=["client-logs"])


class ClientLogRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["api_request_failed"]
    page: str = Field(pattern=r"^/[A-Za-z0-9_./-]*$", max_length=300)
    request_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    request_path: str = Field(pattern=r"^/v1/[A-Za-z0-9_./-]*$", max_length=300)
    status_code: int = Field(ge=400, le=599)
    error_code: str = Field(pattern=r"^[a-z0-9_:-]+$", max_length=80)
    occurred_at: datetime


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_client_log(
    report: ClientLogRequest,
    request: Request,
) -> None:
    settings = get_settings()
    origin = request.headers.get("origin")
    requires_origin = settings.app_env in {"staging", "production"}
    if (requires_origin and origin not in settings.cors_origins) or (
        origin and origin not in settings.cors_origins
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The client log origin is not allowed.",
        )
    writer = cast(ClientLogWriter, request.app.state.client_log_writer)
    writer.write(report.model_dump(mode="json"))
