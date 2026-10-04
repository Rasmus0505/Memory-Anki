from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from memory_anki.core.request_context import set_request_id

# Requests slower than this are escalated to WARNING so that the "加载单元超时"
# class of bug leaves a duration behind in logs/pwa-api.log. Long-lived SSE
# responses are excluded because their duration measures the stream lifetime,
# not handler latency.
SLOW_REQUEST_THRESHOLD_MS = 3_000


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
            path = request.url.path
            extra = {
                "request_id": request_id,
                "method": request.method,
                "path": path,
                "status_code": status_code,
                "duration_ms": duration_ms,
            }
            message = "%s %s -> %s in %sms"
            args = (request.method, path, status_code, duration_ms)
            if duration_ms >= SLOW_REQUEST_THRESHOLD_MS and not path.endswith("/stream"):
                self.logger.warning("%s %s -> %s in %sms [slow]", *args, extra=extra)
            else:
                self.logger.info(message, *args, extra=extra)
            set_request_id(None)
