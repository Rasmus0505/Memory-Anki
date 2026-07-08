from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, ReviewSchedule, get_session
from memory_anki.modules.palaces.application.palace_serializer import (
    palace_json as palace_detail_json,
)
from memory_anki.modules.palaces.application.segment_review_service import palace_review_stages_json
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)
from memory_anki.modules.reviews.application.review_execution_service import (
    repair_review_stage_progress,
    submit_review,
)
from memory_anki.modules.reviews.application.review_metrics_service import get_weekly_stats
from memory_anki.modules.reviews.application.review_queue_service import (
    get_chapter_queue_payload,
    get_next_due_review,
    get_overdue_count,
    get_review_queue_payload,
    spread_overdue,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
    normalize_algorithm,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_review_progress,
    get_review_progress,
    upsert_review_progress,
)

router = APIRouter(tags=["review"])


def raise_not_found(message: str = "not found"):
    raise HTTPException(status_code=404, detail=message)


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def chapter_json(chapter: Chapter | None) -> dict | None:
    if chapter is None:
        return None
    return {
        "id": chapter.id,
        "name": chapter.name,
        "subject_id": chapter.subject_id,
        "subject": (
            {"id": chapter.subject.id, "name": chapter.subject.name}
            if chapter.subject
            else None
        ),
    }


def schedule_json(schedule: ReviewSchedule, session: Session | None = None) -> dict:
    palace_data = palace_detail_json(schedule.palace, session) if schedule.palace else None
    if palace_data and session:
        algorithm = next(
            (
                normalize_algorithm(item.algorithm_used)
                for item in (schedule.palace.review_schedules or [])
                if item.algorithm_used
            ),
            "ebbinghaus",
        )
        stage_labels = get_algorithm_stage_labels(session, algorithm)
        palace_data["stage_labels"] = stage_labels
        palace_data["review_stages"] = palace_review_stages_json(session, schedule.palace, stage_labels)
    return {
        "id": schedule.id,
        "palace_id": schedule.palace_id,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "completed_at": (
            schedule.completed_at.isoformat(timespec="minutes")
            if getattr(schedule, "completed_at", None)
            else None
        ),
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "palace": palace_data,
    }


def grouped_schedule_json(group: dict, session: Session | None = None) -> dict:
    schedule = group["schedule"]
    return {
        **schedule_json(schedule, session),
        "schedule_count": group["schedule_count"],
        "overdue_schedule_count": group["overdue_schedule_count"],
        "next_due_date": group["next_due_date"].isoformat(),
    }


def queue_payload_json(payload: dict, session: Session | None = None) -> dict:
    return {
        "due_count": payload["due_count"],
        "overdue_count": payload["overdue_count"],
        "smoothed_count": payload["smoothed_count"],
        "stats": payload["stats"],
        "chapter": chapter_json(payload.get("chapter")),
        "reviews": [grouped_schedule_json(group, session) for group in payload["reviews"]],
    }


@router.get("/review/overdue-count")
def api_overdue(session: Session = Depends(session_dep)):
    return {"count": get_overdue_count(session)}


@router.get("/review/stats/weekly")
def api_stats(session: Session = Depends(session_dep)):
    return get_weekly_stats(session)


@router.post("/review/spread-overdue")
def api_spread(data: dict, session: Session = Depends(session_dep)):
    count = spread_overdue(session, int(data.get("days", 7)))
    return {"ok": True, "spread": count}


@router.post("/review/repair-stage-progress")
def api_repair_review_stage_progress(session: Session = Depends(session_dep)):
    result = repair_review_stage_progress(session)
    return {"ok": True, **result}


@router.get("/review/queue")
def api_queue(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session), session)


@router.get("/review/chapter/{chapter_id}/queue")
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    return queue_payload_json(get_chapter_queue_payload(session, chapter_id), session)


@router.get("/review/session/{schedule_id}")
def api_review_session(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return schedule_json(schedule, session)


@router.get("/review/session/{schedule_id}/progress")
def api_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return {"progress": get_review_progress(session, schedule_id)}


@router.put("/review/session/{schedule_id}/progress")
def api_upsert_review_progress(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return {"progress": upsert_review_progress(session, schedule_id, schedule.palace_id, data)}


@router.delete("/review/session/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


@router.post("/review/session/{schedule_id}/submit")
def api_submit_session(
    schedule_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response

    log, extra = submit_review(
        session,
        schedule_id,
        int(data.get("duration_seconds", 0)),
        str(data.get("completion_mode", "manual_complete")),
        target_review_number=data.get("target_review_number"),
        needs_practice=bool(data.get("needs_practice", False)),
        commit=False,
    )
    if not log:
        raise_not_found()

    clear_review_progress(session, schedule_id, commit=False)
    chapter_id = data.get("chapter_id")
    next_schedule = get_next_due_review(
        session,
        exclude_schedule_id=schedule_id,
        chapter_id=int(chapter_id) if chapter_id is not None else None,
    )
    response = {
        "ok": True,
        "completion_mode": data.get("completion_mode"),
        "score": log.score,
        "next_id": next_schedule.id if next_schedule else None,
        "mastered": extra.get("mastered", False),
    }
    save_idempotent_response(session, request, response, commit=False)
    session.commit()
    session.refresh(log)
    return response


@router.get("/review")
def api_reviews(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session), session)


@router.get("/review/{schedule_id}")
def api_review_item(schedule_id: int, session: Session = Depends(session_dep)):
    return api_review_session(schedule_id, session)


@router.post("/review/{schedule_id}/submit")
def api_submit(
    schedule_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    return api_submit_session(schedule_id, data, request, session)
