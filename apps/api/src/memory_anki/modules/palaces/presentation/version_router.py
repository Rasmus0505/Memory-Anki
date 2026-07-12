from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.api import (
    cleanup_and_list_palace_versions,
    get_palace_version_detail,
    list_palace_versions,
    restore_palace_version,
)
from memory_anki.modules.palaces.application.palace_serializer import palace_json
from memory_anki.modules.palaces.application.palace_service import get_palace
from memory_anki.modules.palaces.presentation.errors import raise_bad_request, raise_not_found

router = APIRouter()


@router.get("/palaces/{palace_id}/versions")
def api_list_palace_versions(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    removed_duplicates, versions = cleanup_and_list_palace_versions(s, palace.id)
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "removed_duplicates": removed_duplicates,
        "versions": versions,
    }


@router.get("/palaces/{palace_id}/versions/{version_id}")
def api_get_palace_version_detail(palace_id: int, version_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    detail = get_palace_version_detail(s, palace.id, version_id)
    if not detail:
        raise_not_found("version not found")
    return detail


@router.post("/palaces/{palace_id}/restore-version")
def api_restore_palace_version(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    version_id = int(data.get("version_id", 0))
    if version_id <= 0:
        raise_bad_request("invalid version id")
    restore_palace_version(s, palace, version_id)
    s.refresh(palace)
    return {
        "ok": True,
        "palace": palace_json(palace, s),
        "versions": list_palace_versions(s, palace.id),
    }
