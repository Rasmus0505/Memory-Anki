from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from memory_anki.core.request_context import set_request_id


class RequestLoggingMiddleware:
    """Request logging without BaseHTTPMiddleware, so live SSE is not buffered."""

    def __init__(self, app: ASGIApp):
        self.app = app
        self.logger = logging.getLogger("memory_anki.request")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive)
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        set_request_id(request_id)
        request.state.request_id = request_id
        started_at = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status") or 500)
                headers = MutableHeaders(raw=list(message.get("headers") or []))
                headers["X-Request-ID"] = request_id
                message["headers"] = headers.raw
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            self.logger.info(
                "request handled",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                },
            )
            set_request_id(None)
