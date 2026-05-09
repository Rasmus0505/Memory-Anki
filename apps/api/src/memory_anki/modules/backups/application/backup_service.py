import copy
import json
import shutil
import sqlite3
import subprocess
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    ATTACHMENTS_DIR,
    DB_PATH,
    FULL_BACKUPS_DIR,
    REPO_ROOT,
    RESCUE_BACKUPS_DIR,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Chapter, Palace, PalaceVersion, Peg

MAX_VERSION_COUNT = 50
MIN_DANGEROUS_NODE_COUNT = 5
MAX_SAFE_REMAINING_NODES = 2
EDITOR_SNAPSHOT_INTERVAL = timedelta(minutes=5)
AUTO_FULL_BACKUP_INTERVAL = timedelta(hours=4)
ROLLING_EDIT_BACKUP_INTERVAL = timedelta(minutes=30)
MILESTONE_TRIGGER_REASONS = {
    "before-version-restore",
    "before-git-recovery",
    "before-backup-restore",
    "before-db-restore",
}
_BACKUP_LOCK = threading.Lock()
_BACKUP_LOOP_THREAD: threading.Thread | None = None
_BACKUP_LOOP_STOP = threading.Event()


@dataclass
class PalaceSnapshot:
    palace_row: dict
    pegs: list[dict]
    chapter_ids: list[int]


