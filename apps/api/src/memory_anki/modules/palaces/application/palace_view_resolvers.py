from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceGroup
from memory_anki.modules.palaces.application.palace_chapter_binding import _chapter_outline_path
from memory_anki.modules.palaces.application.palace_review_rollups import (
    count_palace_review_units,
)


def resolve_palace_binding_status(palace: Palace) -> str:
    chapter = getattr(palace, "primary_chapter", None)
    if palace.primary_chapter_id is None:
        return "unbound"
    if chapter is None:
        return "missing"
    return "ok"


def resolve_palace_title(palace: Palace) -> str:
    title_mode = str(getattr(palace, "title_mode", "sync") or "sync")
    manual_title = str(getattr(palace, "manual_title", "") or "").strip()
    chapter = getattr(palace, "primary_chapter", None)
    if title_mode == "manual" and manual_title:
        return manual_title
    if chapter is not None and chapter.name:
        return chapter.name
    return manual_title or palace.title or "未命名宫殿"


def resolve_palace_group_source_chapter(session: Session, palace: Palace) -> Chapter | None:
    grouping_mode = str(getattr(palace, "grouping_mode", "auto") or "auto")
    if grouping_mode == "manual":
        manual_group_chapter_id = getattr(palace, "manual_group_chapter_id", None)
        if manual_group_chapter_id:
            return session.query(Chapter).filter_by(id=manual_group_chapter_id).first()
        return None

    chapter = getattr(palace, "primary_chapter", None)
    if chapter is None:
        return None
    return chapter.parent or chapter


def resolve_palace_subject(palace: Palace) -> Any | None:
    chapter = getattr(palace, "primary_chapter", None)
    if chapter and getattr(chapter, "subject", None):
        return chapter.subject
    chapters = list(getattr(palace, "chapters", []) or [])
    for linked_chapter in chapters:
        if getattr(linked_chapter, "subject", None):
            return linked_chapter.subject
    return None


def _subject_sort_key(subject: Any | None) -> tuple[int, int, str]:
    if subject is None:
        return (1, 0, "未分类学科")
    return (0, subject.sort_order or 0, subject.name or "")


def _palace_outline_sort_key(palace_data: dict[str, Any]) -> tuple[Any, ...]:
    primary = palace_data.get("_primary_chapter")
    if primary is not None:
        return (_chapter_outline_path(primary), palace_data.get("id", 0))
    return ((999999, palace_data.get("id", 0)), palace_data.get("id", 0))


def chapter_summary(chapter: Chapter | None) -> dict[str, Any] | None:
    if chapter is None:
        return None
    return {
        "id": chapter.id,
        "name": chapter.name,
        "subject_id": chapter.subject_id,
        "parent_id": chapter.parent_id,
    }


def subject_summary(subject: Any | None) -> dict[str, Any] | None:
    if subject is None:
        return None
    return {
        "id": subject.id,
        "name": subject.name,
        "color": getattr(subject, "color", "#6366f1"),
    }


