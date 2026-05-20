from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from memory_anki.core.config import ATTACHMENTS_DIR, DEFAULTS
from memory_anki.core.logging import configure_logging
from memory_anki.core.migration import ensure_legacy_repo_data_migrated
from memory_anki.infrastructure.db.models import Config, get_session, init_db
from memory_anki.modules.backups.application.backup_service import (
    create_shutdown_backup,
    ensure_backup_schema,
    ensure_daily_backup,
    maybe_create_periodic_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.mindmap.application.editor_state_service import ensure_editor_schema
from memory_anki.modules.palaces.application.segment_service import ensure_segment_schema
from memory_anki.modules.palaces.application.title_sync_service import ensure_palace_group_schema
from memory_anki.modules.palaces.presentation import import_router
from memory_anki.modules.palaces.presentation import router as palace_router
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
    get_today_formal_review_duration_seconds,
    ensure_review_log_time_records,
    get_today_total_review_duration_seconds,
    normalize_time_record_event_timezones,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
)
from memory_anki.modules.time_records.presentation import router as time_records_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    ensure_legacy_repo_data_migrated()
    init_db()
    ensure_editor_schema()
    ensure_segment_schema()
    ensure_palace_group_schema()
    ensure_review_schedule_schema()
    ensure_session_progress_schema()
    session = get_session()
    try:
        ensure_backup_schema(session)
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
        ensure_daily_backup()
        maybe_create_periodic_backup()
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

app.mount("/api/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")

app.include_router(palace_router.router, prefix="/api/v1")
app.include_router(review_router.router, prefix="/api/v1")
app.include_router(sessions_router.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(import_router.router, prefix="/api/v1")
app.include_router(knowledge_router.router, prefix="/api/v1")
app.include_router(time_records_router.router, prefix="/api/v1")


@app.get("/api/v1/dashboard")
def api_dashboard():
    session = get_session()
    try:
        from memory_anki.infrastructure.db.models import Palace
        from memory_anki.modules.reviews.application.review_service import (
            get_today_review_groups,
            get_weekly_stats,
        )

        reviews = get_today_review_groups(session)
        recent = session.query(Palace).order_by(Palace.updated_at.desc()).limit(5).all()

        def palace_out(palace):
            return {
                "id": palace.id,
                "title": palace.title,
                "description": palace.description,
                "peg_count": len(palace.pegs),
                "created_at": palace.created_at.isoformat() if palace.created_at else None,
            }

        today_total_review_duration_seconds = get_today_total_review_duration_seconds(session)
        today_review_duration_seconds = get_today_formal_review_duration_seconds(session)
        weekly_formal_review_duration_seconds = get_weekly_formal_review_duration_seconds(session)
        weekly_total_review_duration_seconds = get_weekly_total_review_duration_seconds(session)

        return {
            "due_count": len(reviews),
            "reviews": [
                {
                    "id": review["schedule"].id,
                    "palace_id": review["schedule"].palace_id,
                    "palace": palace_out(review["schedule"].palace) if review["schedule"].palace else None,
                    "scheduled_date": review["schedule"].scheduled_date.isoformat(),
                    "interval_days": review["schedule"].interval_days,
                    "algorithm_used": review["schedule"].algorithm_used,
                    "review_number": review["schedule"].review_number,
                    "completed": review["schedule"].completed,
                    "schedule_count": review["schedule_count"],
                    "overdue_schedule_count": review["overdue_schedule_count"],
                    "next_due_date": review["next_due_date"].isoformat(),
                }
                for review in reviews
            ],
            "stats": get_weekly_stats(session),
            "today_review_duration_seconds": today_review_duration_seconds,
            "weekly_review_duration_seconds": weekly_formal_review_duration_seconds,
            "today_total_review_duration_seconds": today_total_review_duration_seconds,
            "weekly_total_review_duration_seconds": weekly_total_review_duration_seconds,
            "weekly_formal_review_duration_seconds": weekly_formal_review_duration_seconds,
            "recent_palaces": [palace_out(palace) for palace in recent],
        }
    finally:
        session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("memory_anki.app.main:app", host="127.0.0.1", port=8000, reload=True)
