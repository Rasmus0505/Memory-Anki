"""Palace-Chapter title sync and group management."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceGroup,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
    engine,
)
from memory_anki.modules.palaces.application.mini_palace_service import (
    ensure_mini_palace_schedule_model,
    get_mini_palace_schedule_display_datetime,
    is_mini_palace_schedule_due,
)
from memory_anki.modules.mindmap.application.editor_state_service import (
    sync_palace_editor_root,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    get_segment_schedule_display_datetime,
    is_segment_schedule_due,
)
from memory_anki.modules.reviews.application.schedule_service import (
    is_schedule_due,
    schedule_display_datetime,
)


def ensure_palace_group_schema() -> None:
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "palace_groups" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(200) NOT NULL DEFAULT '',
                    color VARCHAR(24) NOT NULL DEFAULT '#6366f1',
                    sort_order INTEGER DEFAULT 0,
                    source_chapter_id INTEGER NULL
                )
                """
            )

        palace_columns = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info(palaces)").fetchall()
        }
        for column_name, column_type in (
            ("primary_chapter_id", "INTEGER"),
            ("group_id", "INTEGER"),
            ("group_sort_order", "INTEGER DEFAULT 0"),
            ("title_mode", "VARCHAR(20) DEFAULT 'sync'"),
            ("manual_title", "VARCHAR(200) DEFAULT ''"),
            ("grouping_mode", "VARCHAR(20) DEFAULT 'auto'"),
            ("manual_group_chapter_id", "INTEGER"),
            ("needs_practice", "BOOLEAN NOT NULL DEFAULT 0"),
            ("focus_node_uids_json", "TEXT NOT NULL DEFAULT '[]'"),
        ):
            if column_name not in palace_columns:
                conn.exec_driver_sql(
                    f"ALTER TABLE palaces ADD COLUMN {column_name} {column_type}"
                )

        chapter_palace_columns = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info(chapter_palaces)").fetchall()
        }
        if "is_explicit" not in chapter_palace_columns:
            conn.exec_driver_sql(
                "ALTER TABLE chapter_palaces ADD COLUMN is_explicit BOOLEAN NOT NULL DEFAULT 1"
            )


def get_palace_explicit_chapter_ids(session: Session, palace: Palace) -> set[int]:
    rows = session.execute(
        text(
            """
            SELECT chapter_id
            FROM chapter_palaces
            WHERE palace_id = :palace_id
              AND COALESCE(is_explicit, 1) = 1
            """
        ),
        {"palace_id": palace.id},
    ).fetchall()
    return {int(row[0]) for row in rows if row[0] is not None}


def set_palace_chapter_links(
    session: Session,
    palace: Palace,
    explicit_chapter_ids: list[int],
) -> tuple[list[Chapter], set[int]]:
    explicit_ids = {int(chapter_id) for chapter_id in explicit_chapter_ids if chapter_id is not None}
    explicit_chapters = (
        session.query(Chapter).filter(Chapter.id.in_(explicit_ids)).all() if explicit_ids else []
    )

    expanded_ids: set[int] = set()
    for chapter in explicit_chapters:
        current = chapter
        while current is not None:
            expanded_ids.add(current.id)
            current = current.parent

    palace.chapters = (
        session.query(Chapter).filter(Chapter.id.in_(expanded_ids)).all() if expanded_ids else []
    )
    session.flush()
    session.execute(
        text("DELETE FROM chapter_palaces WHERE palace_id = :palace_id"),
        {"palace_id": palace.id},
    )
    for chapter_id in sorted(expanded_ids):
        session.execute(
            text(
                """
                INSERT INTO chapter_palaces (chapter_id, palace_id, is_explicit)
                VALUES (:chapter_id, :palace_id, :is_explicit)
                """
            ),
            {
                "chapter_id": chapter_id,
                "palace_id": palace.id,
                "is_explicit": 1 if chapter_id in explicit_ids else 0,
            },
        )
    return explicit_chapters, expanded_ids


def sync_palace_titles_from_chapter(session: Session, chapter: Chapter) -> list[Palace]:
    palaces = session.query(Palace).filter_by(primary_chapter_id=chapter.id).all()
    for palace in palaces:
        if (palace.title_mode or "sync") != "sync":
            continue
        if palace.title != chapter.name:
            palace.title = chapter.name
            sync_palace_editor_root(palace)
    return palaces


