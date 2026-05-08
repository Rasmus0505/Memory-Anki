import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from models import init_db, get_session, Config
from config import DEFAULTS, ATTACHMENTS_DIR
from editor_state import ensure_editor_schema
from services.backup_service import (
    create_shutdown_backup,
    ensure_backup_schema,
    ensure_daily_backup,
    maybe_create_periodic_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
from services.schedule_service import migrate_sm2_to_ebbinghaus, normalize_algorithm
from services.session_progress_service import ensure_session_progress_schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ensure_editor_schema()
    ensure_session_progress_schema()
    s = get_session()
    try:
        ensure_backup_schema(s)
        for key, value in DEFAULTS.items():
            existing = s.query(Config).filter_by(key=key).first()
            if not existing:
                s.add(Config(key=key, value=value))
            elif key == "default_algorithm":
                existing.value = normalize_algorithm(existing.value)
        s.commit()
        migrate_sm2_to_ebbinghaus(s)
        ensure_daily_backup()
        maybe_create_periodic_backup()
    finally:
        s.close()
    start_periodic_backup_loop()
    try:
        yield
    finally:
        stop_periodic_backup_loop()
        try:
            create_shutdown_backup()
        except Exception:
            pass


app = FastAPI(title="记忆宫殿 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/api/attachments", StaticFiles(directory=str(ATTACHMENTS_DIR)), name="attachments")

from routers.palace_router import router as palace_router
from routers.review_router import router as review_router
from routers.config_router import router as config_router
from routers.import_router import router as import_router
from routers.knowledge_router import router as knowledge_router

app.include_router(palace_router, prefix="/api")
app.include_router(review_router, prefix="/api")
app.include_router(config_router, prefix="/api")
app.include_router(import_router, prefix="/api")
app.include_router(knowledge_router, prefix="/api")

@app.get("/api/dashboard")
def api_dashboard():
    s = get_session()
    try:
        from services.review_service import get_today_reviews, get_due_count, get_weekly_stats
        reviews = get_today_reviews(s)
        from models import Palace
        recent = s.query(Palace).order_by(Palace.updated_at.desc()).limit(5).all()

        def palace_out(p):
            return {
                "id": p.id, "title": p.title, "description": p.description,
                "peg_count": len(p.pegs),
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }

        return {
            "due_count": len(reviews),
            "reviews": [{
                "id": r.id, "palace_id": r.palace_id,
                "palace": palace_out(r.palace) if r.palace else None,
                "scheduled_date": r.scheduled_date.isoformat(),
                "interval_days": r.interval_days,
                "algorithm_used": r.algorithm_used,
                "review_number": r.review_number,
                "completed": r.completed,
            } for r in reviews],
            "stats": get_weekly_stats(s),
            "recent_palaces": [palace_out(p) for p in recent],
        }
    finally:
        s.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