def ensure_backup_schema(session: Session) -> None:
    connection = session.connection()
    connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS palace_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            palace_id INTEGER NOT NULL,
            trigger_reason VARCHAR(50) DEFAULT 'manual_save',
            title VARCHAR(200) NOT NULL DEFAULT '',
            created_at_value DATETIME NULL,
            editor_doc TEXT DEFAULT '',
            editor_config TEXT DEFAULT '',
            editor_local_config TEXT DEFAULT '',
            peg_snapshot TEXT DEFAULT '',
            chapter_snapshot TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
        )
        """
    )
    existing_columns = {
        row[1]
        for row in connection.exec_driver_sql("PRAGMA table_info(palace_versions)").fetchall()
    }
    for column in ("editor_config", "editor_local_config"):
        if column not in existing_columns:
            connection.exec_driver_sql(f"ALTER TABLE palace_versions ADD COLUMN {column} TEXT DEFAULT ''")
    connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_palace_versions_palace_id_created_at ON palace_versions (palace_id, created_at DESC)"
    )
    session.commit()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


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


def _copy_attachments(destination: Path) -> None:
    target = destination / "attachments"
    if ATTACHMENTS_DIR.exists():
        shutil.copytree(ATTACHMENTS_DIR, target, dirs_exist_ok=True)
    else:
        target.mkdir(parents=True, exist_ok=True)


def create_rescue_snapshot(reason: str) -> Path:
    folder = RESCUE_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DB_PATH, folder / DB_PATH.name)
    _copy_attachments(folder)
    return folder


def _daily_backup_exists() -> bool:
    prefix = datetime.now().strftime("%Y%m%d")
    return any(child.is_dir() and child.name.startswith(prefix) for child in FULL_BACKUPS_DIR.iterdir())


def ensure_daily_backup() -> Path | None:
    if _daily_backup_exists():
        return None
    return create_full_backup("startup")


def create_full_backup(reason: str) -> Path:
    with _BACKUP_LOCK:
        folder = FULL_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DB_PATH, folder / DB_PATH.name)
        _copy_attachments(folder)
        manifest = {
            "reason": reason,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "db_file": DB_PATH.name,
            "attachments_dir": "attachments",
        }
        (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return folder


def list_backups() -> list[dict]:
    results: list[dict] = []
    for kind, root in (("full", FULL_BACKUPS_DIR), ("rescue", RESCUE_BACKUPS_DIR)):
        if not root.exists():
            continue
        for folder in sorted(root.iterdir(), reverse=True):
            if not folder.is_dir():
                continue
            db_file = folder / DB_PATH.name
            manifest_file = folder / "manifest.json"
            manifest = {}
            if manifest_file.exists():
                try:
                    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
                except Exception:
                    manifest = {}
            results.append(
                {
                    "kind": kind,
                    "name": folder.name,
                    "path": str(folder),
                    "created_at": manifest.get("created_at") or datetime.fromtimestamp(folder.stat().st_mtime).isoformat(timespec="seconds"),
                    "reason": manifest.get("reason") or "",
                    "has_database": db_file.exists(),
                    "has_attachments": (folder / "attachments").exists(),
                }
            )
    return results


def restore_database_backup(backup_folder: str) -> Path:
    source_dir = Path(backup_folder)
    source_db = source_dir / DB_PATH.name
    source_attachments = source_dir / "attachments"
    if not source_db.exists():
        raise FileNotFoundError("备份中缺少数据库快照。")
    rescue = create_rescue_snapshot("before-db-restore")
    shutil.copy2(source_db, DB_PATH)
    if source_attachments.exists():
        if ATTACHMENTS_DIR.exists():
            shutil.rmtree(ATTACHMENTS_DIR)
        shutil.copytree(source_attachments, ATTACHMENTS_DIR)
    return rescue


def maybe_create_interval_backup(reason: str, minimum_interval: timedelta) -> Path | None:
    latest = _latest_full_backup()
    if latest and _backup_age(latest) < minimum_interval:
        return None
    return create_full_backup(reason)


def maybe_create_rolling_backup(reason: str = "rolling-edit") -> Path | None:
    return maybe_create_interval_backup(reason, ROLLING_EDIT_BACKUP_INTERVAL)


def maybe_create_periodic_backup() -> Path | None:
    return maybe_create_interval_backup("periodic", AUTO_FULL_BACKUP_INTERVAL)


def create_shutdown_backup() -> Path | None:
    return create_full_backup("shutdown")


def start_periodic_backup_loop() -> None:
    global _BACKUP_LOOP_THREAD
    if _BACKUP_LOOP_THREAD and _BACKUP_LOOP_THREAD.is_alive():
        return
    _BACKUP_LOOP_STOP.clear()

    def run_loop() -> None:
        while not _BACKUP_LOOP_STOP.wait(timeout=300):
            try:
                maybe_create_periodic_backup()
            except Exception:
                continue

    _BACKUP_LOOP_THREAD = threading.Thread(target=run_loop, name="memory-anki-backup-loop", daemon=True)
    _BACKUP_LOOP_THREAD.start()


def stop_periodic_backup_loop() -> None:
    _BACKUP_LOOP_STOP.set()


def _latest_full_backup() -> Path | None:
    folders = [child for child in FULL_BACKUPS_DIR.iterdir() if child.is_dir()]
    if not folders:
        return None
    return max(folders, key=lambda item: item.stat().st_mtime)


def _backup_age(folder: Path) -> timedelta:
    modified_at = datetime.fromtimestamp(folder.stat().st_mtime)
    return datetime.now() - modified_at


def _fetch_snapshot_from_sqlite(db_path: Path, palace_id: int) -> PalaceSnapshot | None:
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    try:
        palace_row = connection.execute("SELECT * FROM palaces WHERE id = ?", (palace_id,)).fetchone()
        if palace_row is None:
            return None
        pegs = [
            dict(row)
            for row in connection.execute(
                "SELECT id, palace_id, parent_id, name, content, sort_order FROM pegs WHERE palace_id = ? ORDER BY parent_id IS NOT NULL, sort_order, id",
                (palace_id,),
            ).fetchall()
        ]
        chapter_ids = [
            int(row["chapter_id"])
            for row in connection.execute(
                "SELECT chapter_id FROM chapter_palaces WHERE palace_id = ? ORDER BY id",
                (palace_id,),
            ).fetchall()
        ]
        return PalaceSnapshot(palace_row=dict(palace_row), pegs=pegs, chapter_ids=chapter_ids)
    finally:
        connection.close()


def export_git_snapshot_db(commit: str, destination: Path) -> Path:
    try:
        db_bytes = subprocess.check_output(
            ["git", "show", f"{commit}:data/memory_palace.db"],
            cwd=REPO_ROOT,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        raise FileNotFoundError(
            "指定提交中不存在 legacy 仓库数据库快照。当前版本已停止把运行数据提交到 Git，请改用本地 full/rescue 备份恢复。"
        ) from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(db_bytes)
    return destination


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

    snapshot = _fetch_snapshot_from_sqlite(source_path, palace_id)
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
            snapshot = _fetch_snapshot_from_sqlite(temp_snapshot, palace_id)
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


def count_editor_doc_nodes(doc: dict | str | None) -> int:
    if doc in (None, ""):
        return 0
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except Exception:
            return 0
    if not isinstance(doc, dict):
        return 0
    root = doc.get("root")
    if not isinstance(root, dict):
        return 0

    def walk(node: dict) -> int:
        children = node.get("children")
        if not isinstance(children, list):
            children = []
        return 1 + sum(walk(child) for child in children if isinstance(child, dict))

    return max(0, walk(root) - 1)


def is_dangerous_structure_change(existing_node_count: int, next_node_count: int) -> bool:
    return existing_node_count >= MIN_DANGEROUS_NODE_COUNT and next_node_count <= MAX_SAFE_REMAINING_NODES and next_node_count < existing_node_count
