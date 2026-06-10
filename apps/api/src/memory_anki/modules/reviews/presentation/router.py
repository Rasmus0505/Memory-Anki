from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
    get_session,
)
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    build_segment_editor_doc,
    palace_review_stages_json,
    segment_summary_json,
)
from memory_anki.modules.palaces.presentation.router import palace_json as palace_detail_json
from memory_anki.modules.reviews.application.review_execution_service import (
    build_batch_segment_review_session,
    submit_batch_segment_review,
    submit_review,
    submit_segment_review,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_chapter_queue_payload,
    get_next_due_review,
    get_next_due_segment_review,
    get_overdue_count,
    get_review_queue_payload,
    get_segment_chapter_queue_payload,
    get_segment_overdue_count,
    get_segment_review_queue_payload,
    segment_schedule_json,
    spread_overdue,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
    get_config_value,
    normalize_algorithm,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_review_progress,
    clear_segment_review_progress,
    get_review_progress,
    get_segment_review_progress,
    upsert_review_progress,
    upsert_segment_review_progress,
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


def schedule_json(schedule, session: Session | None = None) -> dict:
    palace_data = palace_json(schedule.palace) if schedule.palace else None
    if palace_data and session:
        algorithm = next(
            (
                normalize_algorithm(s.algorithm_used)
                for s in (schedule.palace.review_schedules or [])
                if s.algorithm_used
            ),
            normalize_algorithm(get_config_value(session, "default_algorithm")),
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
        "completed_at": schedule.completed_at.isoformat(timespec="minutes") if getattr(schedule, "completed_at", None) else None,
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


def grouped_segment_schedule_json(group: dict, session: Session) -> dict:
    schedule = group["schedule"]
    return {
        **segment_schedule_json(schedule, session),
        "schedule_count": group["schedule_count"],
        "overdue_schedule_count": group["overdue_schedule_count"],
        "next_due_date": group["next_due_date"].isoformat(),
    }


def build_virtual_default_segment_session_payload(
    schedule: ReviewSchedule,
    session: Session,
) -> dict | None:
    if not schedule.palace:
        return None
    palace_payload = palace_detail_json(schedule.palace, session)
    virtual_segment = next(
        (
            item
            for item in (palace_payload.get("segments") or [])
            if item.get("is_virtual_default")
            and item.get("current_review_schedule_id") == schedule.id
        ),
        None,
    )
    if not virtual_segment:
        return None
    return {
        "id": schedule.id,
        "palace_segment_id": 0,
        "palace_id": schedule.palace_id,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "segment": virtual_segment,
        "estimated_review_seconds": virtual_segment.get("estimated_review_seconds", 0),
        "palace": palace_payload,
        "editor_doc": build_segments_editor_doc(
            schedule.palace,
            [list(virtual_segment.get("node_uids") or [])],
        ),
        "is_virtual_default_session": True,
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


def segment_queue_payload_json(payload: dict, session: Session) -> dict:
    return {
        "due_count": payload["due_count"],
        "overdue_count": payload["overdue_count"],
        "smoothed_count": payload["smoothed_count"],
        "stats": payload["stats"],
        "chapter": chapter_json(payload.get("chapter")),
        "reviews": [grouped_segment_schedule_json(group, session) for group in payload["reviews"]],
    }


@router.get("/review/overdue-count")
def api_overdue(session: Session = Depends(session_dep)):
    return {"count": get_overdue_count(session)}


@router.get("/segment-review/overdue-count")
def api_segment_overdue(session: Session = Depends(session_dep)):
    return {"count": get_segment_overdue_count(session)}


@router.get("/review/stats/weekly")
def api_stats(session: Session = Depends(session_dep)):
    return get_weekly_stats(session)


@router.post("/review/spread-overdue")
def api_spread(data: dict, session: Session = Depends(session_dep)):
    count = spread_overdue(session, int(data.get("days", 7)))
    return {"ok": True, "spread": count}


@router.get("/review/queue")
def api_queue(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session), session)


@router.get("/segment-review/queue")
def api_segment_queue(session: Session = Depends(session_dep)):
    return segment_queue_payload_json(get_segment_review_queue_payload(session), session)


@router.get("/review/chapter/{chapter_id}/queue")
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    payload = get_chapter_queue_payload(session, chapter_id)
    return queue_payload_json(payload, session)


@router.get("/segment-review/chapter/{chapter_id}/queue")
def api_segment_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    payload = get_segment_chapter_queue_payload(session, chapter_id)
    return segment_queue_payload_json(payload, session)


@router.get("/review/session/{schedule_id}")
def api_review_session(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return schedule_json(schedule, session)


@router.get("/segment-review/session/{schedule_id}")
def api_segment_review_session(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if schedule and schedule.segment:
        payload = segment_schedule_json(schedule, session)
        payload["palace"] = palace_json(schedule.segment.palace) if schedule.segment.palace else None
        payload["segment"] = segment_summary_json(session, schedule.segment)
        payload["editor_doc"] = build_segment_editor_doc(schedule.segment.palace, schedule.segment)
        return payload

    review_schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not review_schedule:
        raise_not_found()
    payload = build_virtual_default_segment_session_payload(review_schedule, session)
    if not payload:
        raise_not_found()
    return payload


@router.post("/segment-review/batch-session")
def api_batch_segment_review_session(data: dict, session: Session = Depends(session_dep)):
    try:
        return build_batch_segment_review_session(session, list(data.get("segment_ids") or []))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/session/{schedule_id}/progress")
def api_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return {"progress": get_review_progress(session, schedule_id)}


@router.get("/segment-review/session/{schedule_id}/progress")
def api_segment_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if schedule:
        return {"progress": get_segment_review_progress(session, schedule_id)}

    review_schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    payload = build_virtual_default_segment_session_payload(review_schedule, session) if review_schedule else None
    if not payload:
        raise_not_found()
    return {"progress": get_review_progress(session, schedule_id)}


@router.put("/review/session/{schedule_id}/progress")
def api_upsert_review_progress(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        raise_not_found()
    return {
        "progress": upsert_review_progress(
            session,
            schedule_id,
            schedule.palace_id,
            data,
        )
    }


@router.put("/segment-review/session/{schedule_id}/progress")
def api_upsert_segment_review_progress(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if schedule and schedule.segment:
        return {
            "progress": upsert_segment_review_progress(
                session,
                schedule_id,
                schedule.palace_segment_id,
                schedule.segment.palace_id,
                data,
            )
        }

    review_schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    payload = build_virtual_default_segment_session_payload(review_schedule, session) if review_schedule else None
    if not payload:
        raise_not_found()
    return {
        "progress": upsert_review_progress(
            session,
            schedule_id,
            review_schedule.palace_id,
            data,
        )
    }


@router.delete("/review/session/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


@router.delete("/segment-review/session/{schedule_id}/progress")
def api_delete_segment_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    if session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first():
        clear_segment_review_progress(session, schedule_id)
        return {"ok": True}
    if session.query(ReviewSchedule).filter_by(id=schedule_id).first():
        clear_review_progress(session, schedule_id)
        return {"ok": True}
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
    )
    if not log:
        raise_not_found()

    clear_review_progress(session, schedule_id)

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
    save_idempotent_response(session, request, response)
    return response


@router.post("/segment-review/session/{schedule_id}/submit")
def api_submit_segment_session(
    schedule_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response

    schedule, extra = submit_segment_review(
        session,
        schedule_id,
        int(data.get("duration_seconds", 0)),
        str(data.get("completion_mode", "manual_complete")),
        target_review_number=data.get("target_review_number"),
        needs_practice=bool(data.get("needs_practice", False)),
    )
    if schedule:
        clear_segment_review_progress(session, schedule_id)

        chapter_id = data.get("chapter_id")
        next_schedule = get_next_due_segment_review(
            session,
            exclude_schedule_id=schedule_id,
            chapter_id=int(chapter_id) if chapter_id is not None else None,
        )
        response = {
            "ok": True,
            "completion_mode": data.get("completion_mode"),
            "score": 5,
            "next_id": next_schedule.id if next_schedule else None,
            "mastered": extra.get("mastered", False),
        }
        save_idempotent_response(session, request, response)
        return response

    review_log, review_extra = submit_review(
        session,
        schedule_id,
        int(data.get("duration_seconds", 0)),
        str(data.get("completion_mode", "manual_complete")),
        target_review_number=data.get("target_review_number"),
        needs_practice=bool(data.get("needs_practice", False)),
    )
    if not review_log:
        raise_not_found()

    clear_review_progress(session, schedule_id)
    response = {
        "ok": True,
        "completion_mode": data.get("completion_mode"),
        "score": 5,
        "next_id": None,
        "mastered": review_extra.get("mastered", False) if review_log else False,
    }
    save_idempotent_response(session, request, response)
    return response


@router.post("/segment-review/batch-session/submit")
def api_submit_batch_segment_session(
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response

    try:
        response = submit_batch_segment_review(
            session,
            list(data.get("segment_ids") or []),
            duration_seconds=int(data.get("duration_seconds", 0)),
            completion_mode=str(data.get("completion_mode", "manual_complete")),
        )
        save_idempotent_response(session, request, response)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
