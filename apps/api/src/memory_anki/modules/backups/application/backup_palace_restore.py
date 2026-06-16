from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.core.config import FULL_BACKUPS_DIR
from memory_anki.infrastructure.db.models import Chapter, Palace, Peg
from memory_anki.modules.backups.application.editor_safety import count_editor_doc_nodes
from memory_anki.modules.backups.application.snapshot_sources import (
    export_git_snapshot_db,
    fetch_snapshot_from_sqlite,
)

from .backup_lifecycle import create_rescue_snapshot, timestamp_slug
from .backup_palace_versions import cleanup_duplicate_palace_versions, create_palace_version


def restore_palace_version(session: Session, palace: Palace, version_id: int):
    from memory_anki.infrastructure.db.models import PalaceVersion

    version = session.query(PalaceVersion).filter_by(id=version_id, palace_id=palace.id).first()
    if version is None:
        raise ValueError("未找到该宫殿版本。")
    create_palace_version(session, palace, "before-version-restore")
    apply_snapshot_to_palace(
        session,
        palace,
        {
            "title": version.title,
            "created_at": version.created_at_value.isoformat() if version.created_at_value else None,
            "editor_doc": version.editor_doc,
            "editor_config": version.editor_config,
            "editor_local_config": version.editor_local_config,
            "pegs": json.loads(version.peg_snapshot or "[]"),
            "chapter_ids": [
                item["id"]
                for item in json.loads(version.chapter_snapshot or "[]")
                if isinstance(item, dict) and item.get("id") is not None
            ],
        },
    )
    session.commit()
    session.refresh(version)
    return version


def restore_palace_from_backup(
    session: Session,
    *,
    backup_db_path: str,
    palace_id: int,
) -> dict:
    source_path = Path(backup_db_path)
    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError("指定的备份数据库不存在。")

    snapshot = fetch_snapshot_from_sqlite(source_path, palace_id)
    if snapshot is None:
        raise ValueError("备份里未找到这个宫殿。")

    palace = session.query(Palace).filter_by(id=palace_id).first()
    if palace is None:
        raise ValueError("当前数据库里未找到这个宫殿。")

    rescue_snapshot_path = create_rescue_snapshot("before-rescue-restore")
    create_palace_version(session, palace, "before-rescue-restore")
    apply_snapshot_to_palace(
        session,
        palace,
        {
            "title": snapshot.palace_row.get("title") or palace.title,
            "description": snapshot.palace_row.get("description") or palace.description,
            "created_at": snapshot.palace_row.get("created_at"),
            "editor_doc": snapshot.palace_row.get("editor_doc") or "",
            "editor_config": snapshot.palace_row.get("editor_config") or "",
            "editor_local_config": snapshot.palace_row.get("editor_local_config") or "",
            "pegs": snapshot.pegs,
            "chapter_ids": snapshot.chapter_ids,
        },
    )
    cleanup_duplicate_palace_versions(session, palace.id)
    session.commit()
    session.refresh(palace)

    return {
        "palace_id": palace.id,
        "source_backup_path": str(source_path),
        "restored_title": palace.title,
        "restored_node_count": count_editor_doc_nodes(palace.editor_doc) + (1 if palace.editor_doc else 0),
        "restored_peg_count": len(snapshot.pegs),
        "rescue_snapshot_path": str(rescue_snapshot_path),
    }


