from __future__ import annotations

import secrets

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

TOKEN_HEADER = "X-Memory-Anki-Token"
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _extract_token(request: Request) -> str:
    custom = request.headers.get(TOKEN_HEADER, "").strip()
    if custom:
        return custom
    authorization = request.headers.get("Authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def _is_direct_loopback(request: Request) -> bool:
    # Tailscale Serve reverse-proxies to 127.0.0.1 with X-Forwarded-For,
    # so only loopback clients without forwarding headers are exempt.
    if request.headers.get("X-Forwarded-For"):
        return False
    client = request.client
    return client is not None and client.host in LOOPBACK_HOSTS


class ApiTokenAuthMiddleware(BaseHTTPMiddleware):
    """Validate remote API token; allow when token is unset or request is local."""

    def __init__(self, app: ASGIApp, token: str | None):
        super().__init__(app)
        self.token = (token or "").strip()

    async def dispatch(self, request: Request, call_next):
        if not self.token:
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        if _is_direct_loopback(request):
            return await call_next(request)
        provided = _extract_token(request)
        if provided and secrets.compare_digest(provided, self.token):
            return await call_next(request)
        return JSONResponse(
            status_code=401,
            content={"detail": "缺少或错误的 API 令牌（MEMORY_ANKI_API_TOKEN）。"},
        )
