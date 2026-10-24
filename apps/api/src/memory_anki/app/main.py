import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from memory_anki.app.error_handlers import install_error_handlers
from memory_anki.app.startup_runtime import (
    STARTUP_MODE_SERVE,
    initialize_service_runtime,
    resolve_startup_mode,
)
from memory_anki.app.startup_warmup import (
    start_db_pool_warmup,
    start_startup_warmup,
)
from memory_anki.core.api_token_auth import ApiTokenAuthMiddleware
from memory_anki.core.config import (
    ATTACHMENTS_DIR,
    MEMORY_ANKI_API_TOKEN,
    WEB_DIST_DIR,
    ensure_runtime_dirs,
)
from memory_anki.core.request_logging import RequestLoggingMiddleware
from memory_anki.core.runtime_activity import (
    start_runtime_activity_heartbeat,
    stop_runtime_activity_heartbeat,
)
from memory_anki.infrastructure.db._tables._base import get_session as _get_session
from memory_anki.modules.backups.application.backup_lifecycle import (
    start_startup_backups,
    stop_startup_backups,
)
from memory_anki.modules.backups.presentation import router as backups_router
from memory_anki.modules.content.application.study_text_library_cache import (
    start_study_text_prepare,
)
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.dashboard.presentation.router import request_dashboard_refresh
from memory_anki.modules.english.presentation import router as english_router
from memory_anki.modules.english_lookup.presentation import router as english_lookup_router
from memory_anki.modules.exam.presentation import router as exam_router
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.memory.application.unit_reconcile_scheduler import (
    start_reconcile_worker,
)
from memory_anki.modules.memory.presentation import router as review_router
from memory_anki.modules.practice.presentation import router as freestyle_router
from memory_anki.modules.produce.presentation import import_router
from memory_anki.modules.progression.presentation import router as progression_router
from memory_anki.modules.quiz.presentation import router as palace_quiz_router
from memory_anki.modules.search.presentation import router as search_router
from memory_anki.modules.session.presentation import router as sessions_router
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.platform.persistence import (
    start_mutation_response_purge_loop,
    stop_mutation_response_purge_loop,
)

get_session = _get_session
logger = logging.getLogger(__name__)

HASHED_WEB_ASSET_PATTERN = re.compile(
    r"^/assets/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf)$"
)


class SinglePageAppStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
        else:
            if response.status_code != 404:
                return response
        if scope.get("method") not in {"GET", "HEAD"}:
            raise StarletteHTTPException(status_code=404)
        requested_path = "/" + path.replace("\\", "/").lstrip("/")
        if requested_path.startswith("/assets/"):
            raise StarletteHTTPException(status_code=404)
        if Path(path).suffix:
            raise StarletteHTTPException(status_code=404)
        return await super().get_response("index.html", scope)


class WebCacheHeadersMiddleware:
    """Pure ASGI cache headers so /session/live/stream is not buffered."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path") or "")

        async def send_with_cache_headers(message: Message) -> None:
            if message["type"] == "http.response.start" and not path.startswith("/api"):
                headers = MutableHeaders(raw=list(message.get("headers") or []))
                status_code = int(message.get("status") or 500)
                if headers.get("Cache-Control") == "no-store":
                    pass
                elif status_code < 400 and HASHED_WEB_ASSET_PATTERN.match(path):
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                else:
                    headers["Cache-Control"] = "no-cache"
                message["headers"] = headers.raw
            await send(message)

        await self.app(scope, receive, send_with_cache_headers)


def install_web_cache_headers(app: FastAPI) -> None:
    app.add_middleware(WebCacheHeadersMiddleware)


class DashboardInvalidationMiddleware:
    """Refresh the dashboard snapshot after a successful API mutation.

    Without this the snapshot cache only expires on its five-second TTL, so a
    review session followed by a dashboard visit could show pre-session counts.
    The refresh stays in the dashboard context; this middleware only reports that
    some write succeeded.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = str(scope.get("method") or "").upper()
        path = str(scope.get("path") or "")
        if method in {"GET", "HEAD", "OPTIONS"} or not path.startswith("/api/v1/"):
            await self.app(scope, receive, send)
            return

        async def send_and_invalidate(message: Message) -> None:
            if message["type"] == "http.response.start" and int(message.get("status") or 500) < 400:
                request_dashboard_refresh()
            await send(message)

        await self.app(scope, receive, send_and_invalidate)


def install_dashboard_invalidation(app: FastAPI) -> None:
    app.add_middleware(DashboardInvalidationMiddleware)


def _resolve_cors_origins() -> list[str]:
    """Default to local app/dev origins; append remote origins from the environment."""
    origins = [
        "http://127.0.0.1:8012",
        "http://localhost:8012",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]
    extra = os.environ.get("MEMORY_ANKI_CORS_ORIGINS", "")
    origins.extend(origin.strip() for origin in extra.split(",") if origin.strip())
    return origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup_mode = resolve_startup_mode()
    startup_state = initialize_service_runtime(app, mode=startup_mode)
    runtime_activity_handle = None
    # Runs in every mode: the desktop/PWA process serves in healthcheck mode,
    # where start_startup_warmup() is skipped, and it is exactly that process
    # whose first user request would otherwise pay the cold pool open.
    start_db_pool_warmup()
    # Cleanup and the once-per-day backup run in every mode. The desktop/PWA
    # process serves in healthcheck mode, and it is the process that stays open all day.
    start_mutation_response_purge_loop()
    start_startup_backups()
    if startup_mode == STARTUP_MODE_SERVE:
        runtime_activity_handle = start_runtime_activity_heartbeat(
            channel=str(startup_state.runtime_info.get("channel") or "production"),
            startup_mode=startup_mode,
        )
        start_startup_warmup()
        start_study_text_prepare()
    # Desktop/PWA launches may use healthcheck mode while still serving the real
    # API. Read requests defer stale projections, so the reconciler must run in
    # every serving mode or queued repairs never converge.
    start_reconcile_worker()
    try:
        yield
    finally:
        stop_startup_backups()
        stop_mutation_response_purge_loop()
        if startup_mode == STARTUP_MODE_SERVE:
            stop_runtime_activity_heartbeat(runtime_activity_handle)


app = FastAPI(title="Memory Anki API", lifespan=lifespan)
install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ApiTokenAuthMiddleware, token=MEMORY_ANKI_API_TOKEN)
app.add_middleware(RequestLoggingMiddleware)
install_web_cache_headers(app)
install_dashboard_invalidation(app)

ensure_runtime_dirs()
app.mount("/api/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")

app.include_router(palace_router.router, prefix="/api/v1")
app.include_router(backups_router.router, prefix="/api/v1")
app.include_router(palace_quiz_router.router, prefix="/api/v1")
app.include_router(review_router.router, prefix="/api/v1")
app.include_router(sessions_router.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(import_router.router, prefix="/api/v1")
app.include_router(knowledge_router.router, prefix="/api/v1")
app.include_router(english_router.router, prefix="/api/v1")
app.include_router(english_lookup_router, prefix="/api/v1")
app.include_router(freestyle_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")
app.include_router(exam_router.router, prefix="/api/v1")
app.include_router(progression_router.router, prefix="/api/v1")
app.include_router(search_router.router, prefix="/api/v1")

if WEB_DIST_DIR and WEB_DIST_DIR.exists():
    app.mount("/", SinglePageAppStaticFiles(directory=str(WEB_DIST_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("memory_anki.app.main:app", host="127.0.0.1", port=8012)