def sync_group_name_from_chapter(session: Session, chapter: Chapter) -> None:
    groups = session.query(PalaceGroup).filter_by(source_chapter_id=chapter.id).all()
    for group in groups:
        if group.name != chapter.name:
            group.name = chapter.name


def set_primary_chapter(
    session: Session, palace: Palace, chapter_id: int | None
) -> None:
    palace.primary_chapter_id = chapter_id
    palace.primary_chapter = None
    if chapter_id is not None:
        chapter = session.query(Chapter).filter_by(id=chapter_id).first()
        if chapter:
            palace.primary_chapter = chapter
            if (palace.title_mode or "sync") == "sync":
                palace.title = chapter.name
                sync_palace_editor_root(palace)
            auto_assign_group(session, palace, chapter)
    session.flush()


def ensure_inferred_primary_chapter(session: Session, palace: Palace) -> bool:
    chapters = list(getattr(palace, "chapters", []) or [])
    if not chapters:
        if palace.primary_chapter_id is not None and getattr(palace, "primary_chapter", None) is None:
            palace.primary_chapter_id = None
            session.flush()
            return True
        return False

    linked_ids = {chapter.id for chapter in chapters}
    current_primary = getattr(palace, "primary_chapter", None)
    if current_primary is not None and current_primary.id in linked_ids:
        return False

    inferred = infer_primary_chapter(chapters)
    inferred_id = inferred.id if inferred is not None else None
    if palace.primary_chapter_id == inferred_id:
        return False
    set_primary_chapter(session, palace, inferred_id)
    return True


def reconcile_palace_chapter_binding(
    session: Session,
    palace: Palace,
    preferred_primary_chapter_id: int | None = None,
) -> bool:
    changed = False
    chapters = list(getattr(palace, "chapters", []) or [])
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    chapters_by_id = {chapter.id: chapter for chapter in chapters}

    if not chapters:
        if palace.primary_chapter_id is not None:
            palace.primary_chapter_id = None
            changed = True
        if palace.group_id is not None and (palace.grouping_mode or "auto") == "auto":
            palace.group_id = None
            changed = True
        session.flush()
        return changed

    target_primary: Chapter | None = None
    if preferred_primary_chapter_id and preferred_primary_chapter_id in chapters_by_id:
        preferred = chapters_by_id[preferred_primary_chapter_id]
        if preferred.id in explicit_ids:
            target_primary = preferred

    if target_primary is None:
        current_primary = chapters_by_id.get(palace.primary_chapter_id) if palace.primary_chapter_id else None
        if current_primary is not None and current_primary.id in explicit_ids:
            target_primary = current_primary

    if target_primary is None:
        explicit_chapters = [chapter for chapter in chapters if chapter.id in explicit_ids]
        if explicit_chapters:
            target_primary = infer_primary_chapter(explicit_chapters)
        else:
            target_primary = infer_primary_chapter(chapters)

    target_primary_id = target_primary.id if target_primary is not None else None
    if palace.primary_chapter_id != target_primary_id:
        set_primary_chapter(session, palace, target_primary_id)
        changed = True
    elif target_primary is not None and (palace.grouping_mode or "auto") == "auto":
        previous_group_id = palace.group_id
        auto_assign_group(session, palace, target_primary)
        if palace.group_id != previous_group_id:
            changed = True

    if target_primary is None:
        session.flush()
        return changed

    should_sync_title = (palace.title_mode or "sync") == "sync" and (
        changed or not (palace.title or "").strip() or palace.title == getattr(chapters_by_id.get(palace.primary_chapter_id), "name", "")
    )
    if should_sync_title and palace.title != target_primary.name:
        palace.title = target_primary.name
        sync_palace_editor_root(palace)
        changed = True

    if (palace.grouping_mode or "auto") == "auto":
        expected_group_chapter = target_primary.parent
        if expected_group_chapter is None and palace.group_id is not None:
            palace.group_id = None
            changed = True
        elif expected_group_chapter is not None:
            previous_group_id = palace.group_id
            auto_assign_group(session, palace, target_primary)
            if palace.group_id != previous_group_id:
                changed = True

    session.flush()
    return changed


