from __future__ import annotations

import copy
import json
from datetime import timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Chapter, Palace, PalaceVersion, Peg
from memory_anki.modules.backups.application.editor_safety import count_editor_doc_nodes

MAX_VERSION_COUNT = 50
EDITOR_SNAPSHOT_INTERVAL = timedelta(minutes=5)
MILESTONE_TRIGGER_REASONS = {
    "before-version-restore",
    "before-git-recovery",
    "before-backup-restore",
    "before-db-restore",
}


def deserialize_version_json(raw: str | None, fallback):
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
    trim_old_versions(session, palace.id)
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
    candidate_signature = build_version_signature_from_palace(palace)
    latest_version = get_latest_version(session, palace.id)
    if latest_version is None:
        return True
    if build_version_signature(latest_version) == candidate_signature:
        return False

    latest_editor_version = get_latest_editor_version(session, palace.id)
    if latest_editor_version is None or latest_editor_version.created_at is None:
        return True

    latest_editor_signature = build_version_signature(latest_editor_version)
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
        trim_old_versions(session, palace_id)
    return removed


def get_effective_palace_versions(session: Session, palace_id: int) -> list[PalaceVersion]:
    versions = list_versions_query(session, palace_id).all()
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
        if build_version_signature(last_kept) == build_version_signature(version):
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


def trim_old_versions(session: Session, palace_id: int) -> None:
    versions = list_versions_query(session, palace_id).all()
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
    from memory_anki.modules.mindmap.application.editor_state_documents import (
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
    editor_doc = deserialize_version_json(version.editor_doc, {})
    normalized_doc = normalize_editor_doc(editor_doc, root_text=version.title or "未命名宫殿", root_kind="palace")
    editor_config = deserialize_version_json(version.editor_config, DEFAULT_EDITOR_CONFIG)
    editor_local_config = deserialize_version_json(version.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
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


def list_versions_query(session: Session, palace_id: int):
    return (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
    )


def get_latest_version(session: Session, palace_id: int) -> PalaceVersion | None:
    return list_versions_query(session, palace_id).first()


def get_latest_editor_version(session: Session, palace_id: int) -> PalaceVersion | None:
    return (
        session.query(PalaceVersion)
        .filter_by(palace_id=palace_id, trigger_reason="editor_save")
        .order_by(PalaceVersion.created_at.desc(), PalaceVersion.id.desc())
        .first()
    )


def build_version_signature_from_palace(palace: Palace) -> tuple[str, str | None, str, str, str, str, str]:
    peg_snapshot = [
        {
            "id": peg.id,
            "parent_id": peg.parent_id,
            "name": peg.name,
            "content": peg.content,
            "sort_order": peg.sort_order,
        }
        for peg in sorted(collect_all_pegs(palace.pegs), key=lambda peg: (peg.sort_order, peg.id))
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


def build_version_signature(version: PalaceVersion) -> tuple[str, str | None, str, str, str, str, str]:
    return (
        version.title or "",
        version.created_at_value.isoformat() if version.created_at_value else None,
        version.editor_doc or "",
        version.editor_config or "",
        version.editor_local_config or "",
        version.peg_snapshot or "",
        version.chapter_snapshot or "",
    )


def collect_all_pegs(pegs: list[Peg]) -> list[Peg]:
    result: list[Peg] = []

    def walk(items: list[Peg]) -> None:
        for peg in items:
            result.append(peg)
            walk(list(peg.children or []))

    walk(list(pegs or []))
    return result
