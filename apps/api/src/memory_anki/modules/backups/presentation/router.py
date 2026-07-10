from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_full_backup,
    list_backups,
    restore_database_backup,
)
from memory_anki.modules.backups.application.backup_palace_restore import (
    recover_palaces_from_git_snapshot,
    restore_palace_from_backup,
)
from memory_anki.modules.backups.application.backup_palace_snapshots import (
    export_palace_snapshot_comparison,
)

router = APIRouter(tags=["backups"])


def _request_int(value: object) -> int:
    if not isinstance(value, str | int | float):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


@router.get("/backups")
def api_list_backups():
    return {"items": list_backups()}


@router.post("/backups/create")
def api_create_backup(data: dict | None = None):
    reason = (data or {}).get("reason") or "manual"
    folder = create_full_backup(str(reason))
    return {"ok": True, "path": str(folder)}


@router.post("/backups/restore-database")
def api_restore_backup(data: dict, s: Session = Depends(session_dep)):
    backup_path = str(data.get("path") or "")
    if not backup_path:
        raise HTTPException(status_code=400, detail="missing backup path")
    try:
        rescue = restore_database_backup(backup_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "rescue_path": str(rescue)}


@router.post("/backups/recover-palaces")
def api_recover_palaces(data: dict, s: Session = Depends(session_dep)):
    commit = str(data.get("commit") or "").strip()
    raw_palace_ids = data.get("palace_ids")
    palace_ids = [
        _request_int(value)
        for value in (raw_palace_ids if isinstance(raw_palace_ids, list) else [])
        if value is not None
    ]
    if not commit or not palace_ids:
        raise HTTPException(status_code=400, detail="missing commit or palace_ids")
    result = recover_palaces_from_git_snapshot(s, commit, palace_ids)
    return {"ok": True, **result}


@router.post("/backups/restore-palace-from-backup")
def api_restore_palace_from_backup(data: dict, s: Session = Depends(session_dep)):
    backup_path = str(data.get("path") or "").strip()
    palace_id_raw = data.get("palace_id")
    palace_id = _request_int(palace_id_raw)
    if not backup_path or palace_id <= 0:
        raise HTTPException(status_code=400, detail="missing path or palace_id")
    result = restore_palace_from_backup(s, backup_db_path=backup_path, palace_id=palace_id)
    return {"ok": True, "restored": result}


@router.post("/backups/compare-palace-snapshots")
def api_compare_palace_snapshots(data: dict, s: Session = Depends(session_dep)):
    palace_id_raw = data.get("palace_id")
    palace_id = _request_int(palace_id_raw)
    version_id_raw = data.get("version_id")
    backup_path = str(data.get("backup_db_path") or data.get("path") or "").strip() or None
    version_id = _request_int(version_id_raw) or None
    if palace_id <= 0:
        raise HTTPException(status_code=400, detail="missing palace_id")
    try:
        result = export_palace_snapshot_comparison(
            s,
            palace_id=palace_id,
            version_id=version_id,
            backup_db_path=backup_path,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, **result}
