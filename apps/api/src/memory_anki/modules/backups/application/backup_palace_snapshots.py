from __future__ import annotations

import copy
import json
import sqlite3
from dataclasses import dataclass
from hashlib import sha1
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, PalaceVersion
from memory_anki.modules.backups.application.editor_safety import count_editor_doc_nodes


@dataclass
class PalaceEditorSnapshotSummary:
    source_kind: str
    source_label: str
    palace_id: int
    title: str
    node_count: int
    top_level_texts: list[str]
    fingerprint: str
    editor_doc: dict | str | None
    editor_config: dict | str | None
    editor_local_config: dict | str | None


def load_json_document(value: dict | str | None) -> dict | str | None:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return value
        return parsed
    return copy.deepcopy(value)


def extract_top_level_node_texts(editor_doc: dict | str | None) -> list[str]:
    parsed = load_json_document(editor_doc)
    if not isinstance(parsed, dict):
        return []
    root = parsed.get("root")
    if not isinstance(root, dict):
        return []
    children = root.get("children")
    if not isinstance(children, list):
        return []
    results: list[str] = []
    for child in children:
        if not isinstance(child, dict):
            continue
        data = child.get("data")
        if not isinstance(data, dict):
            results.append("")
            continue
        results.append(str(data.get("text") or "").strip())
    return results


def build_editor_snapshot_fingerprint(editor_doc: dict | str | None) -> str:
    parsed = load_json_document(editor_doc)
    try:
        payload = json.dumps(parsed, ensure_ascii=False, sort_keys=True)
    except Exception:
        payload = str(parsed)
    return sha1(payload.encode("utf-8")).hexdigest()


def build_palace_editor_snapshot_summary(
    *,
    source_kind: str,
    source_label: str,
    palace_id: int,
    title: str,
    editor_doc: dict | str | None,
    editor_config: dict | str | None,
    editor_local_config: dict | str | None,
) -> PalaceEditorSnapshotSummary:
    parsed_doc = load_json_document(editor_doc)
    return PalaceEditorSnapshotSummary(
        source_kind=source_kind,
        source_label=source_label,
        palace_id=palace_id,
        title=title or "未命名宫殿",
        node_count=count_editor_doc_nodes(parsed_doc),
        top_level_texts=extract_top_level_node_texts(parsed_doc),
        fingerprint=build_editor_snapshot_fingerprint(parsed_doc),
        editor_doc=parsed_doc,
        editor_config=load_json_document(editor_config),
        editor_local_config=load_json_document(editor_local_config),
    )


def get_current_palace_editor_snapshot(session: Session, palace_id: int) -> PalaceEditorSnapshotSummary | None:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if palace is None:
        return None
    return build_palace_editor_snapshot_summary(
        source_kind="current_db",
        source_label=f"current-db:palace-{palace_id}",
        palace_id=palace.id,
        title=palace.title or "",
        editor_doc=palace.editor_doc,
        editor_config=palace.editor_config,
        editor_local_config=palace.editor_local_config,
    )


def get_palace_version_snapshot(
    session: Session,
    *,
    palace_id: int,
    version_id: int,
) -> PalaceEditorSnapshotSummary | None:
    version = (
        session.query(PalaceVersion)
        .filter_by(id=version_id, palace_id=palace_id)
        .first()
    )
    if version is None:
        return None
    return build_palace_editor_snapshot_summary(
        source_kind="palace_version",
        source_label=f"version:{version_id}",
        palace_id=palace_id,
        title=version.title or "",
        editor_doc=version.editor_doc,
        editor_config=version.editor_config,
        editor_local_config=version.editor_local_config,
    )


