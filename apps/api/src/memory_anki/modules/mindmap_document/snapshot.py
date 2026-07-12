from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .document import (
    DEFAULT_EDITOR_CONFIG,
    DEFAULT_EDITOR_LOCAL_CONFIG,
    EDITOR_FINGERPRINT_KEY,
    build_editor_state_fingerprint,
    coerce_editor_local_config,
    deserialize_editor_payload,
    extract_editor_lang,
    normalize_editor_doc,
    serialize_editor_payload,
)


class EditorStateConflictError(ValueError):
    def __init__(self, message: str, current_snapshot: dict[str, Any] | None = None):
        super().__init__(message)
        self.current_snapshot = current_snapshot


def build_editor_state(
    *,
    stored_doc: Any,
    stored_config: Any,
    stored_local_config: Any,
    root_text: str,
    root_kind: str,
    build_default_doc: Callable[[], dict[str, Any]],
    sanitize_doc: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
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
    state["snapshot"] = {
        "schemaVersion": 1,
        "document": doc,
        "editorPreferences": state["editor_config"],
        "localPreferences": local_config,
        "language": lang,
        "revision": state[EDITOR_FINGERPRINT_KEY],
    }
    return state


def assert_expected_fingerprint(
    *, current_fingerprint: Any, expected_fingerprint: str, allow_stale_overwrite: bool
) -> None:
    if (
        expected_fingerprint
        and not allow_stale_overwrite
        and current_fingerprint != expected_fingerprint
    ):
        raise EditorStateConflictError(
            "脑图保存冲突：服务端已有更新，本机待处理内容已保留，请确认后再覆盖。"
        )


def resolve_local_config(
    stored_local_config: Any, local_input: Any, lang_input: Any
) -> dict[str, Any]:
    if local_input is not None or lang_input is not None:
        return coerce_editor_local_config(local_input, lang_input)
    return deserialize_editor_payload(stored_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)


def sync_editor_root_payload(stored_doc: Any, *, root_text: str, root_kind: str) -> str | None:
    doc = deserialize_editor_payload(stored_doc, None)
    if not isinstance(doc, dict):
        return None
    return serialize_editor_payload(
        normalize_editor_doc(doc, root_text=root_text, root_kind=root_kind)
    )


def unpack_editor_save_payload(payload: dict[str, Any]) -> dict[str, Any]:
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, dict):
        return payload
    unpacked = dict(payload)
    unpacked["editor_doc"] = snapshot.get("document")
    unpacked["editor_config"] = snapshot.get("editorPreferences")
    unpacked["editor_local_config"] = snapshot.get("localPreferences")
    unpacked["lang"] = snapshot.get("language")
    unpacked["expected_editor_fingerprint"] = payload.get("baseRevision") or snapshot.get(
        "revision"
    )
    return unpacked
