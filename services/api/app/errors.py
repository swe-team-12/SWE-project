from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    code: str
    detail: str
    instance: str | None = None
    errors: list[dict[str, Any]] | None = None


class AppError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str):
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        super().__init__(detail)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        problem = Problem(
            title=exc.title,
            status=exc.status,
            code=exc.code,
            detail=exc.detail,
            instance=str(request.url.path),
        )
        return JSONResponse(
            problem.model_dump(exclude_none=True),
            status_code=exc.status,
            media_type="application/problem+json",
        )
