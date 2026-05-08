import copy
import json
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from config import ATTACHMENTS_DIR, DB_PATH, FULL_BACKUPS_DIR, RESCUE_BACKUPS_DIR
from models import Chapter, Palace, PalaceVersion, Peg


MAX_VERSION_COUNT = 50
MIN_DANGEROUS_NODE_COUNT = 5
MAX_SAFE_REMAINING_NODES = 2


@dataclass
class PalaceSnapshot:
    palace_row: dict
    pegs: list[dict]
    chapter_ids: list[int]


def ensure_backup_schema(session: Session) -> None:
    session.connection().exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS palace_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            palace_id INTEGER NOT NULL,
            trigger_reason VARCHAR(50) DEFAULT 'manual_save',
            title VARCHAR(200) NOT NULL DEFAULT '',
            created_at_value DATETIME NULL,
            editor_doc TEXT DEFAULT '',
            peg_snapshot TEXT DEFAULT '',
            chapter_snapshot TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
        )
        """
    )
    session.connection().exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_palace_versions_palace_id_created_at ON palace_versions (palace_id, created_at DESC)"
    )
    session.commit()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


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
    db_bytes = subprocess.check_output(["git", "show", f"{commit}:data/memory_palace.db"], cwd=Path(__file__).resolve().parent.parent.parent)
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
    version = PalaceVersion(
        palace_id=palace.id,
        trigger_reason=trigger_reason,
        title=palace.title or "",
        created_at_value=palace.created_at,
        editor_doc=palace.editor_doc or "",
        peg_snapshot=json.dumps(peg_snapshot, ensure_ascii=False),
        chapter_snapshot=json.dumps(chapter_snapshot, ensure_ascii=False),
    )
    session.add(version)
    session.flush()
    _trim_old_versions(session, palace.id)
    return version


def _trim_old_versions(session: Session, palace_id: int) -> None:
    versions = (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .all()
    )
    for version in versions[MAX_VERSION_COUNT:]:
        session.delete(version)


def list_palace_versions(session: Session, palace_id: int) -> list[dict]:
    versions = (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .all()
    )
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


def restore_palace_version(session: Session, palace: Palace, version_id: int) -> PalaceVersion:
    version = session.query(PalaceVersion).filter_by(id=version_id, palace_id=palace.id).first()
    if version is None:
        raise ValueError("未找到该宫殿版本。")
    create_palace_version(session, palace, "before-version-restore")
    _apply_snapshot_to_palace(session, palace, {
        "title": version.title,
        "created_at": version.created_at_value.isoformat() if version.created_at_value else None,
        "editor_doc": version.editor_doc,
        "pegs": json.loads(version.peg_snapshot or "[]"),
        "chapter_ids": [item["id"] for item in json.loads(version.chapter_snapshot or "[]") if isinstance(item, dict) and item.get("id") is not None],
    })
    session.commit()
    session.refresh(version)
    return version


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