def get_backup_palace_editor_snapshot(
    *,
    backup_db_path: str,
    palace_id: int,
) -> PalaceEditorSnapshotSummary | None:
    source_path = Path(backup_db_path)
    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError("指定的备份数据库不存在。")

    connection = sqlite3.connect(str(source_path))
    connection.row_factory = sqlite3.Row
    try:
        palace_row = connection.execute(
            "SELECT id, title, editor_doc, editor_config, editor_local_config FROM palaces WHERE id = ?",
            (palace_id,),
        ).fetchone()
        if palace_row is None:
            return None
        return build_palace_editor_snapshot_summary(
            source_kind="backup_db",
            source_label=str(source_path),
            palace_id=int(palace_row["id"]),
            title=str(palace_row["title"] or ""),
            editor_doc=palace_row["editor_doc"],
            editor_config=palace_row["editor_config"],
            editor_local_config=palace_row["editor_local_config"],
        )
    finally:
        connection.close()


def palace_editor_snapshot_to_dict(snapshot: PalaceEditorSnapshotSummary) -> dict:
    return {
        "source_kind": snapshot.source_kind,
        "source_label": snapshot.source_label,
        "palace_id": snapshot.palace_id,
        "title": snapshot.title,
        "node_count": snapshot.node_count,
        "top_level_texts": snapshot.top_level_texts,
        "fingerprint": snapshot.fingerprint,
        "editor_doc": snapshot.editor_doc,
        "editor_config": snapshot.editor_config,
        "editor_local_config": snapshot.editor_local_config,
    }


def compare_palace_editor_snapshots(
    baseline: PalaceEditorSnapshotSummary,
    candidate: PalaceEditorSnapshotSummary,
) -> dict:
    baseline_top = baseline.top_level_texts
    candidate_top = candidate.top_level_texts
    baseline_set = {text for text in baseline_top if text}
    candidate_set = {text for text in candidate_top if text}
    missing_from_candidate = [text for text in baseline_top if text and text not in candidate_set]
    added_in_candidate = [text for text in candidate_top if text and text not in baseline_set]
    return {
        "same_fingerprint": baseline.fingerprint == candidate.fingerprint,
        "baseline_source": baseline.source_label,
        "candidate_source": candidate.source_label,
        "baseline_node_count": baseline.node_count,
        "candidate_node_count": candidate.node_count,
        "node_count_delta": candidate.node_count - baseline.node_count,
        "baseline_top_level_count": len(baseline_top),
        "candidate_top_level_count": len(candidate_top),
        "missing_top_level_texts": missing_from_candidate,
        "added_top_level_texts": added_in_candidate,
    }


def export_palace_snapshot_comparison(
    session: Session,
    *,
    palace_id: int,
    version_id: int | None = None,
    backup_db_path: str | None = None,
) -> dict:
    current_snapshot = get_current_palace_editor_snapshot(session, palace_id)
    if current_snapshot is None:
        raise ValueError("当前数据库里未找到这个宫殿。")

    snapshots = [current_snapshot]
    comparisons: list[dict] = []

    if version_id is not None:
        version_snapshot = get_palace_version_snapshot(session, palace_id=palace_id, version_id=version_id)
        if version_snapshot is None:
            raise ValueError("未找到指定恢复点。")
        snapshots.append(version_snapshot)
        comparisons.append(
            {
                "compare_key": "current_vs_version",
                **compare_palace_editor_snapshots(version_snapshot, current_snapshot),
            }
        )

    if backup_db_path:
        backup_snapshot = get_backup_palace_editor_snapshot(backup_db_path=backup_db_path, palace_id=palace_id)
        if backup_snapshot is None:
            raise ValueError("备份里未找到这个宫殿。")
        snapshots.append(backup_snapshot)
        comparisons.append(
            {
                "compare_key": "current_vs_backup",
                **compare_palace_editor_snapshots(backup_snapshot, current_snapshot),
            }
        )
        if version_id is not None:
            version_snapshot = next(
                (item for item in snapshots if item.source_kind == "palace_version"),
                None,
            )
            if version_snapshot is not None:
                comparisons.append(
                    {
                        "compare_key": "version_vs_backup",
                        **compare_palace_editor_snapshots(backup_snapshot, version_snapshot),
                    }
                )

    return {
        "palace_id": palace_id,
        "snapshots": [palace_editor_snapshot_to_dict(item) for item in snapshots],
        "comparisons": comparisons,
    }
