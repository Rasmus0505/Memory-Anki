from datetime import date as date_type
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from models import get_session, ReviewSchedule
from services.review_service import (
    get_today_reviews, get_due_count, submit_review, get_weekly_stats
)

router = APIRouter(tags=["review"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def schedule_json(sched) -> dict:
    return {
        "id": sched.id,
        "palace_id": sched.palace_id,
        "scheduled_date": sched.scheduled_date.isoformat(),
        "interval_days": sched.interval_days,
        "algorithm_used": sched.algorithm_used,
        "completed": sched.completed,
        "review_number": sched.review_number,
        "review_type": sched.review_type,
        "palace": {
            "id": sched.palace.id,
            "title": sched.palace.title,
            "description": sched.palace.description,
            "difficulty": sched.palace.difficulty,
            "review_mode": sched.palace.review_mode,
            "pegs": [{"id": p.id, "name": p.name, "content": p.content,
                      "sort_order": p.sort_order, "parent_id": p.parent_id,
                      "children": [{"id": c.id, "name": c.name, "content": c.content,
                                    "sort_order": c.sort_order, "parent_id": c.parent_id,
                                    "children": []} for c in (p.children or [])]}
                     for p in sched.palace.pegs],
            "attachments": [{"id": a.id, "filename": a.filename,
                             "original_name": a.original_name} for a in sched.palace.attachments],
        } if sched.palace else None,
    }


@router.get("/review")
def api_reviews(s: Session = Depends(session_dep)):
    reviews = get_today_reviews(s)
    return {"due_count": len(reviews), "reviews": [schedule_json(r) for r in reviews]}


@router.get("/review/{schedule_id}")
def api_review_item(schedule_id: int, s: Session = Depends(session_dep)):
    sched = s.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not sched:
        return {"error": "not found"}
    return schedule_json(sched)


@router.post("/review/{schedule_id}/submit")
def api_submit(schedule_id: int, data: dict, s: Session = Depends(session_dep)):
    """data: {score: int, duration_seconds: int}"""
    log, extra = submit_review(s, schedule_id, data.get("score", 0), data.get("duration_seconds", 0))
    if not log:
        return {"error": "not found"}

    today = date_type.today()
    next_sched = (
        s.query(ReviewSchedule)
        .filter(ReviewSchedule.scheduled_date <= today, ReviewSchedule.completed == False,
                ReviewSchedule.id != schedule_id)
        .order_by(ReviewSchedule.scheduled_date)
        .first()
    )
    return {
        "ok": True, "score": log.score,
        "next_id": next_sched.id if next_sched else None,
        "mastered": extra.get("mastered", False),
    }


@router.get("/review/stats/weekly")
def api_stats(s: Session = Depends(session_dep)):
    return get_weekly_stats(s)


@router.post("/review/spread-overdue")
def api_spread(data: dict, s: Session = Depends(session_dep)):
    count = spread_overdue(s, data.get("days", 7))
    return {"ok": True, "spread": count}


@router.get("/review/overdue-count")
def api_overdue(s: Session = Depends(session_dep)):
    return {"count": get_overdue_count(s)}
