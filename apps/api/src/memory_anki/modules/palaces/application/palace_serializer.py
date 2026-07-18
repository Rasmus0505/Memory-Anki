"""Palace serialization (presentation-independent).

``palace_json`` (the session-aware full serializer), ``peg_json`` live here so that
both the palaces and the reviews presentation layers can serialize palaces via the
*application* layer instead of reaching across presentation modules.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.palaces.application.segment_review_service import (
    build_palace_default_segment_summary,
    list_palace_segments,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
    resolve_palace_binding_status,
    resolve_palace_subject,
    resolve_palace_title,
)
from memory_anki.modules.reviews.api import get_palace_memory_projection

_EMPTY_MEMORY: dict[str, Any] = {
    "node_count": 0,
    "mastery_progress": 0.0,
    "mastery_percent": 0,
    "memory_health": 0.0,
    "memory_health_percent": 0,
    "mastered_node_count": 0,
    "mastery_horizon_days": 60,
    "due_node_count": 0,
    "overdue_node_count": 0,
    "next_review_at": None,
    "mastered": False,
    "severe_weak_node_count": 0,
    "has_due_review": False,
    "review_entry_mode": "none",
    "review_entry_label": None,
    "primary_branch_uid": None,
    "primary_branch_title": None,
    "due_branch_count": 0,
    "due_node_uids": [],
    "review_branch_summaries": [],
}


def peg_json(peg) -> dict:
    return {
        "id": peg.id,
        "name": peg.name,
        "content": peg.content,
        "sort_order": peg.sort_order,
        "parent_id": peg.parent_id,
        "children": [peg_json(c) for c in (peg.children or [])],
    }


def _memory_fields(memory_projection: dict) -> dict:
    next_review = memory_projection.get("next_review_at")
    return {
        "next_scheduled_date": next_review[:10] if isinstance(next_review, str) and next_review else None,
        "next_review_at": next_review,
        "has_due_review": bool(memory_projection.get("has_due_review")),
        "current_review_schedule_id": None,
        "review_stage_total": 0,
        "review_stage_completed": 0,
        "review_stage_progress": 0.0,
        "stage_labels": [],
        "review_stages": [],
        "memory_node_count": memory_projection["node_count"],
        "mastery_progress": memory_projection["mastery_progress"],
        "mastery_percent": memory_projection["mastery_percent"],
        "memory_health": memory_projection["memory_health"],
        "memory_health_percent": memory_projection["memory_health_percent"],
        "mastered_node_count": memory_projection["mastered_node_count"],
        "mastery_horizon_days": memory_projection["mastery_horizon_days"],
        "due_node_count": memory_projection["due_node_count"],
        "overdue_node_count": memory_projection["overdue_node_count"],
        "memory_next_review_at": memory_projection["next_review_at"],
        "memory_mastered": memory_projection["mastered"],
        "severe_weak_node_count": memory_projection["severe_weak_node_count"],
        "review_entry_mode": memory_projection.get("review_entry_mode") or "none",
        "review_entry_label": memory_projection.get("review_entry_label"),
        "primary_branch_uid": memory_projection.get("primary_branch_uid"),
        "primary_branch_title": memory_projection.get("primary_branch_title"),
        "due_branch_count": memory_projection.get("due_branch_count") or 0,
        "review_branch_summaries": list(
            memory_projection.get("review_branch_summaries") or []
        ),
    }


def palace_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    del precomputed_stage_labels  # legacy stage labels removed
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    memory_projection = (
        get_palace_memory_projection(session, p.id) if session is not None else dict(_EMPTY_MEMORY)
    )
    default_segment = (
        build_palace_default_segment_summary(session, p) if session is not None else None
    )

    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = (
        primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
    )

    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "archived": p.archived,
        "mastered": bool(memory_projection.get("mastered")),
        "editor_doc": p.editor_doc,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        **_memory_fields(memory_projection),
        "pegs": [peg_json(peg) for peg in p.pegs],
        "attachments": [
            {
                "id": a.id,
                "filename": a.filename,
                "original_name": a.original_name,
                "file_size": a.file_size,
            }
            for a in p.attachments
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
            for c in p.chapters
        ],
        "segments": (
            list_palace_segments(session, p, default_segment_payload=default_segment)
            if session
            else []
        ),
        "subjects": [
            {
                "id": subject.id,
                "name": subject.name,
                "color": subject.color,
                "sort_order": subject.sort_order,
            }
            for subject in (getattr(p, "subjects", []) or [])
        ],
        "explicit_chapter_ids": sorted(explicit_chapter_ids),
        "inherited_chapter_ids": sorted(
            c.id for c in (getattr(p, "chapters", []) or []) if c.id not in explicit_chapter_ids
        ),
        "binding_revision": int(getattr(p, "binding_revision", 0) or 0),
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
        }
        if primary_chapter
        else None,
        "resolved_subject": {
            "id": resolved_subject.id,
            "name": resolved_subject.name,
            "color": getattr(resolved_subject, "color", "#6366f1"),
        }
        if resolved_subject
        else None,
        "resolved_parent_chapter": {
            "id": parent_chapter.id,
            "name": parent_chapter.name,
            "subject_id": parent_chapter.subject_id,
            "parent_id": parent_chapter.parent_id,
        }
        if parent_chapter
        else None,
        "group_id": getattr(p, "group_id", None),
        "group_sort_order": getattr(p, "group_sort_order", 0),
    }


def palace_card_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    """Catalog card payload — same FSRS fields as summary, without editor_doc bulk."""
    return palace_summary_json(
        p,
        session,
        precomputed_explicit_chapter_ids=precomputed_explicit_chapter_ids,
        precomputed_stage_labels=precomputed_stage_labels,
    )


def palace_summary_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_stage_labels: list[str] | None = None,
) -> dict:
    del precomputed_stage_labels
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    memory_projection = (
        get_palace_memory_projection(session, p.id) if session is not None else dict(_EMPTY_MEMORY)
    )
    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = (
        primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
    )
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "archived": p.archived,
        "mastered": bool(memory_projection.get("mastered")),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        **_memory_fields(memory_projection),
        "chapters": [
            {
                "id": c.id,
                "name": c.name,
                "subject_id": c.subject_id,
                "parent_id": c.parent_id,
                "is_explicit": c.id in explicit_chapter_ids,
            }
            for c in (getattr(p, "chapters", []) or [])
        ],
        "explicit_chapter_ids": sorted(explicit_chapter_ids),
        "binding_revision": int(getattr(p, "binding_revision", 0) or 0),
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
        }
        if primary_chapter
        else None,
        "resolved_subject": {
            "id": resolved_subject.id,
            "name": resolved_subject.name,
            "color": getattr(resolved_subject, "color", "#6366f1"),
        }
        if resolved_subject
        else None,
        "resolved_parent_chapter": {
            "id": parent_chapter.id,
            "name": parent_chapter.name,
            "subject_id": parent_chapter.subject_id,
            "parent_id": parent_chapter.parent_id,
        }
        if parent_chapter
        else None,
        "group_id": getattr(p, "group_id", None),
        "group_sort_order": getattr(p, "group_sort_order", 0),
    }


def palace_editor_meta_json(p, session: Session | None = None) -> dict:
    """Serialize only the palace metadata required by editor/view/review shells.

    Keep this payload intentionally lighter than ``palace_json`` by excluding
    heavy nested structures such as ``pegs`` and ``segments``.
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
