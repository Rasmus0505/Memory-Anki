import copy
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha1
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    FULL_BACKUPS_DIR,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Chapter, Palace, PalaceVersion, Peg
from memory_anki.modules.backups.application.backup_lifecycle import (
    ROLLING_EDIT_BACKUP_INTERVAL as ROLLING_EDIT_BACKUP_INTERVAL,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_full_backup as create_full_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_rescue_snapshot as create_rescue_snapshot,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_shutdown_backup as create_shutdown_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    ensure_daily_backup as ensure_daily_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    list_backups as list_backups,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    maybe_create_interval_backup as maybe_create_interval_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    maybe_create_periodic_backup as maybe_create_periodic_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    maybe_create_rolling_backup as maybe_create_rolling_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    restore_database_backup as restore_database_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    start_periodic_backup_loop as start_periodic_backup_loop,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    stop_periodic_backup_loop as stop_periodic_backup_loop,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    timestamp_slug as timestamp_slug,
)
from memory_anki.modules.backups.application.editor_safety import (
    MAX_SAFE_REMAINING_NODES as MAX_SAFE_REMAINING_NODES,
)
from memory_anki.modules.backups.application.editor_safety import (
    MIN_DANGEROUS_NODE_COUNT as MIN_DANGEROUS_NODE_COUNT,
)
from memory_anki.modules.backups.application.editor_safety import (
    count_editor_doc_nodes as count_editor_doc_nodes,
)
from memory_anki.modules.backups.application.editor_safety import (
    is_dangerous_structure_change as is_dangerous_structure_change,
)
from memory_anki.modules.backups.application.snapshot_sources import (
    export_git_snapshot_db as export_git_snapshot_db,
)
from memory_anki.modules.backups.application.snapshot_sources import (
    fetch_snapshot_from_sqlite,
)

MAX_VERSION_COUNT = 50
EDITOR_SNAPSHOT_INTERVAL = timedelta(minutes=5)
MILESTONE_TRIGGER_REASONS = {
    "before-version-restore",
    "before-git-recovery",
    "before-backup-restore",
    "before-db-restore",
}


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


def _deserialize_version_json(raw: str | None, fallback):
    if raw in (None, ""):
        return copy.deepcopy(fallback)
    assert raw is not None
    try:
        value = json.loads(raw)
    except Exception:
        return copy.deepcopy(fallback)
    if isinstance(fallback, dict) and not isinstance(value, dict):
        return copy.deepcopy(fallback)
    return value


def _load_json_document(value: dict | str | None) -> dict | str | None:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return value
        return parsed
    return copy.deepcopy(value)


def _extract_top_level_node_texts(editor_doc: dict | str | None) -> list[str]:
    parsed = _load_json_document(editor_doc)
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


def _build_editor_snapshot_fingerprint(editor_doc: dict | str | None) -> str:
    parsed = _load_json_document(editor_doc)
    try:
        payload = json.dumps(parsed, ensure_ascii=False, sort_keys=True)
    except Exception:
        payload = str(parsed)
    return sha1(payload.encode("utf-8")).hexdigest()


def _build_palace_editor_snapshot_summary(
    *,
    source_kind: str,
    source_label: str,
    palace_id: int,
    title: str,
    editor_doc: dict | str | None,
    editor_config: dict | str | None,
    editor_local_config: dict | str | None,
) -> PalaceEditorSnapshotSummary:
    parsed_doc = _load_json_document(editor_doc)
    return PalaceEditorSnapshotSummary(
        source_kind=source_kind,
        source_label=source_label,
        palace_id=palace_id,
        title=title or "未命名宫殿",
        node_count=count_editor_doc_nodes(parsed_doc),
        top_level_texts=_extract_top_level_node_texts(parsed_doc),
        fingerprint=_build_editor_snapshot_fingerprint(parsed_doc),
        editor_doc=parsed_doc,
        editor_config=_load_json_document(editor_config),
        editor_local_config=_load_json_document(editor_local_config),
    )


