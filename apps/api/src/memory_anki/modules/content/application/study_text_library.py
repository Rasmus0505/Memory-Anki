"""One-shot text snapshot of active palace editors.

Audio files and subject attachments are not included. Callers compose quiz
questions onto this payload through the quiz public API.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.modules.content.application.editor_state_service import (
    get_palace_editor_state,
)
from memory_anki.modules.content.application.palace_chapter_binding import (
    get_explicit_chapter_ids_by_palace,
)
from memory_anki.modules.content.application.palace_serializer import (
    batch_palace_due_rollups,
    palace_editor_meta_json,
)
from memory_anki.modules.content.infrastructure.repositories.palace_repository import (
    PalaceRepository,
)
from memory_anki.modules.quiz.api import sort_questions_for_bank_display


def build_study_text_editors(session: Session) -> tuple[list[dict[str, Any]], dict[int, list[int]]]:
    palaces = PalaceRepository(session).list_study_text_palaces()
    palace_ids = [int(palace.id) for palace in palaces if palace.id is not None]
    explicit_map = get_explicit_chapter_ids_by_palace(session, palace_ids)
    memory_map = batch_palace_due_rollups(session, palaces)
    chapters_by_id = _chapters_by_id(session, explicit_map)
    editors: list[dict[str, Any]] = []
    minimal_by_palace: dict[int, list[int]] = {}
    for palace in palaces:
        if palace.id is None:
            continue
        palace_id = int(palace.id)
        explicit_ids = explicit_map.get(palace_id, set())
        minimal_by_palace[palace_id] = _minimal_explicit_ids(explicit_ids, chapters_by_id)
        editors.append(
            {
                "palace": palace_editor_meta_json(
                    palace,
                    session,
                    precomputed_explicit_chapter_ids=explicit_ids,
                    precomputed_memory_projection=memory_map.get(palace_id),
                ),
                **get_palace_editor_state(palace),
            }
        )
    return editors, minimal_by_palace


def group_questions_by_palace(
    questions: list[dict[str, Any]],
    minimal_by_palace: dict[int, list[int]],
) -> dict[str, list[dict[str, Any]]]:
    owned: dict[int, list[dict[str, Any]]] = {}
    by_chapter: dict[int, list[dict[str, Any]]] = {}
    for question in questions:
        palace_id = _int_or_none(question.get("palace_id"))
        if palace_id is not None:
            owned.setdefault(palace_id, []).append(question)
        for key in ("source_chapter_id", "classified_chapter_id"):
            chapter_id = _int_or_none(question.get(key))
            if chapter_id is not None:
                by_chapter.setdefault(chapter_id, []).append(question)

    grouped: dict[str, list[dict[str, Any]]] = {}
    palace_ids = set(minimal_by_palace) | set(owned)
    for palace_id in palace_ids:
        seen: set[int] = set()
        items: list[dict[str, Any]] = []
        for question in owned.get(palace_id, []):
            _append_unique(items, seen, question)
        for chapter_id in minimal_by_palace.get(palace_id, []):
            for question in by_chapter.get(chapter_id, []):
                _append_unique(items, seen, question)
        grouped[str(palace_id)] = sort_questions_for_bank_display(items)
    return grouped


def group_bindings_by_palace(
    bindings: list[dict[str, Any]],
    editors: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    titles: dict[int, str] = {}
    labels_by_palace: dict[int, dict[str, str]] = {}
    for editor in editors:
        palace = editor.get("palace")
        if not isinstance(palace, dict):
            continue
        palace_id = _int_or_none(palace.get("id"))
        if palace_id is None:
            continue
        titles[palace_id] = str(palace.get("title") or "")
        labels_by_palace[palace_id] = _node_labels(editor.get("editor_doc"))

    grouped: dict[str, list[dict[str, Any]]] = {str(palace_id): [] for palace_id in titles}
    for binding in bindings:
        palace_id = _int_or_none(binding.get("palace_id"))
        if palace_id is None:
            continue
        owner_id = _int_or_none(binding.get("question_owner_palace_id"))
        node_uid = str(binding.get("node_uid") or "")
        enriched = dict(binding)
        enriched["target_palace_title"] = titles.get(palace_id, "")
        enriched["question_owner_palace_title"] = titles.get(owner_id, "") if owner_id is not None else ""
        enriched["node_text"] = labels_by_palace.get(palace_id, {}).get(node_uid, "")
        grouped.setdefault(str(palace_id), []).append(enriched)
    return grouped


def _chapters_by_id(session: Session, explicit_map: dict[int, set[int]]) -> dict[int, Chapter]:
    del explicit_map
    rows = session.query(Chapter).all()
    return {int(row.id): row for row in rows if row.id is not None}


def _minimal_explicit_ids(explicit_ids: set[int], chapters_by_id: dict[int, Chapter]) -> list[int]:
    if not explicit_ids:
        return []
    minimal: list[int] = []
    for chapter_id in explicit_ids:
        chapter = chapters_by_id.get(chapter_id)
        if chapter is None:
            minimal.append(chapter_id)
            continue
        has_explicit_descendant = False
        for other_id in explicit_ids:
            if other_id == chapter_id:
                continue
            current = chapters_by_id.get(other_id)
            parent_id = getattr(current, "parent_id", None) if current is not None else None
            current = chapters_by_id.get(parent_id) if isinstance(parent_id, int) else None
            while current is not None:
                if current.id == chapter_id:
                    has_explicit_descendant = True
                    break
                parent_id = getattr(current, "parent_id", None)
                current = chapters_by_id.get(parent_id) if isinstance(parent_id, int) else None
        if not has_explicit_descendant:
            minimal.append(chapter_id)
    return sorted(set(minimal))


def _node_labels(doc: Any) -> dict[str, str]:
    labels: dict[str, str] = {}

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            uid = data.get("uid")
            if uid:
                labels[str(uid)] = str(data.get("text") or "")
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                walk(child)

    if isinstance(doc, dict):
        walk(doc.get("root") or doc)
    return labels


def _append_unique(items: list[dict[str, Any]], seen: set[int], question: dict[str, Any]) -> None:
    question_id = _int_or_none(question.get("id"))
    if question_id is None or question_id in seen:
        return
    seen.add(question_id)
    items.append(question)


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None
