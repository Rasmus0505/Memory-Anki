import os
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR, DEFAULTS
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
from memory_anki.modules.english.application.service import ensure_english_schema
from memory_anki.modules.english.presentation import router as english_router
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
from memory_anki.modules.palaces.application.segment_service import ensure_segment_schema
from memory_anki.modules.palaces.application.title_sync_service import (
    build_today_new_palace_outline,
    ensure_palace_group_schema,
    palace_has_due_later_today,
)
from memory_anki.modules.palaces.presentation import import_router
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.reviews.application.review_execution_service import (
    repair_review_stage_progress,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_today_review_groups,
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
    date_range_bounds,
    ensure_review_log_time_records,
    get_all_time_total_review_duration_seconds,
    get_english_course_stats,
    get_monthly_total_review_duration_seconds,
    get_selected_total_review_duration_seconds,
    get_today_formal_review_duration_seconds,
    get_today_palace_learning_breakdown,
    get_today_total_review_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
    month_bounds,
    normalize_time_record_event_timezones,
)
from memory_anki.modules.time_records.presentation import router as time_records_router

REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY = "review_schedule_anchor_repair_v1"


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
    ensure_mindmap_import_job_schema()
    ensure_external_ai_call_log_schema()
    ensure_english_schema()
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


@app.get("/api/v1/dashboard")
def api_dashboard(
    duration_mode: str | None = Query(default=None),
    month: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
):
    session = get_session()
    try:
        from memory_anki.infrastructure.db.models import Palace

        reviews = get_today_review_groups(session)
        today_start = datetime.combine(date.today(), time.min)
        today_end = today_start + timedelta(days=1)
        recent = session.query(Palace).order_by(Palace.updated_at.desc()).limit(5).all()
        today_new_palaces = (
            session.query(Palace)
            .filter(
                Palace.created_at.is_not(None),
                Palace.created_at >= today_start,
                Palace.created_at < today_end,
            )
            .order_by(Palace.created_at.asc(), Palace.id.asc())
            .all()
        )
        all_palaces = session.query(Palace).all()
        due_palace_ids = {review["schedule"].palace_id for review in reviews}
        due_later_today_count = sum(
            1
            for palace in all_palaces
            if palace.id not in due_palace_ids and palace_has_due_later_today(session, palace)
        )
        needs_practice_count = sum(1 for palace in all_palaces if bool(getattr(palace, "needs_practice", False)))

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
        monthly_total_review_duration_seconds = get_monthly_total_review_duration_seconds(session)
        weekly_formal_review_duration_seconds = get_weekly_formal_review_duration_seconds(session)
        weekly_total_review_duration_seconds = get_weekly_total_review_duration_seconds(session)
        selected_total_review_duration_seconds = monthly_total_review_duration_seconds
        english_stats = get_english_course_stats(session)

        if duration_mode is not None:
            if duration_mode == "month":
                if not month:
                    raise HTTPException(status_code=400, detail="month 为必填，格式必须是 YYYY-MM。")
                try:
                    selected_month = date.fromisoformat(f"{month}-01")
                except ValueError as error:
                    raise HTTPException(status_code=400, detail="month 格式必须是 YYYY-MM。") from error
                selected_start, selected_end = month_bounds(selected_month)
                selected_total_review_duration_seconds = get_selected_total_review_duration_seconds(
                    session,
                    start=selected_start,
                    end=selected_end,
                )
            elif duration_mode == "range":
                if not start_date or not end_date:
                    raise HTTPException(status_code=400, detail="start_date 和 end_date 为必填，格式必须是 YYYY-MM-DD。")
                try:
                    selected_start_date = date.fromisoformat(start_date)
                    selected_end_date = date.fromisoformat(end_date)
                except ValueError as error:
                    raise HTTPException(status_code=400, detail="start_date 和 end_date 格式必须是 YYYY-MM-DD。") from error
                if selected_start_date > selected_end_date:
                    raise HTTPException(status_code=400, detail="开始日期不能晚于结束日期。")
                selected_start, selected_end = date_range_bounds(selected_start_date, selected_end_date)
                selected_total_review_duration_seconds = get_selected_total_review_duration_seconds(
                    session,
                    start=selected_start,
                    end=selected_end,
                )
            elif duration_mode == "all":
                selected_total_review_duration_seconds = get_all_time_total_review_duration_seconds(session)
            else:
                raise HTTPException(status_code=400, detail="duration_mode 仅支持 month、range 或 all。")

        return {
            "due_count": len(reviews),
            "due_later_today_count": due_later_today_count,
            "needs_practice_count": needs_practice_count,
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
            "monthly_total_review_duration_seconds": monthly_total_review_duration_seconds,
            "selected_total_review_duration_seconds": selected_total_review_duration_seconds,
            "weekly_total_review_duration_seconds": weekly_total_review_duration_seconds,
            "weekly_formal_review_duration_seconds": weekly_formal_review_duration_seconds,
            "english_stats": english_stats,
            "recent_palaces": [palace_out(palace) for palace in recent],
            "today_learning_palaces": get_today_palace_learning_breakdown(session),
            "today_new_palace_count": len(today_new_palaces),
            "today_new_palaces": build_today_new_palace_outline(session, today_new_palaces),
        }
    finally:
        session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("memory_anki.app.main:app", host="127.0.0.1", port=8000, reload=True)