def create_palace_version(
    session: Session,
    palace: Palace,
    trigger_reason: str,
) -> PalaceVersion:
    peg_snapshot = [
        {
            "id": peg.id,
            "parent_id": peg.parent_id,
            "name": peg.name,
            "content": peg.content,
            "sort_order": peg.sort_order,
        }
        for peg in session.query(Peg).filter_by(palace_id=palace.id).order_by(Peg.sort_order, Peg.id).all()
    ]
    chapter_snapshot = [
        {"id": chapter.id, "name": chapter.name, "subject_id": chapter.subject_id}
        for chapter in palace.chapters
    ]
    latest_version = (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace.id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .first()
    )
    next_editor_doc = palace.editor_doc or ""
    next_peg_snapshot = json.dumps(peg_snapshot, ensure_ascii=False)
    next_chapter_snapshot = json.dumps(chapter_snapshot, ensure_ascii=False)

    if latest_version and (latest_version.editor_doc or "") == next_editor_doc:
        return latest_version

    version = PalaceVersion(
        palace_id=palace.id,
        trigger_reason=trigger_reason,
        title=palace.title or "",
        created_at_value=palace.created_at,
        editor_doc=next_editor_doc,
        editor_config=palace.editor_config or "",
        editor_local_config=palace.editor_local_config or "",
        peg_snapshot=next_peg_snapshot,
        chapter_snapshot=next_chapter_snapshot,
    )
    session.add(version)
    session.flush()
    _trim_old_versions(session, palace.id)
    return version


def create_effective_palace_version(
    session: Session,
    palace: Palace,
    trigger_reason: str,
) -> PalaceVersion | None:
    if trigger_reason in MILESTONE_TRIGGER_REASONS:
        return create_palace_version(session, palace, trigger_reason)
    if trigger_reason != "editor_save":
        return create_palace_version(session, palace, trigger_reason)
    if not should_create_editor_snapshot(session, palace):
        return None
    return create_palace_version(session, palace, trigger_reason)


def should_create_editor_snapshot(session: Session, palace: Palace) -> bool:
    candidate_signature = _build_version_signature_from_palace(palace)
    latest_version = _get_latest_version(session, palace.id)
    if latest_version is None:
        return True
    if _build_version_signature(latest_version) == candidate_signature:
        return False

    latest_editor_version = _get_latest_editor_version(session, palace.id)
    if latest_editor_version is None or latest_editor_version.created_at is None:
        return True

    latest_editor_signature = _build_version_signature(latest_editor_version)
    if latest_editor_signature == candidate_signature:
        return False

    now = palace.updated_at or utc_now_naive()
    return now - latest_editor_version.created_at >= EDITOR_SNAPSHOT_INTERVAL


def cleanup_duplicate_palace_versions(session: Session, palace_id: int) -> int:
    versions = (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .all()
    )
    seen_signatures: set[tuple] = set()
    removed = 0

    for version in versions:
        signature = (version.editor_doc or "",)
        if signature in seen_signatures:
            session.delete(version)
            removed += 1
            continue
        seen_signatures.add(signature)

    if removed:
        session.flush()
        _trim_old_versions(session, palace_id)
    return removed


def get_effective_palace_versions(session: Session, palace_id: int) -> list[PalaceVersion]:
    versions = _list_versions_query(session, palace_id).all()
    effective: list[PalaceVersion] = []
    for version in versions:
        if version.trigger_reason != "editor_save":
            effective.append(version)
            continue
        if not effective:
            effective.append(version)
            continue
        if any(existing.id == version.id for existing in effective):
            continue
        last_kept = effective[-1]
        if _build_version_signature(last_kept) == _build_version_signature(version):
            continue
        if (
            last_kept.trigger_reason == "editor_save"
            and last_kept.created_at
            and version.created_at
            and last_kept.created_at - version.created_at < EDITOR_SNAPSHOT_INTERVAL
        ):
            continue
        effective.append(version)
    return effective


