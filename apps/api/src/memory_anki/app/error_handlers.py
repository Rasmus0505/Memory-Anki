"""Application-wide exception handlers with safe client-facing messages."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from memory_anki.core.runtime_storage_lock import StorageBusyError
from memory_anki.infrastructure.db.lock_errors import is_sqlite_lock_error

logger = logging.getLogger(__name__)

# How long a writer should wait before retrying a database-lock failure. Short
# enough that the client's own retry keeps the study loop moving, long enough to
# outlast a commit that is already in flight.
DB_LOCK_RETRY_AFTER_SECONDS = 2


def _error_detail(code: str, message: str, **extra: Any) -> dict[str, Any]:
    detail: dict[str, Any] = {"code": code, "message": message}
    detail.update(extra)
    return {"detail": detail}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            return JSONResponse(status_code=exc.status_code, content={"detail": detail})
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_detail(f"http_{exc.status_code}", str(detail)),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_detail(
                "validation_error",
                "请求参数校验失败。",
                errors=exc.errors(),
            ),
        )

    @app.exception_handler(StorageBusyError)
    async def handle_storage_busy(
        request: Request, exc: StorageBusyError
    ) -> JSONResponse:
        """Report lock contention as retryable instead of an internal error.

        The shared runtime lock is held by whatever write is currently in flight
        (a background snapshot, a palace rebuild, a slow autosave). The client's
        write is safe to replay, so answer 503 with a Retry-After hint rather
        than a misleading 500. The message names the condition, not one guessed
        cause, because guessing "backup" here previously sent debugging in the
        wrong direction.
        """
        logger.warning(
            "storage busy on %s %s after %.1fs wait; client should retry",
            request.method,
            request.url.path,
            exc.wait_seconds,
        )
        retry_after = exc.retry_after_seconds
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": str(retry_after)},
            content=_error_detail(
                "storage_busy",
                "数据正在写入中，本次操作已自动重试。",
                retryAfterSeconds=retry_after,
            ),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # A SQLite write-lock collision is transient and retryable, but it reached
        # the learner as an opaque 500 ("服务器内部错误，请查看服务端日志") that the
        # client could not tell apart from a real bug. Report it the same retryable
        # way the app-level storage lock already is (503 + Retry-After), so the
        # existing client retry/backoff applies instead of the request failing
        # permanently. 284 such failures were measured in one day before this.
        if is_sqlite_lock_error(exc):
            logger.warning(
                "database write lock busy on %s %s; reporting retryable 503",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                headers={"Retry-After": str(DB_LOCK_RETRY_AFTER_SECONDS)},
                content=_error_detail(
                    "database_busy",
                    "数据正在写入中，请稍候重试。",
                    retryAfterSeconds=DB_LOCK_RETRY_AFTER_SECONDS,
                ),
            )
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content=_error_detail("internal_error", "服务器内部错误，请查看服务端日志。"),
        )
