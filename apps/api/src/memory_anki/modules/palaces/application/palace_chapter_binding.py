from __future__ import annotations

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceGroup
from memory_anki.modules.mindmap.application.editor_state_service import (
    sync_palace_editor_root,
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


def get_explicit_chapter_ids_by_palace(
    session: Session,
    palace_ids: list[int],
) -> dict[int, set[int]]:
    if not palace_ids:
        return {}
    rows = session.execute(
        text(
            """
            SELECT palace_id, chapter_id
            FROM chapter_palaces
            WHERE palace_id IN :palace_ids
              AND COALESCE(is_explicit, 1) = 1
            """
        ).bindparams(bindparam("palace_ids", expanding=True)),
        {"palace_ids": list(palace_ids)},
    ).fetchall()
    result: dict[int, set[int]] = {int(palace_id): set() for palace_id in palace_ids}
    for palace_id, chapter_id in rows:
        if chapter_id is not None:
            result.setdefault(int(palace_id), set()).add(int(chapter_id))
    return result


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
        current: Chapter | None = chapter
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


def set_primary_chapter(session: Session, palace: Palace, chapter_id: int | None) -> None:
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
        target_primary = infer_primary_chapter(explicit_chapters or chapters)

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
        changed
        or not (palace.title or "").strip()
        or palace.title == getattr(chapters_by_id.get(palace.primary_chapter_id), "name", "")
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


def _chapter_outline_path(chapter: Chapter | None) -> tuple[tuple[int, int], ...]:
    path: list[tuple[int, int]] = []
    current = chapter
    while current is not None:
        path.append((current.sort_order or 0, current.id or 0))
        current = current.parent
    return tuple(reversed(path))


def auto_assign_group(session: Session, palace: Palace, chapter: Chapter) -> None:
    if (palace.grouping_mode or "auto") != "auto":
        return
    parent_chapter = chapter.parent
    if not parent_chapter:
        palace.group_id = None
        return
    group = session.query(PalaceGroup).filter_by(source_chapter_id=parent_chapter.id).first()
    if not group:
        max_sort = session.query(PalaceGroup).order_by(PalaceGroup.sort_order.desc()).first()
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


__all__ = [
    "_chapter_depth",
    "_chapter_outline_path",
    "auto_assign_group",
    "ensure_inferred_primary_chapter",
    "get_explicit_chapter_ids_by_palace",
    "get_palace_explicit_chapter_ids",
    "infer_primary_chapter",
    "reconcile_palace_chapter_binding",
    "set_palace_chapter_links",
    "set_primary_chapter",
    "sync_group_name_from_chapter",
    "sync_palace_titles_from_chapter",
]
