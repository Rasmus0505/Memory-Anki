"""Palace serialization (presentation-independent).

``palace_json`` (the session-aware full serializer), ``peg_json`` and
``review_plan_item_json`` live here so that both the palaces and the reviews
presentation layers can serialize palaces via the *application* layer instead
of reaching across presentation modules.

Extracted from ``palaces/presentation/router.py`` (P3.1).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import ReviewSchedule
from memory_anki.modules.palaces.application.mini_palace_service import (
    list_palace_mini_palaces,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    build_palace_default_segment_summary,
    list_palace_segments,
    palace_review_stages_json,
    palace_stage_progress,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
    resolve_palace_binding_status,
    resolve_palace_subject,
    resolve_palace_title,
)
from memory_anki.modules.reviews.api import (
    get_algorithm_stage_labels,
    is_schedule_due,
)
from memory_anki.modules.reviews.api import (
    schedule_display_datetime as review_schedule_display_datetime,
)


def peg_json(peg) -> dict:
    return {
        "id": peg.id, "name": peg.name, "content": peg.content,
        "sort_order": peg.sort_order, "parent_id": peg.parent_id,
        "children": [peg_json(c) for c in (peg.children or [])],
    }


def review_plan_item_json(
    date_key: str | None,
    schedules: list[ReviewSchedule],
) -> dict:
    representative_schedule = min(schedules, key=lambda item: (item.id, item.review_number))
    latest_schedule = max(schedules, key=lambda item: (item.review_number, item.id))
    pending_count = sum(0 if schedule.completed else 1 for schedule in schedules)
    completed_count = sum(1 if schedule.completed else 0 for schedule in schedules)
    return {
        "date": date_key,
        "representative_schedule_id": representative_schedule.id,
        "schedule_count": len(schedules),
        "pending_count": pending_count,
        "completed_count": completed_count,
        "completed": pending_count == 0,
        "review_number": latest_schedule.review_number,
        "interval_days": representative_schedule.interval_days,
        "review_type": representative_schedule.review_type,
    }


def palace_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    next_schedule = None
    pending_schedules = [schedule for schedule in (p.review_schedules or []) if not schedule.completed]
    if pending_schedules:
        next_schedule = min(pending_schedules, key=lambda schedule: (schedule.review_number, schedule.id))
    next_review_at = (
        review_schedule_display_datetime(next_schedule, p, session)
        if next_schedule and session
        else None
    )
    has_due_review = bool(next_schedule and session and is_schedule_due(next_schedule, p, session))
    review_stage_total, review_stage_completed, review_stage_progress = (
        palace_stage_progress(session, p)
        if session is not None
        else (0, 0, 0.0)
    )
    stage_labels: list[str] = []
    if session:
        stage_labels = (
            precomputed_stage_labels
            if precomputed_stage_labels is not None
            else get_algorithm_stage_labels(session)
        )
    default_segment = (
        build_palace_default_segment_summary(session, p)
        if session is not None
        else None
    )

    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None

    return {
        "id": p.id, "title": p.title, "description": p.description,
        "archived": p.archived, "mastered": p.mastered,
        "editor_doc": p.editor_doc,
        "needs_practice": bool(getattr(p, "needs_practice", False)),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "next_scheduled_date": next_schedule.scheduled_date.isoformat() if next_schedule and next_schedule.scheduled_date else None,
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": next_schedule.id if has_due_review and next_schedule else None,
        "review_stage_total": review_stage_total,
        "review_stage_completed": review_stage_completed,
        "review_stage_progress": review_stage_progress,
        "stage_labels": stage_labels,
        "review_stages": palace_review_stages_json(session, p, stage_labels) if session else [],
        "pegs": [peg_json(peg) for peg in p.pegs],
        "attachments": [{"id": a.id, "filename": a.filename,
                         "original_name": a.original_name, "file_size": a.file_size}
                        for a in p.attachments],
        "chapters": [{"id": c.id, "name": c.name, "subject_id": c.subject_id,
                      "parent_id": c.parent_id,
                      "is_explicit": c.id in explicit_chapter_ids,
                      "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None}
                      for c in p.chapters],
        "segments": list_palace_segments(session, p, default_segment_payload=default_segment) if session else [],
        "mini_palaces": list_palace_mini_palaces(session, p) if session else [],
        "title_mode": getattr(p, "title_mode", "sync") or "sync",
        "manual_title": getattr(p, "manual_title", "") or "",
        "resolved_title": resolve_palace_title(p),
        "grouping_mode": getattr(p, "grouping_mode", "auto") or "auto",
        "manual_group_chapter_id": getattr(p, "manual_group_chapter_id", None),
        "binding_status": resolve_palace_binding_status(p),
        "primary_chapter_id": getattr(p, "primary_chapter_id", None),
        "primary_chapter": {
            "id": primary_chapter.id,
            "name": primary_chapter.name,
            "subject_id": primary_chapter.subject_id,
            "parent_id": primary_chapter.parent_id,
        } if primary_chapter else None,
        "resolved_subject": {
            "id": resolved_subject.id,
            "name": resolved_subject.name,
            "color": getattr(resolved_subject, "color", "#6366f1"),
        } if resolved_subject else None,
        "resolved_parent_chapter": {
            "id": parent_chapter.id,
            "name": parent_chapter.name,
            "subject_id": parent_chapter.subject_id,
            "parent_id": parent_chapter.parent_id,
        } if parent_chapter else None,
        "group_id": getattr(p, "group_id", None),
        "group_sort_order": getattr(p, "group_sort_order", 0),
    }


def palace_summary_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    next_schedule = None
    pending_schedules = [schedule for schedule in (p.review_schedules or []) if not schedule.completed]
    if pending_schedules:
        next_schedule = min(pending_schedules, key=lambda schedule: (schedule.review_number, schedule.id))
    next_review_at = (
        review_schedule_display_datetime(next_schedule, p, session)
        if next_schedule and session
        else None
    )
    has_due_review = bool(next_schedule and session and is_schedule_due(next_schedule, p, session))
    review_stage_total, review_stage_completed, review_stage_progress = (
        palace_stage_progress(session, p)
        if session is not None
        else (0, 0, 0.0)
    )
    stage_labels: list[str] = []
    if session:
        stage_labels = (
            precomputed_stage_labels
            if precomputed_stage_labels is not None
            else get_algorithm_stage_labels(session)
        )

    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
    chapters = list(getattr(p, "chapters", []) or [])

    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "archived": p.archived,
        "mastered": p.mastered,
        "needs_practice": bool(getattr(p, "needs_practice", False)),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "next_scheduled_date": next_schedule.scheduled_date.isoformat() if next_schedule and next_schedule.scheduled_date else None,
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": next_schedule.id if has_due_review and next_schedule else None,
        "review_stage_total": review_stage_total,
        "review_stage_completed": review_stage_completed,
        "review_stage_progress": review_stage_progress,
        "stage_labels": stage_labels,
        "title_mode": getattr(p, "title_mode", "sync") or "sync",
        "manual_title": getattr(p, "manual_title", "") or "",
        "resolved_title": resolve_palace_title(p),
        "grouping_mode": getattr(p, "grouping_mode", "auto") or "auto",
        "manual_group_chapter_id": getattr(p, "manual_group_chapter_id", None),
        "binding_status": resolve_palace_binding_status(p),
        "primary_chapter_id": getattr(p, "primary_chapter_id", None),
        "primary_chapter": {
            "id": primary_chapter.id,
            "name": primary_chapter.name,
            "subject_id": primary_chapter.subject_id,
            "parent_id": primary_chapter.parent_id,
            "is_explicit": primary_chapter.id in explicit_chapter_ids,
        } if primary_chapter else None,
        "resolved_subject": {
            "id": resolved_subject.id,
            "name": resolved_subject.name,
            "color": getattr(resolved_subject, "color", "#6366f1"),
        } if resolved_subject else None,
        "resolved_parent_chapter": {
            "id": parent_chapter.id,
            "name": parent_chapter.name,
            "subject_id": parent_chapter.subject_id,
            "parent_id": parent_chapter.parent_id,
        } if parent_chapter else None,
        "group_id": getattr(p, "group_id", None),
        "group_sort_order": getattr(p, "group_sort_order", 0),
        "chapter_count": len(chapters),
        "segment_count": len(getattr(p, "segments", []) or []),
    }


def palace_card_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    """Serialize the palace catalog card without large editor/peg payloads."""
    payload = palace_summary_json(
        p,
        session,
        precomputed_explicit_chapter_ids=precomputed_explicit_chapter_ids,
        precomputed_stage_labels=precomputed_stage_labels,
    )
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    raw_stage_labels = payload.get("stage_labels")
    stage_labels: list[str] = (
        [str(item) for item in raw_stage_labels] if isinstance(raw_stage_labels, list) else []
    )
    default_segment = (
        build_palace_default_segment_summary(session, p)
        if session is not None
        else None
    )
    payload.update(
        {
            "review_stages": palace_review_stages_json(session, p, stage_labels) if session else [],
            "chapters": [
                {
                    "id": c.id,
                    "name": c.name,
                    "subject_id": c.subject_id,
                    "parent_id": c.parent_id,
                    "is_explicit": c.id in explicit_chapter_ids,
                    "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None,
                }
                for c in (getattr(p, "chapters", []) or [])
            ],
            "segments": list_palace_segments(session, p, default_segment_payload=default_segment) if session else [],
            "mini_palaces": list_palace_mini_palaces(session, p) if session else [],
        }
    )
    return payload


def palace_editor_meta_json(p, session: Session | None = None) -> dict:
    """Serialize only the palace metadata required by editor/view/review shells.

    Keep this payload intentionally lighter than ``palace_json`` by excluding
    heavy nested structures such as ``pegs``, ``segments`` and ``mini_palaces``.
    """
    payload = palace_summary_json(p, session)
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = get_palace_explicit_chapter_ids(session, p)
    payload.update(
        {
            "editor_doc": p.editor_doc,
            "attachments": [
                {
                    "id": a.id,
                    "filename": a.filename,
                    "original_name": a.original_name,
                    "file_size": a.file_size,
                }
                for a in (getattr(p, "attachments", []) or [])
            ],
            "chapters": [
                {
                    "id": c.id,
                    "name": c.name,
                    "subject_id": c.subject_id,
                    "parent_id": c.parent_id,
                    "is_explicit": c.id in explicit_chapter_ids,
                    "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None,
                }
                for c in (getattr(p, "chapters", []) or [])
            ],
        }
    )
    return payload
