"""Palace serialization (presentation-independent).

``palace_json`` (the session-aware full serializer), ``peg_json`` live here so that
both the palaces and the reviews presentation layers can serialize palaces via the
*application* layer instead of reaching across presentation modules.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from memory_anki.modules.content.application.segment_projection import (
    build_unassigned_segment_summary,
    list_palace_segments,
)
from memory_anki.modules.content.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
    resolve_palace_binding_status,
    resolve_palace_subject,
    resolve_palace_title,
)
from memory_anki.modules.memory.api import (
    get_palace_review_summary,
    project_palace_review_summaries,
)


def _loaded_collection(obj: Any, name: str) -> list[Any]:
    """Return a relationship collection only if already eagerly loaded (avoid list N+1)."""
    try:
        state = sa_inspect(obj)
    except Exception:
        return list(getattr(obj, name, None) or [])
    if name in state.unloaded:
        return []
    return list(getattr(obj, name, None) or [])


def batch_palace_due_rollups(session: Session, palaces: list[Any]) -> dict[int, dict[str, Any]]:
    """Precompute due rollups for a palace list in one batch (catalog/list paths)."""
    if not palaces:
        return {}
    return project_palace_review_summaries(session, list(palaces))

_EMPTY_REVIEW: dict[str, Any] = {
    "mark_required": True,
    "permanent_mark_count": 0,
    "unit_count": 0,
    "due_unit_count": 0,
    "next_review_at": None,
    "has_due_review": False,
    "next_review_date": None,
    "review_status": "marking_required",
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


def _review_fields(review_projection: dict[str, Any]) -> dict[str, Any]:
    return {
        "review_status": review_projection.get("review_status") or "marking_required",
        "review_unit_count": int(review_projection.get("unit_count") or 0),
        "due_review_unit_count": int(review_projection.get("due_unit_count") or 0),
        "permanent_mark_count": int(review_projection.get("permanent_mark_count") or 0),
        "next_review_date": review_projection.get("next_review_date"),
        "next_review_at": review_projection.get("next_review_at"),
        "has_due_review": bool(review_projection.get("has_due_review")),
    }


def palace_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_memory_projection: dict[str, Any] | None = None,
    include_heavy_collections: bool = True,
) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    if precomputed_memory_projection is not None:
        memory_projection = precomputed_memory_projection
    elif session is not None:
        memory_projection = get_palace_review_summary(session, p.id)
    else:
        memory_projection = dict(_EMPTY_REVIEW)
    unassigned_segment = (
        build_unassigned_segment_summary(p)
        if session is not None and include_heavy_collections
        else None
    )

    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = (
        primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
    )
    pegs = p.pegs if include_heavy_collections else _loaded_collection(p, "pegs")
    attachments = (
        p.attachments if include_heavy_collections else _loaded_collection(p, "attachments")
    )
    chapters = list(getattr(p, "chapters", None) or [])

    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "archived": p.archived,
        "editor_doc": p.editor_doc if include_heavy_collections else "",
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        **_review_fields(memory_projection),
        "pegs": [peg_json(peg) for peg in pegs],
        "attachments": [
            {
                "id": a.id,
                "filename": a.filename,
                "original_name": a.original_name,
                "file_size": a.file_size,
            }
            for a in attachments
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
            for c in chapters
        ],
        "segments": (
            list_palace_segments(session, p, unassigned_segment=unassigned_segment)
            if session is not None and include_heavy_collections
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
            c.id for c in chapters if c.id not in explicit_chapter_ids
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
    precomputed_memory_projection: dict[str, Any] | None = None,
) -> dict:
    """Catalog card payload without editor document bulk."""
    return palace_summary_json(
        p,
        session,
        precomputed_explicit_chapter_ids=precomputed_explicit_chapter_ids,
        precomputed_memory_projection=precomputed_memory_projection,
    )


def palace_summary_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
    precomputed_memory_projection: dict[str, Any] | None = None,
) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = (
            precomputed_explicit_chapter_ids
            if precomputed_explicit_chapter_ids is not None
            else get_palace_explicit_chapter_ids(session, p)
        )
    if precomputed_memory_projection is not None:
        memory_projection = precomputed_memory_projection
    elif session is not None:
        memory_projection = get_palace_review_summary(session, p.id)
    else:
        memory_projection = dict(_EMPTY_REVIEW)
    primary_chapter = getattr(p, "primary_chapter", None)
    resolved_subject = resolve_palace_subject(p)
    parent_chapter = (
        primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
    )
    chapters = list(getattr(p, "chapters", []) or [])
    segments = list(getattr(p, "segments", []) or [])
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "archived": p.archived,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        **_review_fields(memory_projection),
        "chapter_count": len(chapters),
        "segment_count": len(segments),
        "chapters": [
            {
                "id": c.id,
                "name": c.name,
                "subject_id": c.subject_id,
                "parent_id": c.parent_id,
                "is_explicit": c.id in explicit_chapter_ids,
            }
            for c in chapters
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

    ``subjects`` must still be present: the editor knowledge workspace binds and
    reloads subject ownership from this meta payload. Omitting it makes the
    frontend briefly apply a successful binding response and then wipe the
    subject list on editor reload.
    """
    payload = palace_summary_json(p, session)
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        explicit_chapter_ids = get_palace_explicit_chapter_ids(session, p)
    subjects = list(getattr(p, "subjects", []) or [])
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
            "subjects": [
                {
                    "id": subject.id,
                    "name": subject.name,
                    "color": subject.color,
                    "sort_order": subject.sort_order,
                }
                for subject in sorted(
                    subjects,
                    key=lambda item: (item.sort_order or 0, item.name or "", item.id),
                )
            ],
            "inherited_chapter_ids": sorted(
                c.id for c in (getattr(p, "chapters", []) or []) if c.id not in explicit_chapter_ids
            ),
        }
    )
    return payload