def recover_palaces_from_git_snapshot(
    session: Session,
    commit: str,
    palace_ids: list[int],
) -> dict:
    rescue_path = create_rescue_snapshot("before-palace-recovery")
    temp_snapshot = FULL_BACKUPS_DIR / f"git-snapshot-{timestamp_slug()}.db"
    export_git_snapshot_db(commit, temp_snapshot)
    recovered: dict[int, dict] = {}
    try:
        for palace_id in palace_ids:
            snapshot = fetch_snapshot_from_sqlite(temp_snapshot, palace_id)
            palace = session.query(Palace).filter_by(id=palace_id).first()
            if snapshot is None or palace is None:
                continue
            create_palace_version(session, palace, "before-git-recovery")
            apply_snapshot_to_palace(
                session,
                palace,
                {
                    "title": snapshot.palace_row.get("title") or palace.title,
                    "description": snapshot.palace_row.get("description") or palace.description,
                    "created_at": snapshot.palace_row.get("created_at"),
                    "editor_doc": snapshot.palace_row.get("editor_doc") or "",
                    "editor_config": snapshot.palace_row.get("editor_config") or "",
                    "editor_local_config": snapshot.palace_row.get("editor_local_config") or "",
                    "pegs": snapshot.pegs,
                    "chapter_ids": snapshot.chapter_ids,
                },
            )
            recovered[palace_id] = {
                "title": palace.title,
                "peg_count": len(snapshot.pegs),
                "chapter_count": len(snapshot.chapter_ids),
            }
        session.commit()
        return {
            "rescue_path": str(rescue_path),
            "recovered": recovered,
            "source_commit": commit,
        }
    finally:
        temp_snapshot.unlink(missing_ok=True)


def apply_snapshot_to_palace(session: Session, palace: Palace, snapshot: dict) -> None:
    editor_doc_raw = snapshot.get("editor_doc")
    palace.title = snapshot.get("title") or palace.title
    if "description" in snapshot:
        palace.description = snapshot.get("description") or ""
    if "created_at" in snapshot:
        created_at_value = snapshot.get("created_at")
        palace.created_at = coerce_datetime(created_at_value)
    if "editor_config" in snapshot:
        palace.editor_config = snapshot.get("editor_config") or ""
    if "editor_local_config" in snapshot:
        palace.editor_local_config = snapshot.get("editor_local_config") or ""

    for root_peg in list(palace.pegs):
        session.delete(root_peg)
    session.flush()

    id_map: dict[int, int] = {}
    for peg_data in snapshot.get("pegs", []):
        peg = Peg(
            palace_id=palace.id,
            parent_id=None,
            name=peg_data.get("name", ""),
            content=peg_data.get("content", ""),
            sort_order=int(peg_data.get("sort_order") or 0),
        )
        session.add(peg)
        session.flush()
        old_id = peg_data.get("id")
        if isinstance(old_id, int):
            id_map[old_id] = peg.id
        peg_data["_new_id"] = peg.id

    ordered_pegs = sorted(
        snapshot.get("pegs", []),
        key=lambda item: (item.get("parent_id") is not None, item.get("sort_order", 0), item.get("id", 0)),
    )
    created_by_new_id = {peg_data["_new_id"]: peg_data for peg_data in ordered_pegs if "_new_id" in peg_data}
    for peg in session.query(Peg).filter_by(palace_id=palace.id).all():
        peg_data = created_by_new_id.get(peg.id)
        if not peg_data:
            continue
        old_parent_id = peg_data.get("parent_id")
        peg.parent_id = id_map.get(old_parent_id) if isinstance(old_parent_id, int) else None

    if "editor_doc" in snapshot:
        palace.editor_doc = remap_editor_doc_ids(editor_doc_raw, id_map)

    chapter_ids = [int(chapter_id) for chapter_id in snapshot.get("chapter_ids", []) if chapter_id is not None]
    palace.chapters = session.query(Chapter).filter(Chapter.id.in_(chapter_ids)).all() if chapter_ids else []


def coerce_datetime(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None
    return None


def remap_editor_doc_ids(editor_doc: dict | str | None, id_map: dict[int, int]) -> str:
    if editor_doc in (None, ""):
        return ""
    if isinstance(editor_doc, str):
        try:
            parsed = json.loads(editor_doc)
        except Exception:
            return editor_doc
    else:
        parsed = copy.deepcopy(editor_doc)

    if not isinstance(parsed, dict):
        return json.dumps(parsed, ensure_ascii=False)

    def walk(node: dict) -> None:
        data = node.get("data")
        if isinstance(data, dict):
            current_id = data.get("memoryAnkiId")
            if isinstance(current_id, int) and current_id in id_map:
                data["memoryAnkiId"] = id_map[current_id]
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    walk(child)

    root = parsed.get("root")
    if isinstance(root, dict):
        walk(root)
    return json.dumps(parsed, ensure_ascii=False)
