from __future__ import annotations

from typing import Any, cast

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.backups.api import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    create_effective_palace_version,
    is_dangerous_structure_change,
)
from memory_anki.modules.mindmap_document.api import (
    EDITOR_FINGERPRINT_KEY,
    EditorStateConflictError,
    assert_expected_fingerprint,
    build_editor_state,
    ensure_editor_dict,
    normalize_editor_doc,
    resolve_local_config,
    serialize_editor_payload,
    sync_editor_root_payload,
    unpack_editor_save_payload,
)
from memory_anki.platform.application import UnitOfWork

from .editor_document_projection import build_palace_editor_doc, sanitize_palace_editor_doc
from .editor_tree_sync import sync_palace_tree_from_doc

SAFE_EXPLICIT_OVERWRITE_SOURCES = {
    "palace_edit",
    "version_restore",
    "backup_restore",
    "import_apply",
}
DANGEROUS_AUTOSAVE_SOURCES = {"palace_edit_autosave", "host_bootstrap_sync"}
DANGEROUS_EDITOR_SOURCES = {"review_edit", "practice_edit", "unknown"}


def get_palace_editor_state(palace: Palace) -> dict[str, Any]:
    return build_editor_state(
        stored_doc=palace.editor_doc,
        stored_config=palace.editor_config,
        stored_local_config=palace.editor_local_config,
        root_text=palace.title,
        root_kind="palace",
        build_default_doc=lambda: build_palace_editor_doc(palace),
        sanitize_doc=lambda doc: sanitize_palace_editor_doc(palace, doc),
    )


def save_palace_editor_state(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork | None = None,
) -> dict[str, Any]:
    transaction = uow or cast(UnitOfWork, session)
    payload = unpack_editor_save_payload(payload)
    doc_input = payload.get("editor_doc")
    config_input = payload.get("editor_config")
    local_input = payload.get("editor_local_config")
    lang_input = payload.get("lang")
    allow_dangerous_delete = bool(payload.get("confirm_dangerous_change"))
    editor_source = str(payload.get("editor_source") or "unknown").strip() or "unknown"
    sync_reason = str(payload.get("sync_reason") or "").strip() or None
    allow_stale_overwrite = bool(payload.get("allow_stale_overwrite"))
    current_state = get_palace_editor_state(palace)
    try:
        assert_expected_fingerprint(
            current_fingerprint=current_state.get(EDITOR_FINGERPRINT_KEY),
            expected_fingerprint=str(payload.get("expected_editor_fingerprint") or "").strip(),
            allow_stale_overwrite=allow_stale_overwrite,
        )
    except EditorStateConflictError as exc:
        exc.current_snapshot = current_state.get("snapshot")
        raise

    local_config = resolve_local_config(palace.editor_local_config, local_input, lang_input)

    if doc_input is not None:
        existing_node_count = count_editor_doc_nodes(palace.editor_doc)
        doc = normalize_editor_doc(doc_input, root_text=palace.title, root_kind="palace")
        doc = sanitize_palace_editor_doc(palace, doc)
        next_node_count = count_editor_doc_nodes(doc)
        node_drop = existing_node_count - next_node_count
        stale_bootstrap_like_write = (
            editor_source in DANGEROUS_AUTOSAVE_SOURCES
            and existing_node_count >= MIN_DANGEROUS_NODE_COUNT
            and next_node_count < existing_node_count
            and node_drop >= max(3, existing_node_count // 4)
            and not allow_stale_overwrite
        )
        if stale_bootstrap_like_write:
            raise ValueError(
                "已阻止旧态覆盖当前宫殿：启动同步/自动保存写回的节点数明显少于当前库，请先完成恢复或显式确认覆盖。"
            )
        if editor_source in DANGEROUS_EDITOR_SOURCES and next_node_count < existing_node_count:
            raise ValueError(
                "当前编辑内容来自复习/练习视图或未确认同步态，已拒绝写回宫殿，避免未显示节点被误删。"
            )
        if editor_source not in SAFE_EXPLICIT_OVERWRITE_SOURCES and allow_dangerous_delete:
            raise ValueError("只有正式宫殿编辑器或受控恢复流程才能确认危险删除。")
        if (
            editor_source == "palace_edit_autosave"
            and sync_reason in {"host_bootstrap_sync", "initial_hydration"}
            and next_node_count < existing_node_count
            and not allow_stale_overwrite
        ):
            raise ValueError("已阻止旧态覆盖当前宫殿：首屏同步期间的自动保存仍在回放旧态。")
        if (
            is_dangerous_structure_change(existing_node_count, next_node_count)
            and not allow_dangerous_delete
            and not (allow_stale_overwrite and editor_source in SAFE_EXPLICIT_OVERWRITE_SOURCES)
        ):
            raise ValueError(
                "检测到危险结构变更：新导图节点数骤减，已拒绝保存。请在正式编辑中确认后再执行。"
            )
        sync_palace_tree_from_doc(session, palace, doc)
        palace.editor_doc = serialize_editor_payload(doc)
    if config_input is not None:
        palace.editor_config = serialize_editor_payload(ensure_editor_dict(config_input))
    if local_config is not None:
        palace.editor_local_config = serialize_editor_payload(local_config)

    create_effective_palace_version(session, palace, "editor_save")

    transaction.commit()
    transaction.refresh(palace)
    return get_palace_editor_state(palace)


def sync_palace_editor_root(palace: Palace) -> None:
    payload = sync_editor_root_payload(
        palace.editor_doc, root_text=palace.title, root_kind="palace"
    )
    if payload is not None:
        palace.editor_doc = payload


__all__ = [
    "EditorStateConflictError",
    "get_palace_editor_state",
    "save_palace_editor_state",
    "sync_palace_editor_root",
]