def _trim_old_versions(session: Session, palace_id: int) -> None:
    versions = _list_versions_query(session, palace_id).all()
    for version in versions[MAX_VERSION_COUNT:]:
        session.delete(version)


def list_palace_versions(session: Session, palace_id: int) -> list[dict]:
    versions = get_effective_palace_versions(session, palace_id)
    return [
        {
            "id": version.id,
            "palace_id": version.palace_id,
            "trigger_reason": version.trigger_reason,
            "title": version.title,
            "created_at_value": version.created_at_value.isoformat() if version.created_at_value else None,
            "created_at": version.created_at.isoformat() if version.created_at else None,
        }
        for version in versions
    ]


def get_palace_version_detail(session: Session, palace_id: int, version_id: int) -> dict | None:
    from memory_anki.modules.mindmap.application.editor_state_service import (
        DEFAULT_EDITOR_CONFIG,
        DEFAULT_EDITOR_LOCAL_CONFIG,
        normalize_editor_doc,
    )

    version = (
        session.query(PalaceVersion)
        .filter_by(id=version_id, palace_id=palace_id)
        .first()
    )
    if version is None:
        return None
    editor_doc = _deserialize_version_json(version.editor_doc, {})
    normalized_doc = normalize_editor_doc(editor_doc, root_text=version.title or "未命名宫殿", root_kind="palace")
    editor_config = _deserialize_version_json(version.editor_config, DEFAULT_EDITOR_CONFIG)
    editor_local_config = _deserialize_version_json(version.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    return {
        "id": version.id,
        "palace_id": version.palace_id,
        "trigger_reason": version.trigger_reason,
        "title": version.title,
        "created_at_value": version.created_at_value.isoformat() if version.created_at_value else None,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "editor_doc": normalized_doc,
        "editor_config": editor_config,
        "editor_local_config": editor_local_config,
    }


def get_current_palace_editor_snapshot(session: Session, palace_id: int) -> PalaceEditorSnapshotSummary | None:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if palace is None:
        return None
    return _build_palace_editor_snapshot_summary(
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
    return _build_palace_editor_snapshot_summary(
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
        return _build_palace_editor_snapshot_summary(
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


def _list_versions_query(session: Session, palace_id: int):
    return (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
    )


def _get_latest_version(session: Session, palace_id: int) -> PalaceVersion | None:
    return _list_versions_query(session, palace_id).first()


def _get_latest_editor_version(session: Session, palace_id: int) -> PalaceVersion | None:
    return (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id, trigger_reason="editor_save")
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .first()
    )


def _build_version_signature_from_palace(palace: Palace) -> tuple[str, str | None, str, str, str, str, str]:
    peg_snapshot = [
        {
            "id": peg.id,
            "parent_id": peg.parent_id,
            "name": peg.name,
            "content": peg.content,
            "sort_order": peg.sort_order,
        }
        for peg in sorted(_collect_all_pegs(palace.pegs), key=lambda peg: (peg.sort_order, peg.id))
    ]
    chapter_snapshot = [
        {"id": chapter.id, "name": chapter.name, "subject_id": chapter.subject_id}
        for chapter in palace.chapters
    ]
    return (
        palace.title or "",
        palace.created_at.isoformat() if palace.created_at else None,
        palace.editor_doc or "",
        palace.editor_config or "",
        palace.editor_local_config or "",
        json.dumps(peg_snapshot, ensure_ascii=False),
        json.dumps(chapter_snapshot, ensure_ascii=False),
    )


def _build_version_signature(version: PalaceVersion) -> tuple[str, str | None, str, str, str, str, str]:
    return (
        version.title or "",
        version.created_at_value.isoformat() if version.created_at_value else None,
        version.editor_doc or "",
        version.editor_config or "",
        version.editor_local_config or "",
        version.peg_snapshot or "",
        version.chapter_snapshot or "",
    )


def _collect_all_pegs(pegs: list[Peg]) -> list[Peg]:
    result: list[Peg] = []

    def walk(items: list[Peg]) -> None:
        for peg in items:
            result.append(peg)
            walk(list(peg.children or []))

    walk(list(pegs or []))
    return result


def restore_palace_version(session: Session, palace: Palace, version_id: int) -> PalaceVersion:
    version = session.query(PalaceVersion).filter_by(id=version_id, palace_id=palace.id).first()
    if version is None:
        raise ValueError("未找到该宫殿版本。")
    create_palace_version(session, palace, "before-version-restore")
    _apply_snapshot_to_palace(session, palace, {
        "title": version.title,
        "created_at": version.created_at_value.isoformat() if version.created_at_value else None,
        "editor_doc": version.editor_doc,
        "editor_config": version.editor_config,
        "editor_local_config": version.editor_local_config,
        "pegs": json.loads(version.peg_snapshot or "[]"),
        "chapter_ids": [item["id"] for item in json.loads(version.chapter_snapshot or "[]") if isinstance(item, dict) and item.get("id") is not None],
    })
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
    _apply_snapshot_to_palace(session, palace, {
        "title": snapshot.palace_row.get("title") or palace.title,
        "description": snapshot.palace_row.get("description") or palace.description,
        "created_at": snapshot.palace_row.get("created_at"),
        "editor_doc": snapshot.palace_row.get("editor_doc") or "",
        "editor_config": snapshot.palace_row.get("editor_config") or "",
        "editor_local_config": snapshot.palace_row.get("editor_local_config") or "",
        "pegs": snapshot.pegs,
        "chapter_ids": snapshot.chapter_ids,
    })
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
            _apply_snapshot_to_palace(session, palace, {
                "title": snapshot.palace_row.get("title") or palace.title,
                "description": snapshot.palace_row.get("description") or palace.description,
                "created_at": snapshot.palace_row.get("created_at"),
                "editor_doc": snapshot.palace_row.get("editor_doc") or "",
                "editor_config": snapshot.palace_row.get("editor_config") or "",
                "editor_local_config": snapshot.palace_row.get("editor_local_config") or "",
                "pegs": snapshot.pegs,
                "chapter_ids": snapshot.chapter_ids,
            })
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


def _apply_snapshot_to_palace(session: Session, palace: Palace, snapshot: dict) -> None:
    editor_doc_raw = snapshot.get("editor_doc")
    palace.title = snapshot.get("title") or palace.title
    if "description" in snapshot:
        palace.description = snapshot.get("description") or ""
    if "created_at" in snapshot:
        created_at_value = snapshot.get("created_at")
        palace.created_at = _coerce_datetime(created_at_value)
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

    ordered_pegs = sorted(snapshot.get("pegs", []), key=lambda item: (item.get("parent_id") is not None, item.get("sort_order", 0), item.get("id", 0)))
    created_by_new_id = {peg_data["_new_id"]: peg_data for peg_data in ordered_pegs if "_new_id" in peg_data}
    for peg in session.query(Peg).filter_by(palace_id=palace.id).all():
        peg_data = created_by_new_id.get(peg.id)
        if not peg_data:
            continue
        old_parent_id = peg_data.get("parent_id")
        peg.parent_id = id_map.get(old_parent_id) if isinstance(old_parent_id, int) else None

    if "editor_doc" in snapshot:
        palace.editor_doc = _remap_editor_doc_ids(editor_doc_raw, id_map)

    chapter_ids = [int(chapter_id) for chapter_id in snapshot.get("chapter_ids", []) if chapter_id is not None]
    palace.chapters = session.query(Chapter).filter(Chapter.id.in_(chapter_ids)).all() if chapter_ids else []


def _coerce_datetime(value):
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


def _remap_editor_doc_ids(editor_doc: dict | str | None, id_map: dict[int, int]) -> str:
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


