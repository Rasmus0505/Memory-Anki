from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, Subject
from memory_anki.modules.backups.application.backup_service import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    create_effective_palace_version,
    is_dangerous_structure_change,
)
from memory_anki.modules.mindmap.application.editor_state_documents import (
    DEFAULT_EDITOR_CONFIG,
    DEFAULT_EDITOR_LOCAL_CONFIG,
    EDITOR_FINGERPRINT_KEY,
    build_editor_state_fingerprint,
    build_palace_editor_doc,
    build_subject_editor_doc,
    coerce_editor_local_config,
    deserialize_editor_payload,
    ensure_editor_dict,
    extract_editor_lang,
    normalize_editor_doc,
    sanitize_palace_editor_doc,
    serialize_editor_payload,
)
from memory_anki.modules.mindmap.application.editor_state_tree_sync import (
    sync_palace_tree_from_doc,
    sync_subject_tree_from_doc,
)

SAFE_EXPLICIT_OVERWRITE_SOURCES = {"palace_edit", "version_restore", "backup_restore", "import_apply"}
DANGEROUS_AUTOSAVE_SOURCES = {"palace_edit_autosave", "host_bootstrap_sync"}
DANGEROUS_EDITOR_SOURCES = {"review_edit", "practice_edit", "unknown"}


class EditorStateConflictError(ValueError):
    pass


def get_subject_editor_state(subject: Subject) -> dict[str, Any]:
    return _build_editor_state(
        stored_doc=subject.editor_doc,
        stored_config=subject.editor_config,
        stored_local_config=subject.editor_local_config,
        root_text=subject.name,
        root_kind="subject",
        build_default_doc=lambda: build_subject_editor_doc(subject),
    )


def get_palace_editor_state(palace: Palace) -> dict[str, Any]:
    return _build_editor_state(
        stored_doc=palace.editor_doc,
        stored_config=palace.editor_config,
        stored_local_config=palace.editor_local_config,
        root_text=palace.title,
        root_kind="palace",
        build_default_doc=lambda: build_palace_editor_doc(palace),
        sanitize_doc=lambda doc: sanitize_palace_editor_doc(palace, doc),
    )


def save_subject_editor_state(session: Session, subject: Subject, payload: dict[str, Any]) -> dict[str, Any]:
    doc_input = payload.get("editor_doc")
    config_input = payload.get("editor_config")
    local_input = payload.get("editor_local_config")
    lang_input = payload.get("lang")
    _assert_expected_fingerprint(
        current_fingerprint=get_subject_editor_state(subject).get(EDITOR_FINGERPRINT_KEY),
        expected_fingerprint=str(payload.get("expected_editor_fingerprint") or "").strip(),
        allow_stale_overwrite=bool(payload.get("allow_stale_overwrite")),
    )

    local_config = _resolve_local_config(subject.editor_local_config, local_input, lang_input)

    if doc_input is not None:
        doc = normalize_editor_doc(doc_input, root_text=subject.name, root_kind="subject")
        sync_subject_tree_from_doc(session, subject, doc)
        subject.editor_doc = serialize_editor_payload(doc)
    if config_input is not None:
        subject.editor_config = serialize_editor_payload(ensure_editor_dict(config_input))
    if local_config is not None:
        subject.editor_local_config = serialize_editor_payload(local_config)

    session.commit()
    session.refresh(subject)
    return get_subject_editor_state(subject)


def save_palace_editor_state(session: Session, palace: Palace, payload: dict[str, Any]) -> dict[str, Any]:
    doc_input = payload.get("editor_doc")
    config_input = payload.get("editor_config")
    local_input = payload.get("editor_local_config")
    lang_input = payload.get("lang")
    allow_dangerous_delete = bool(payload.get("confirm_dangerous_change"))
    editor_source = str(payload.get("editor_source") or "unknown").strip() or "unknown"
    sync_reason = str(payload.get("sync_reason") or "").strip() or None
    allow_stale_overwrite = bool(payload.get("allow_stale_overwrite"))
    _assert_expected_fingerprint(
        current_fingerprint=get_palace_editor_state(palace).get(EDITOR_FINGERPRINT_KEY),
        expected_fingerprint=str(payload.get("expected_editor_fingerprint") or "").strip(),
        allow_stale_overwrite=allow_stale_overwrite,
    )

    local_config = _resolve_local_config(palace.editor_local_config, local_input, lang_input)

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
            raise ValueError("当前编辑内容来自复习/练习视图或未确认同步态，已拒绝写回宫殿，避免未显示节点被误删。")
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
            raise ValueError("检测到危险结构变更：新导图节点数骤减，已拒绝保存。请在正式编辑中确认后再执行。")
        sync_palace_tree_from_doc(session, palace, doc)
        palace.editor_doc = serialize_editor_payload(doc)
    if config_input is not None:
        palace.editor_config = serialize_editor_payload(ensure_editor_dict(config_input))
    if local_config is not None:
        palace.editor_local_config = serialize_editor_payload(local_config)

    create_effective_palace_version(session, palace, "editor_save")

    session.commit()
    session.refresh(palace)
    return get_palace_editor_state(palace)


def sync_subject_editor_root(subject: Subject) -> None:
    _sync_editor_root(subject, root_text=subject.name, root_kind="subject")


def sync_palace_editor_root(palace: Palace) -> None:
    _sync_editor_root(palace, root_text=palace.title, root_kind="palace")


def _build_editor_state(
    *,
    stored_doc: Any,
    stored_config: Any,
    stored_local_config: Any,
    root_text: str,
    root_kind: str,
    build_default_doc,
    sanitize_doc=None,
) -> dict[str, Any]:
    local_config = deserialize_editor_payload(stored_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    lang = extract_editor_lang(local_config)
    doc = deserialize_editor_payload(stored_doc, None)
    if not isinstance(doc, dict):
        doc = build_default_doc()
    else:
        doc = normalize_editor_doc(doc, root_text=root_text, root_kind=root_kind)
        if sanitize_doc is not None:
            doc = sanitize_doc(doc)
    state = {
        "editor_doc": doc,
        "editor_config": deserialize_editor_payload(stored_config, DEFAULT_EDITOR_CONFIG),
        "editor_local_config": local_config,
        "lang": lang,
    }
    state[EDITOR_FINGERPRINT_KEY] = build_editor_state_fingerprint(state)
    return state


def _assert_expected_fingerprint(
    *,
    current_fingerprint: Any,
    expected_fingerprint: str,
    allow_stale_overwrite: bool,
) -> None:
    if expected_fingerprint and not allow_stale_overwrite and current_fingerprint != expected_fingerprint:
        raise EditorStateConflictError("脑图保存冲突：服务端已有更新，本机待处理内容已保留，请确认后再覆盖。")


def _resolve_local_config(stored_local_config: Any, local_input: Any, lang_input: Any) -> dict[str, Any]:
    if local_input is not None or lang_input is not None:
        return coerce_editor_local_config(local_input, lang_input)
    return deserialize_editor_payload(stored_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)


def _sync_editor_root(entity: Subject | Palace, *, root_text: str, root_kind: str) -> None:
    doc = deserialize_editor_payload(entity.editor_doc, None)
    if not isinstance(doc, dict):
        return
    normalized = normalize_editor_doc(doc, root_text=root_text, root_kind=root_kind)
    entity.editor_doc = serialize_editor_payload(normalized)