def build_chapter_grouped_palace_list(
    session: Session,
    palaces: list[Palace],
    palace_json_fn: Any,
) -> dict[str, Any]:
    subject_buckets: dict[int, dict[str, Any]] = {}
    for palace in palaces:
        palace_data = palace_json_fn(palace, session)
        palace_data["_primary_chapter"] = getattr(palace, "primary_chapter", None)
        subject = resolve_palace_subject(palace)
        subject_key = subject.id if subject is not None else 0
        subject_bucket = subject_buckets.setdefault(
            subject_key,
            {
                "_subject": subject,
                "subject": subject_summary(subject),
                "chapter_groups": {},
                "ungrouped_palaces": [],
            },
        )
        group_chapter = resolve_palace_group_source_chapter(session, palace)
        if group_chapter is None:
            subject_bucket["ungrouped_palaces"].append(palace_data)
            continue
        chapter_groups = subject_bucket["chapter_groups"]
        group_bucket = chapter_groups.setdefault(
            group_chapter.id,
            {
                "_source_chapter": group_chapter,
                "source_chapter": chapter_summary(group_chapter),
                "palaces": [],
            },
        )
        group_bucket["palaces"].append(palace_data)

    subjects = []
    for bucket in subject_buckets.values():
        chapter_groups = list(bucket["chapter_groups"].values())
        chapter_groups.sort(key=lambda item: _chapter_outline_path(item.get("_source_chapter")))
        for group in chapter_groups:
            group["palaces"].sort(key=_palace_outline_sort_key)
            group.pop("_source_chapter", None)
            for palace in group["palaces"]:
                palace.pop("_primary_chapter", None)
        ungrouped_palaces = sorted(bucket["ungrouped_palaces"], key=_palace_outline_sort_key)
        for palace in ungrouped_palaces:
            palace.pop("_primary_chapter", None)
        subjects.append(
            {
                "subject": bucket["subject"],
                "chapter_groups": chapter_groups,
                "ungrouped_palaces": ungrouped_palaces,
            }
        )

    subjects.sort(
        key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"])
    )
    return {"subjects": subjects}


def build_grouped_palace_list(
    session: Session,
    palaces: list[Palace],
    palace_json_fn: Any,
) -> dict[str, Any]:
    groups = session.query(PalaceGroup).order_by(PalaceGroup.sort_order, PalaceGroup.id).all()
    group_map: dict[int, dict[str, Any]] = {}
    for group in groups:
        group_map[group.id] = {
            "id": group.id,
            "name": group.name,
            "color": group.color,
            "sort_order": group.sort_order,
            "source_chapter_id": group.source_chapter_id,
            "palaces": [],
        }
    ungrouped: list[dict[str, Any]] = []
    for palace in palaces:
        palace_data = palace_json_fn(palace, session)
        if palace.group_id and palace.group_id in group_map:
            group_map[palace.group_id]["palaces"].append(palace_data)
        else:
            ungrouped.append(palace_data)

    for group_data in group_map.values():
        group_data["palaces"].sort(key=lambda palace: palace.get("group_sort_order", 0))

    return {
        "groups": list(group_map.values()),
        "ungrouped": ungrouped,
    }


def build_subject_shelf_summary(session: Session, palaces: list[Palace]) -> dict[str, Any]:
    subject_buckets: dict[int, dict[str, Any]] = {}
    now = datetime.now()

    for palace in palaces:
        subject = resolve_palace_subject(palace)
        subject_key = subject.id if subject is not None else 0
        bucket = subject_buckets.setdefault(
            subject_key,
            {
                "_subject": subject,
                "subject": subject_summary(subject),
                "palace_ids": set(),
                "chapter_ids": set(),
                "has_due_review": False,
                "has_due_later_today": False,
                "due_now_count": 0,
                "due_later_today_count": 0,
                "needs_practice_count": 0,
            },
        )
        bucket["palace_ids"].add(palace.id)
        for chapter in list(getattr(palace, "chapters", []) or []):
            bucket["chapter_ids"].add(chapter.id)
        unit_counts = count_palace_review_units(session, palace, now=now)
        if unit_counts["due_now_count"] > 0:
            bucket["has_due_review"] = True
            bucket["due_now_count"] += unit_counts["due_now_count"]
        if unit_counts["due_later_today_count"] > 0:
            bucket["has_due_later_today"] = True
            bucket["due_later_today_count"] += unit_counts["due_later_today_count"]
        bucket["needs_practice_count"] += unit_counts["needs_practice_count"]

    items: list[dict[str, Any]] = []
    for bucket in subject_buckets.values():
        has_due_review = bool(bucket["has_due_review"])
        has_due_later_today = bool(bucket["has_due_later_today"]) and not has_due_review
        items.append(
            {
                "subject": bucket["subject"],
                "palace_count": len(bucket["palace_ids"]),
                "chapter_count": len(bucket["chapter_ids"]),
                "review_status": (
                    "due_now" if has_due_review else "due_later_today" if has_due_later_today else "idle"
                ),
                "has_due_review": has_due_review,
                "has_due_later_today": has_due_later_today,
                "due_now_count": bucket["due_now_count"],
                "due_later_today_count": bucket["due_later_today_count"],
                "needs_practice_count": bucket["needs_practice_count"],
            }
        )

    items.sort(
        key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"])
    )
    return {"items": items}


