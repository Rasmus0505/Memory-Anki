from __future__ import annotations

from typing import Any, cast

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Subject
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

from .editor_document_projection import build_subject_editor_doc
from .editor_tree_sync import sync_subject_tree_from_doc


def get_subject_editor_state(subject: Subject) -> dict[str, Any]:
    return build_editor_state(
        stored_doc=subject.editor_doc,
        stored_config=subject.editor_config,
        stored_local_config=subject.editor_local_config,
        root_text=subject.name,
        root_kind="subject",
        build_default_doc=lambda: build_subject_editor_doc(subject),
    )


def save_subject_editor_state(
    session: Session,
    subject: Subject,
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
    current_state = get_subject_editor_state(subject)
    try:
        assert_expected_fingerprint(
            current_fingerprint=current_state.get(EDITOR_FINGERPRINT_KEY),
            expected_fingerprint=str(payload.get("expected_editor_fingerprint") or "").strip(),
            allow_stale_overwrite=bool(payload.get("allow_stale_overwrite")),
        )
    except EditorStateConflictError as exc:
        exc.current_snapshot = current_state.get("snapshot")
        raise

    local_config = resolve_local_config(subject.editor_local_config, local_input, lang_input)

    if doc_input is not None:
        doc = normalize_editor_doc(doc_input, root_text=subject.name, root_kind="subject")
        sync_subject_tree_from_doc(session, subject, doc)
        subject.editor_doc = serialize_editor_payload(doc)
    if config_input is not None:
        subject.editor_config = serialize_editor_payload(ensure_editor_dict(config_input))
    if local_config is not None:
        subject.editor_local_config = serialize_editor_payload(local_config)

    transaction.commit()
    transaction.refresh(subject)
    return get_subject_editor_state(subject)


def sync_subject_editor_root(subject: Subject) -> None:
    payload = sync_editor_root_payload(
        subject.editor_doc, root_text=subject.name, root_kind="subject"
    )
    if payload is not None:
        subject.editor_doc = payload


__all__ = [
    "EditorStateConflictError",
    "get_subject_editor_state",
    "save_subject_editor_state",
    "sync_subject_editor_root",
]
