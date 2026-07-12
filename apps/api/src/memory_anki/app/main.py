import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from memory_anki.app.error_handlers import install_error_handlers
from memory_anki.app.startup_runtime import (
    STARTUP_MODE_SERVE,
    initialize_service_runtime,
    resolve_startup_mode,
)
from memory_anki.app.startup_warmup import start_startup_warmup
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
    create_shutdown_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
from memory_anki.modules.backups.presentation import router as backups_router
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.english.presentation import router as english_router
from memory_anki.modules.english_reading.presentation import router as english_reading_router
from memory_anki.modules.freestyle.presentation import router as freestyle_router
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.mindmap_learning.presentation import router as mindmap_router
from memory_anki.modules.palace_quiz.presentation import router as palace_quiz_router
from memory_anki.modules.palace_quiz.presentation import (
    workspace_router as palace_quiz_workspace_router,
)
from memory_anki.modules.palaces.presentation import import_router
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.search.presentation import router as search_router
from memory_anki.modules.sessions.presentation import router as sessions_router
from memory_anki.modules.settings.presentation import router as settings_router

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


def install_web_cache_headers(app: FastAPI) -> None:
    @app.middleware("http")
    async def disable_web_static_cache(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api"):
            return response
        if response.headers.get("Cache-Control") == "no-store":
            return response
        if response.status_code < 400 and HASHED_WEB_ASSET_PATTERN.match(path):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        response.headers["Cache-Control"] = "no-cache"
        return response


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
    if startup_mode == STARTUP_MODE_SERVE:
        runtime_activity_handle = start_runtime_activity_heartbeat(
            channel=str(startup_state.runtime_info.get("channel") or "production"),
            startup_mode=startup_mode,
        )
        start_periodic_backup_loop()
        start_startup_warmup()
    try:
        yield
    finally:
        if startup_mode == STARTUP_MODE_SERVE:
            stop_periodic_backup_loop()
            stop_runtime_activity_heartbeat(runtime_activity_handle)
            try:
                create_shutdown_backup()
            except Exception:
                logger.exception("shutdown backup failed")


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

ensure_runtime_dirs()
app.mount("/api/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")

app.include_router(palace_router.router, prefix="/api/v1")
app.include_router(backups_router.router, prefix="/api/v1")
app.include_router(palace_quiz_router.router, prefix="/api/v1")
app.include_router(palace_quiz_workspace_router.router, prefix="/api/v1")
app.include_router(review_router.router, prefix="/api/v1")
app.include_router(sessions_router.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(import_router.router, prefix="/api/v1")
app.include_router(knowledge_router.router, prefix="/api/v1")
app.include_router(mindmap_router.router, prefix="/api/v1")
app.include_router(english_router.router, prefix="/api/v1")
app.include_router(english_reading_router.router, prefix="/api/v1")
app.include_router(freestyle_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")
app.include_router(search_router.router, prefix="/api/v1")

if WEB_DIST_DIR and WEB_DIST_DIR.exists():
    app.mount("/", SinglePageAppStaticFiles(directory=str(WEB_DIST_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("memory_anki.app.main:app", host="127.0.0.1", port=8012)