def build_today_new_palace_outline(session: Session, palaces: list[Palace]) -> list[dict[str, Any]]:
    chapter_cache: dict[int, Chapter | None] = {}

    def get_cached_chapter(chapter_id: int | None) -> Chapter | None:
        if chapter_id is None:
            return None
        if chapter_id not in chapter_cache:
            chapter_cache[chapter_id] = session.query(Chapter).filter_by(id=chapter_id).first()
        return chapter_cache[chapter_id]

    subject_buckets: dict[int, dict[str, Any]] = {}
    for palace in palaces:
        subject = resolve_palace_subject(palace)
        subject_key = subject.id if subject is not None else 0
        subject_bucket = subject_buckets.setdefault(
            subject_key,
            {
                "_subject": subject,
                "subject": subject_summary(subject),
                "chapter_groups": {},
                "ungrouped_palaces": [],
            },
        )

        primary_chapter = getattr(palace, "primary_chapter", None)
        parent_chapter = primary_chapter.parent if primary_chapter and getattr(primary_chapter, "parent", None) else None
        palace_payload = {
            "id": palace.id,
            "title": resolve_palace_title(palace),
            "created_at": palace.created_at.isoformat() if palace.created_at else None,
            "primary_chapter": chapter_summary(primary_chapter),
            "resolved_parent_chapter": chapter_summary(parent_chapter),
        }

        if primary_chapter is None:
            subject_bucket["ungrouped_palaces"].append(palace_payload)
            continue

        group_chapter = parent_chapter or primary_chapter
        chapter_groups = subject_bucket["chapter_groups"]
        group_bucket = chapter_groups.setdefault(
            group_chapter.id,
            {
                "_source_chapter": group_chapter,
                "source_chapter": chapter_summary(group_chapter),
                "palaces": [],
            },
        )
        group_bucket["palaces"].append(palace_payload)

    subjects: list[dict[str, Any]] = []
    for bucket in subject_buckets.values():
        chapter_groups = list(bucket["chapter_groups"].values())
        chapter_groups.sort(key=lambda item: _chapter_outline_path(item.get("_source_chapter")))
        for group in chapter_groups:
            group["palaces"].sort(
                key=lambda palace: (
                    _chapter_outline_path(get_cached_chapter((palace.get("primary_chapter") or {}).get("id"))),
                    str(palace.get("title") or ""),
                    int(palace.get("id") or 0),
                )
            )
            group.pop("_source_chapter", None)
        ungrouped_palaces = sorted(
            bucket["ungrouped_palaces"],
            key=lambda palace: (str(palace.get("title") or ""), int(palace.get("id") or 0)),
        )
        subjects.append(
            {
                "subject": bucket["subject"],
                "chapter_groups": chapter_groups,
                "ungrouped_palaces": ungrouped_palaces,
            }
        )

    subjects.sort(
        key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"])
    )
    return subjects


def palace_group_json(group: PalaceGroup) -> dict[str, Any]:
    return {
        "id": group.id,
        "name": group.name,
        "color": group.color,
        "sort_order": group.sort_order,
        "source_chapter_id": group.source_chapter_id,
    }


__all__ = [
    "_palace_outline_sort_key",
    "_subject_sort_key",
    "build_chapter_grouped_palace_list",
    "build_grouped_palace_list",
    "build_subject_shelf_summary",
    "build_today_new_palace_outline",
    "chapter_summary",
    "palace_group_json",
    "resolve_palace_binding_status",
    "resolve_palace_group_source_chapter",
    "resolve_palace_subject",
    "resolve_palace_title",
    "subject_summary",
]
