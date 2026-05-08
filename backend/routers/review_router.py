from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models import Chapter, ReviewSchedule, get_session
from services.review_service import (
    get_chapter_queue_payload,
    get_next_due_review,
    get_overdue_count,
    get_review_queue_payload,
    get_weekly_stats,
    spread_overdue,
    submit_review,
)
from services.session_progress_service import (
    clear_review_progress,
    get_review_progress,
    upsert_review_progress,
)

router = APIRouter(tags=["review"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def peg_json(peg) -> dict:
    return {
        "id": peg.id,
        "name": peg.name,
        "content": peg.content,
        "sort_order": peg.sort_order,
        "parent_id": peg.parent_id,
        "children": [peg_json(child) for child in (peg.children or [])],
    }


def palace_json(palace) -> dict:
    return {
        "id": palace.id,
        "title": palace.title,
        "description": palace.description,
        "archived": palace.archived,
        "mastered": palace.mastered,
        "editor_doc": palace.editor_doc,
        "pegs": [peg_json(peg) for peg in palace.pegs],
        "attachments": [
            {
                "id": attachment.id,
                "filename": attachment.filename,
                "original_name": attachment.original_name,
            }
            for attachment in palace.attachments
        ],
        "chapters": [
            {
                "id": chapter.id,
                "name": chapter.name,
                "subject_id": chapter.subject_id,
                "subject": (
                    {"id": chapter.subject.id, "name": chapter.subject.name}
                    if chapter.subject
                    else None
                ),
            }
            for chapter in palace.chapters
        ],
    }


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


def schedule_json(schedule) -> dict:
    return {
        "id": schedule.id,
        "palace_id": schedule.palace_id,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "palace": palace_json(schedule.palace) if schedule.palace else None,
    }


def queue_payload_json(payload: dict) -> dict:
    return {
        "due_count": payload["due_count"],
        "overdue_count": payload["overdue_count"],
        "smoothed_count": payload["smoothed_count"],
        "stats": payload["stats"],
        "chapter": chapter_json(payload.get("chapter")),
        "reviews": [schedule_json(schedule) for schedule in payload["reviews"]],
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


@router.get("/review/queue")
def api_queue(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session))


@router.get("/review/chapter/{chapter_id}/queue")
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    payload = get_chapter_queue_payload(session, chapter_id)
    return queue_payload_json(payload)


@router.get("/review/session/{schedule_id}")
def api_review_session(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return {"error": "not found"}
    return schedule_json(schedule)


@router.get("/review/session/{schedule_id}/progress")
def api_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return {"error": "not found"}
    return {"progress": get_review_progress(session, schedule_id)}


@router.put("/review/session/{schedule_id}/progress")
def api_upsert_review_progress(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return {"error": "not found"}
    return {
        "progress": upsert_review_progress(
            session,
            schedule_id,
            schedule.palace_id,
            data,
        )
    }


@router.delete("/review/session/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


@router.post("/review/session/{schedule_id}/submit")
def api_submit_session(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    log, extra = submit_review(
        session,
        schedule_id,
        int(data.get("duration_seconds", 0)),
    )
    if not log:
        return {"error": "not found"}

    clear_review_progress(session, schedule_id)

    chapter_id = data.get("chapter_id")
    next_schedule = get_next_due_review(
        session,
        exclude_schedule_id=schedule_id,
        chapter_id=int(chapter_id) if chapter_id is not None else None,
    )
    return {
        "ok": True,
        "completion_mode": data.get("completion_mode"),
        "score": log.score,
        "next_id": next_schedule.id if next_schedule else None,
        "mastered": extra.get("mastered", False),
    }


@router.get("/review")
def api_reviews(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session))


@router.get("/review/{schedule_id}")
def api_review_item(schedule_id: int, session: Session = Depends(session_dep)):
    return api_review_session(schedule_id, session)


@router.post("/review/{schedule_id}/submit")
def api_submit(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    return api_submit_session(schedule_id, data, session)
