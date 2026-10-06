"""Batch, non-repairing catalog for learning coverage consumers."""
import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    chapter_palace_table,
    palace_subject_table,
)

from .tree_structure import list_active_palace_tree_structures


def _tree_integrity_warnings(tree: dict[str, Any], editor_doc: Any) -> list[str]:
    raw_nodes = tree.get("nodes")
    nodes: dict[str, Any] = raw_nodes if isinstance(raw_nodes, dict) else {}
    root_uid = tree.get("root_uid")
    warnings: list[str] = []
    if root_uid is None or root_uid not in nodes:
        warnings.append("missing_root")
    for uid, raw in nodes.items():
        children = raw.get("children") if isinstance(raw, dict) else None
        if not isinstance(children, list):
            warnings.append(f"invalid_children:{uid}")
            continue
        missing = [str(child) for child in children if str(child) not in nodes]
        if missing:
            warnings.append(f"missing_child:{uid}")
            warnings.append("missing_child_reference")
    if isinstance(editor_doc, str):
        try:
            document = json.loads(editor_doc or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            document = {}
    else:
        document = editor_doc
    raw_root = document.get("root") if isinstance(document, dict) else None
    raw_uids: list[str] = []
    def collect(raw: Any, fallback: str) -> None:
        if not isinstance(raw, dict):
            return
        raw_data = raw.get("data")
        data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
        raw_uids.append(str(data.get("uid") or data.get("memoryAnkiId") or fallback).strip())
        for index, child in enumerate(raw.get("children") or []):
            collect(child, f"{fallback}-{index}")
    collect(raw_root, "root")
    if len(raw_uids) != len(set(raw_uids)):
        warnings.append("duplicate_uid")
    return warnings


def read_learning_progress_catalog(session: Session) -> dict[str, Any]:
    with session.no_autoflush:
        trees = list_active_palace_tree_structures(session)
        subjects = session.query(Subject.id, Subject.name).order_by(Subject.sort_order, Subject.id).all()
        palace_docs = {
            palace.id: palace.editor_doc
            for palace in session.query(Palace.id, Palace.editor_doc).filter(
                Palace.archived.is_(False), Palace.deleted_at.is_(None)
            ).all()
        }
        links: dict[int, set[int]] = {}
        for pid, sid in session.query(palace_subject_table).all():
            links.setdefault(pid, set()).add(sid)
        for pid, sid in (
            session.query(chapter_palace_table.c.palace_id, Chapter.subject_id)
            .join(Chapter, Chapter.id == chapter_palace_table.c.chapter_id).all()
        ):
            links.setdefault(pid, set()).add(sid)
        for pid, sid in session.query(Palace.id, Chapter.subject_id).join(
            Chapter, Chapter.id == Palace.primary_chapter_id
        ).all():
            links.setdefault(pid, set()).add(sid)
    palaces: list[dict[str, Any]] = []
    warnings: list[str] = []
    for tree in trees:
        tree_warnings = _tree_integrity_warnings(tree, palace_docs.get(tree.get("palace_id")))
        if tree_warnings:
            palace_id = tree.get("palace_id")
            warnings.extend(f"palace:{palace_id}:{item}" for item in tree_warnings)
        palaces.append({**tree, "subject_ids": sorted(links.get(tree["palace_id"], set()))})
    return {
        "subjects": [{"id": sid, "name": name} for sid, name in subjects],
        "palaces": palaces,
        "warnings": warnings,
    }