def infer_primary_chapter(chapters: list[Chapter]) -> Chapter | None:
    if not chapters:
        return None
    return min(
        chapters,
        key=lambda chapter: (
            -_chapter_depth(chapter),
            _chapter_outline_path(chapter),
        ),
    )


def _chapter_depth(chapter: Chapter | None) -> int:
    depth = 0
    current = chapter
    while current is not None:
        depth += 1
        current = current.parent
    return depth


def auto_assign_group(
    session: Session, palace: Palace, chapter: Chapter
) -> None:
    if (palace.grouping_mode or "auto") != "auto":
        return
    parent_chapter = chapter.parent
    if not parent_chapter:
        palace.group_id = None
        return
    group = (
        session.query(PalaceGroup)
        .filter_by(source_chapter_id=parent_chapter.id)
        .first()
    )
    if not group:
        max_sort = (
            session.query(PalaceGroup)
            .order_by(PalaceGroup.sort_order.desc())
            .first()
        )
        next_sort = (max_sort.sort_order + 1) if max_sort else 0
        group = PalaceGroup(
            name=parent_chapter.name,
            color=parent_chapter.subject.color if parent_chapter.subject else "#6366f1",
            source_chapter_id=parent_chapter.id,
            sort_order=next_sort,
        )
        session.add(group)
        session.flush()
    palace.group_id = group.id


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


def _chapter_outline_path(chapter: Chapter | None) -> tuple[tuple[int, int], ...]:
    path: list[tuple[int, int]] = []
    current = chapter
    while current is not None:
        path.append((current.sort_order or 0, current.id or 0))
        current = current.parent
    return tuple(reversed(path))


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
        ungrouped_palaces = sorted(
            bucket["ungrouped_palaces"],
            key=_palace_outline_sort_key,
        )
        for palace in ungrouped_palaces:
            palace.pop("_primary_chapter", None)
        subjects.append(
            {
                "subject": bucket["subject"],
                "chapter_groups": chapter_groups,
                "ungrouped_palaces": ungrouped_palaces,
            }
        )

    subjects.sort(key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"]))
    return {"subjects": subjects}


def build_grouped_palace_list(
    session: Session, palaces: list[Palace], palace_json_fn: Any
) -> dict[str, Any]:
    groups = (
        session.query(PalaceGroup)
        .order_by(PalaceGroup.sort_order, PalaceGroup.id)
        .all()
    )
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
    ungrouped: list[dict] = []
    for palace in palaces:
        palace_data = palace_json_fn(palace, session)
        if palace.group_id and palace.group_id in group_map:
            group_map[palace.group_id]["palaces"].append(palace_data)
        else:
            ungrouped.append(palace_data)

    for group_data in group_map.values():
        group_data["palaces"].sort(key=lambda p: p.get("group_sort_order", 0))

    return {
        "groups": list(group_map.values()),
        "ungrouped": ungrouped,
    }


def build_subject_shelf_summary(
    session: Session,
    palaces: list[Palace],
) -> dict[str, Any]:
    subject_buckets: dict[int, dict[str, Any]] = {}
    now = __import__("datetime").datetime.now()

    for palace in palaces:
        reconcile_palace_chapter_binding(session, palace)
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

    items.sort(key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"]))
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
        reconcile_palace_chapter_binding(session, palace)
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

    subjects.sort(key=lambda item: _subject_sort_key(subject_buckets[(item["subject"] or {}).get("id", 0)]["_subject"]))
    return subjects


def palace_group_json(group: PalaceGroup) -> dict[str, Any]:
    return {
        "id": group.id,
        "name": group.name,
        "color": group.color,
        "sort_order": group.sort_order,
        "source_chapter_id": group.source_chapter_id,
    }


def _next_pending_palace_schedule(palace: Palace) -> ReviewSchedule | None:
    pending_schedules = [schedule for schedule in (palace.review_schedules or []) if not schedule.completed]
    if not pending_schedules:
        return None
    return min(pending_schedules, key=lambda schedule: (schedule.review_number, schedule.id))


def _next_pending_segment_schedule(palace: Palace) -> tuple[Any, PalaceSegmentReviewSchedule] | None:
    candidates: list[tuple[Any, PalaceSegmentReviewSchedule]] = []
    for segment in list(getattr(palace, "segments", []) or []):
        next_schedule = next(
            (
                schedule
                for schedule in sorted(
                    getattr(segment, "review_schedules", None) or [],
                    key=lambda schedule: (schedule.review_number, schedule.id),
                )
                if not schedule.completed
            ),
            None,
        )
        if next_schedule is not None:
            candidates.append((segment, next_schedule))
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[1].review_number, item[1].id))


