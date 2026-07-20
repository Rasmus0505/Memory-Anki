from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from sqlalchemy.orm import Session

from memory_anki.core.config import DEFAULTS
from memory_anki.core.logging import configure_logging
from memory_anki.core.migration import ensure_legacy_repo_data_migrated
from memory_anki.core.runtime import build_runtime_info, record_runtime_start
from memory_anki.infrastructure.db._tables._base import get_session, init_db
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.backups.application.backup_lifecycle import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
from memory_anki.modules.english.application.startup import (
    prepare_english_runtime,
)
from memory_anki.modules.english_reading.application.startup import (
    prepare_english_reading,
)
from memory_anki.modules.sessions.api import (
    ensure_review_log_study_sessions,
    reclassify_ghost_formal_review_time_sessions,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    ensure_ai_model_catalog_seed,
)
from memory_anki.platform.persistence import purge_expired_mutation_responses

STARTUP_MODE_PREPARE = "prepare"
STARTUP_MODE_SERVE = "serve"
STARTUP_MODE_HEALTHCHECK = "healthcheck"
SUPPORTED_STARTUP_MODES = {
    STARTUP_MODE_PREPARE,
    STARTUP_MODE_SERVE,
    STARTUP_MODE_HEALTHCHECK,
}


@dataclass(frozen=True, slots=True)
class StartupState:
    mode: str
    shared_state: dict[str, Any]
    runtime_info: dict


def resolve_startup_mode() -> str:
    mode = str(os.environ.get("MEMORY_ANKI_STARTUP_MODE") or STARTUP_MODE_SERVE).strip().lower()
    if mode not in SUPPORTED_STARTUP_MODES:
        return STARTUP_MODE_SERVE
    return mode


def _seed_default_config_rows(session: Session) -> None:
    for key, value in DEFAULTS.items():
        existing = session.query(Config).filter_by(key=key).first()
        if not existing:
            session.add(Config(key=key, value=value))


def run_prepare_runtime() -> StartupState:
    configure_logging()
    shared_state: dict[str, Any] = {}
    ensure_legacy_repo_data_migrated()
    init_db()
    session = get_session()
    try:
        prepare_english_runtime(session)
        prepare_english_reading(session)
        ensure_ai_model_catalog_seed(session)
        _seed_default_config_rows(session)
        session.commit()
        # Each device only deletes expired local cache rows; repeated cleanup is safe.
        purge_expired_mutation_responses(session)
        ensure_review_log_study_sessions(session)
        reclassify_ghost_formal_review_time_sessions(session)
        session.commit()
        ensure_daily_backup()
        maybe_create_periodic_backup()
    finally:
        session.close()
    runtime_info = build_runtime_info(shared_state, channel="prepare")
    return StartupState(
        mode=STARTUP_MODE_PREPARE,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )


def _heal_study_session_data() -> None:
    """Idempotent startup heals that must run on existing devices (serve path)."""
    session = get_session()
    try:
        ensure_review_log_study_sessions(session)
        if reclassify_ghost_formal_review_time_sessions(session):
            session.commit()
        else:
            session.commit()
    finally:
        session.close()


def initialize_service_runtime(app: FastAPI, *, mode: str | None = None) -> StartupState:
    configure_logging()
    startup_mode = mode or resolve_startup_mode()
    shared_state: dict[str, Any] = {}
    ensure_legacy_repo_data_migrated()
    init_db()
    runtime_info = build_runtime_info(shared_state)
    if startup_mode == STARTUP_MODE_SERVE:
        # Existing installs skip prepare; still rewrite ghost review timer rows.
        _heal_study_session_data()
        started_state = record_runtime_start(
            shared_state,
            channel=os.environ.get("MEMORY_ANKI_CHANNEL") or "production",
            commit=os.environ.get("MEMORY_ANKI_GIT_COMMIT"),
        )
        runtime_info = build_runtime_info(started_state)
        shared_state = started_state
    app.state.runtime_info = runtime_info
    app.state.startup_mode = startup_mode
    return StartupState(
        mode=startup_mode,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )
