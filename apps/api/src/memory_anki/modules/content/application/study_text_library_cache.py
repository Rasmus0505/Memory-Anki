"""In-memory copy of the palace and question text.

The startup script asks for this once, before the window opens. Later page reads
return the copy and do not open the database. English audio and subject images
are not part of this copy.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

STUDY_TEXT_TABLES = frozenset(
    {
        "palaces",
        "pegs",
        "palace_segments",
        "palace_mini_palaces",
        "subjects",
        "chapters",
        "palace_quiz_questions",
        "palace_quiz_question_node_bindings",
    }
)
LAUNCH_REUSE_SECONDS = 15.0

_lock = threading.Lock()
_ready = threading.Event()
_ready.set()
_snapshot: dict[str, Any] | None = None
_building = False
_finished_at = 0.0
_dirty = False
_refresh_scheduled = False
_listener_installed = False
_builder: Callable[[], dict[str, Any]] | None = None


def configure_study_text_library_builder(builder: Callable[[], dict[str, Any]]) -> None:
    global _builder
    _builder = builder


def reset_study_text_library_cache_for_test() -> None:
    global _snapshot, _building, _finished_at, _dirty, _refresh_scheduled, _builder
    with _lock:
        _snapshot = None
        _building = False
        _finished_at = 0.0
        _dirty = False
        _refresh_scheduled = False
        _ready.set()
    _builder = None


def read_prepared_study_text_library() -> dict[str, Any]:
    with _lock:
        if _snapshot is not None:
            return _snapshot
    return prepare_study_text_library(force=False)


def prepare_study_text_library(
    *,
    force: bool = False,
    max_age_seconds: float | None = None,
) -> dict[str, Any]:
    """Return the prepared text, building it at most once at a time."""
    global _snapshot, _building, _finished_at
    while True:
        with _lock:
            if _snapshot_is_fresh(force=force, max_age_seconds=max_age_seconds):
                assert _snapshot is not None
                return _snapshot
            if _building:
                waiting = True
            else:
                _start_build_locked()
                waiting = False
        if not waiting:
            break
        _ready.wait(timeout=180)
    try:
        payload = _call_builder()
    except Exception:
        with _lock:
            _building = False
            _ready.set()
        raise
    published = {**payload, "prepared_at": datetime.now(UTC).isoformat()}
    with _lock:
        write_landed_during_build = _dirty
        if not write_landed_during_build or _snapshot is None:
            _snapshot = published
            _finished_at = time.monotonic()
        _building = False
        _ready.set()
        current = _snapshot
    if write_landed_during_build:
        schedule_study_text_refresh()
    return current if current is not None else published


def remember_prepared_editor(palace_id: int, editor: dict[str, Any]) -> None:
    """Show this device's saved text immediately, without rereading the library."""
    global _snapshot
    if palace_id <= 0 or not isinstance(editor, dict):
        return
    with _lock:
        if _snapshot is None:
            return
        editors = []
        replaced = False
        for item in _snapshot.get("editors") or []:
            palace = item.get("palace") if isinstance(item, dict) else None
            if isinstance(palace, dict) and palace.get("id") == palace_id:
                editors.append(editor)
                replaced = True
            else:
                editors.append(item)
        if not replaced:
            editors.append(editor)
        _snapshot = {**_snapshot, "editors": editors}


def session_changes_study_text(session: Session) -> bool:
    for obj in (*session.new, *session.dirty, *session.deleted):
        if _table_name(obj) in STUDY_TEXT_TABLES:
            return True
    return False


def schedule_study_text_refresh() -> None:
    """Rebuild after a text edit, without making the save or the open page wait."""
    global _dirty, _refresh_scheduled
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    with _lock:
        _dirty = True
        if _refresh_scheduled:
            return
        _refresh_scheduled = True
    threading.Thread(
        target=_refresh_until_clean,
        name="memory-anki-study-text-refresh",
        daemon=True,
    ).start()


def start_study_text_prepare() -> threading.Thread | None:
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    thread = threading.Thread(
        target=_prepare_on_startup,
        name="memory-anki-study-text",
        daemon=True,
    )
    thread.start()
    return thread


def install_study_text_refresh_listener() -> None:
    global _listener_installed
    if _listener_installed:
        return
    _listener_installed = True
    event.listen(Session, "before_flush", _mark_study_text_write)
    event.listen(Session, "after_commit", _refresh_after_study_text_commit)
    event.listen(Session, "after_rollback", _clear_study_text_write)


def _snapshot_is_fresh(*, force: bool, max_age_seconds: float | None) -> bool:
    if _snapshot is None or _dirty:
        return False
    if not force:
        return True
    if max_age_seconds is None:
        return False
    return time.monotonic() - _finished_at <= max_age_seconds


def _start_build_locked() -> None:
    global _building, _dirty
    _building = True
    _dirty = False
    _ready.clear()


def _call_builder() -> dict[str, Any]:
    if _builder is None:
        raise RuntimeError("study text library builder is not configured")
    payload = _builder()
    if not isinstance(payload, dict):
        raise RuntimeError("study text library builder returned a non-object")
    return payload


def _prepare_on_startup() -> None:
    try:
        prepare_study_text_library(force=False)
    except Exception:
        logger.exception("study text prepare failed")


def _refresh_until_clean() -> None:
    global _refresh_scheduled
    try:
        while True:
            prepare_study_text_library(force=True, max_age_seconds=0)
            with _lock:
                if _dirty:
                    continue
                _refresh_scheduled = False
                return
    except Exception:
        logger.exception("study text refresh failed")
        with _lock:
            _refresh_scheduled = False


def _table_name(obj: object) -> str:
    table = getattr(obj, "__table__", None)
    name = getattr(table, "name", None)
    return name if isinstance(name, str) else ""


def _mark_study_text_write(session: Session, _flush_context: object, _instances: object) -> None:
    if session_changes_study_text(session):
        session.info["_study_text_dirty"] = True


def _refresh_after_study_text_commit(session: Session) -> None:
    if session.info.pop("_study_text_dirty", False):
        schedule_study_text_refresh()


def _clear_study_text_write(session: Session) -> None:
    session.info.pop("_study_text_dirty", None)