def _review_datetime_is_later_today(dt: Any, now: Any) -> bool:
    if not dt:
        return False
    if dt <= now:
        return False
    return dt.date() == now.date()


def _next_pending_mini_schedule_for_item(mini_palace: Any) -> Any | None:
    pending = sorted(
        [schedule for schedule in (mini_palace.review_schedules or []) if not schedule.completed],
        key=lambda item: (item.review_number, item.id),
    )
    return pending[0] if pending else None


def _next_pending_mini_schedule(
    session: Session,
    palace: Palace,
) -> tuple[Any, Any] | None:
    candidates: list[tuple[Any, Any]] = []
    for mini_palace in list(getattr(palace, "mini_palaces", []) or []):
        ensure_mini_palace_schedule_model(session, mini_palace)
        next_schedule = _next_pending_mini_schedule_for_item(mini_palace)
        if next_schedule is None:
            continue
        candidates.append((mini_palace, next_schedule))
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[1].review_number, item[1].id))


def count_palace_review_units(
    session: Session,
    palace: Palace,
    *,
    now: Any | None = None,
) -> dict[str, int]:
    current = now or __import__("datetime").datetime.now()
    due_now_count = 0
    due_later_today_count = 0
    needs_practice_count = 1 if bool(getattr(palace, "needs_practice", False)) else 0

    if palace_has_due_review(session, palace, now=current, include_mini_palaces=False):
        due_now_count += 1
    elif palace_has_due_later_today(session, palace, now=current, include_mini_palaces=False):
        due_later_today_count += 1

    for mini_palace in list(getattr(palace, "mini_palaces", []) or []):
        ensure_mini_palace_schedule_model(session, mini_palace)
        if bool(getattr(mini_palace, "needs_practice", False)):
            needs_practice_count += 1
        next_schedule = _next_pending_mini_schedule_for_item(mini_palace)
        if next_schedule is None:
            continue
        due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, next_schedule)
        if is_mini_palace_schedule_due(session, mini_palace, next_schedule, now=current):
            due_now_count += 1
        elif _review_datetime_is_later_today(due_at, current):
            due_later_today_count += 1

    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": needs_practice_count,
    }


def palace_has_due_review(
    session: Session,
    palace: Palace,
    *,
    now: Any | None = None,
    include_mini_palaces: bool = True,
) -> bool:
    current = now or __import__("datetime").datetime.now()
    next_schedule = _next_pending_palace_schedule(palace)
    if next_schedule and is_schedule_due(next_schedule, palace, session, now=current):
        return True

    next_segment = _next_pending_segment_schedule(palace)
    if next_segment is not None:
        segment, schedule = next_segment
        if is_segment_schedule_due(session, segment, schedule, now=current):
            return True

    if not include_mini_palaces:
        return False

    next_mini = _next_pending_mini_schedule(session, palace)
    if next_mini is None:
        return False
    mini_palace, schedule = next_mini
    ensure_mini_palace_schedule_model(session, mini_palace)
    return is_mini_palace_schedule_due(session, mini_palace, schedule, now=current)


def palace_has_due_later_today(
    session: Session,
    palace: Palace,
    *,
    now: Any | None = None,
    include_mini_palaces: bool = True,
) -> bool:
    current = now or __import__("datetime").datetime.now()
    next_schedule = _next_pending_palace_schedule(palace)
    due_at = schedule_display_datetime(next_schedule, palace, session) if next_schedule else None
    if _review_datetime_is_later_today(due_at, current):
        return True

    next_segment = _next_pending_segment_schedule(palace)
    if next_segment is not None:
        segment, schedule = next_segment
        due_at = get_segment_schedule_display_datetime(session, segment, schedule)
        if _review_datetime_is_later_today(due_at, current):
            return True

    if not include_mini_palaces:
        return False

    next_mini = _next_pending_mini_schedule(session, palace)
    if next_mini is None:
        return False
    mini_palace, schedule = next_mini
    ensure_mini_palace_schedule_model(session, mini_palace)
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    return _review_datetime_is_later_today(due_at, current)
