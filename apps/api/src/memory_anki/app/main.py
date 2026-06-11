import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR, DEFAULTS, WEB_DIST_DIR
from memory_anki.core.logging import configure_logging
from memory_anki.core.migration import (
    ensure_legacy_repo_data_migrated,
    is_app_migration_completed,
    mark_app_migration_completed,
)
from memory_anki.core.request_logging import RequestLoggingMiddleware
from memory_anki.core.runtime import (
    assert_runtime_compatible,
    build_runtime_info,
    load_runtime_contract,
    record_runtime_start,
)
from memory_anki.infrastructure.db.models import Config, get_session, init_db
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    ensure_external_ai_call_log_schema,
)
from memory_anki.modules.backups.application.backup_service import (
    create_shutdown_backup,
    ensure_backup_schema,
    ensure_daily_backup,
    maybe_create_periodic_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.english.application.startup import (
    ensure_english_storage_schema,
    prepare_english_runtime,
)
from memory_anki.modules.english.presentation import router as english_router
from memory_anki.modules.english_reading.application.startup import (
    ensure_english_reading_storage_schema,
    prepare_english_reading,
)
from memory_anki.modules.english_reading.presentation import router as english_reading_router
from memory_anki.modules.knowledge.application.bilink_service import ensure_bilink_schema
from memory_anki.modules.knowledge.application.subject_document_service import (
    ensure_subject_document_schema,
)
from memory_anki.modules.knowledge.presentation import bilink_router
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.mindmap.application.editor_state_service import ensure_editor_schema
from memory_anki.modules.palaces.application.mindmap_import_job_service import (
    ensure_mindmap_import_job_schema,
)
from memory_anki.modules.palaces.application.mini_palace_service import (
    ensure_mini_palace_schema,
)
from memory_anki.modules.palaces.application.segment_service import ensure_segment_schema
from memory_anki.modules.palaces.application.title_sync_service import (
    ensure_palace_group_schema,
)
from memory_anki.modules.palaces.presentation import import_router
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.application.review_execution_service import (
    repair_review_stage_progress,
)
from memory_anki.modules.reviews.application.schedule_service import (
    ensure_review_schedule_schema,
    migrate_sm2_to_ebbinghaus,
    normalize_algorithm,
)
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.modules.sessions.application.session_progress_service import (
    ensure_session_progress_schema,
)
from memory_anki.modules.sessions.presentation import router as sessions_router
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.modules.time_records.application.time_records_service import (
    ensure_review_log_time_records,
    normalize_time_record_event_timezones,
)
from memory_anki.modules.time_records.presentation import router as time_records_router
from memory_anki.modules.voice_coach import presentation as voice_coach_router

REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY = "review_schedule_anchor_repair_v1"


def install_web_cache_headers(app: FastAPI) -> None:
    @app.middleware("http")
    async def disable_web_static_cache(request: Request, call_next):
        response = await call_next(request)
        if not request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def run_review_schedule_repair_migration(session: Session):
    if is_app_migration_completed(REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY):
        return None
    result = repair_review_stage_progress(session)
    mark_app_migration_completed(
        REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY,
        {
            "result": result,
        },
    )
    return result


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    runtime_contract = load_runtime_contract()
    shared_state = assert_runtime_compatible(runtime_contract)
    app.state.runtime_contract = runtime_contract
    app.state.runtime_info = build_runtime_info(runtime_contract, shared_state)
    ensure_legacy_repo_data_migrated()
    init_db()
    ensure_editor_schema()
    ensure_bilink_schema()
    ensure_subject_document_schema()
    ensure_segment_schema()
    ensure_mini_palace_schema()
    ensure_mindmap_import_job_schema()
    ensure_external_ai_call_log_schema()
    ensure_english_storage_schema()
    ensure_english_reading_storage_schema()
    ensure_palace_group_schema()
    ensure_review_schedule_schema()
    ensure_session_progress_schema()
    session = get_session()
    try:
        ensure_backup_schema(session)
        prepare_english_runtime(session)
        prepare_english_reading(session)
        for key, value in DEFAULTS.items():
            existing = session.query(Config).filter_by(key=key).first()
            if not existing:
                session.add(Config(key=key, value=value))
            elif key == "default_algorithm":
                existing.value = normalize_algorithm(existing.value)
        session.commit()
        migrate_sm2_to_ebbinghaus(session)
        ensure_review_log_time_records(session)
        normalize_time_record_event_timezones(session)
        run_review_schedule_repair_migration(session)
        ensure_daily_backup()
        maybe_create_periodic_backup()
        started_state = record_runtime_start(
            runtime_contract,
            channel=os.environ.get("MEMORY_ANKI_CHANNEL") or "dev",
            commit=os.environ.get("MEMORY_ANKI_GIT_COMMIT"),
        )
        app.state.runtime_info = build_runtime_info(runtime_contract, started_state)
    finally:
        session.close()
    start_periodic_backup_loop()
    try:
        yield
    finally:
        stop_periodic_backup_loop()
        try:
            create_shutdown_backup()
        except Exception:
            pass


app = FastAPI(title="Memory Anki API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)
install_web_cache_headers(app)

app.mount("/api/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")

app.include_router(palace_router.router, prefix="/api/v1")
app.include_router(review_router.router, prefix="/api/v1")
app.include_router(sessions_router.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(import_router.router, prefix="/api/v1")
app.include_router(knowledge_router.router, prefix="/api/v1")
app.include_router(bilink_router.router, prefix="/api/v1")
app.include_router(time_records_router.router, prefix="/api/v1")
app.include_router(english_router.router, prefix="/api/v1")
app.include_router(english_reading_router.router, prefix="/api/v1")
app.include_router(voice_coach_router.router, prefix="/api/v1")
app.include_router(dashboard_router.router, prefix="/api/v1")

if WEB_DIST_DIR and WEB_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIST_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("memory_anki.app.main:app", host="127.0.0.1", port=8012)
