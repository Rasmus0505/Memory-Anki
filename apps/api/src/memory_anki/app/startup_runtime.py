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
from memory_anki.modules.english.application.startup import (
    prepare_english_runtime,
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


def _run_review_scheduler_switch() -> None:
    """Backfill FSRS unit state once, with a rescue snapshot before writing.

    Hermetic Playwright runs seed their own fixtures and must not be rewritten
    by a production data migration.
    """
    if os.environ.get("MEMORY_ANKI_E2E") == "1":
        return
    from memory_anki.modules.backups.application.backup_lifecycle import (
        create_rescue_snapshot,
    )
    from memory_anki.modules.memory.application.review_scheduler_switch import (
        backfill_fsrs_scheduler,
    )
    from memory_anki.modules.memory.application.unit_review_service import (
        clamp_due_dates_for_sprint,
    )

    logger = __import__("logging").getLogger(__name__)
    session = get_session()
    try:
        summary = backfill_fsrs_scheduler(session, backup=create_rescue_snapshot)
        session.commit()
        if summary["changed_due"] or summary["with_history"]:
            clamp_result = clamp_due_dates_for_sprint(session)
            logger.info("review scheduler switch: %s clamp=%s", summary, clamp_result)
    except Exception:
        # The backfill is idempotent and leaves the marker unset on failure, so a
        # broken or half-migrated database must not stop the app from starting.
        # The next startup retries it.
        session.rollback()
        logger.exception("review scheduler switch failed; will retry on next startup")
    finally:
        session.close()


def run_prepare_runtime() -> StartupState:
    configure_logging()
    shared_state: dict[str, Any] = {}
    ensure_legacy_repo_data_migrated()
    init_db()
    # Alembic's fileConfig reconfigures the root logger while applying
    # migrations, so re-apply ours afterwards (see core.logging).
    configure_logging()
    _run_review_scheduler_switch()
    session = get_session()
    try:
        prepare_english_runtime(session)
        ensure_ai_model_catalog_seed(session)
        _seed_default_config_rows(session)
        session.commit()
        # Each device only deletes expired local cache rows; repeated cleanup is safe.
        purge_expired_mutation_responses(session)
        try:
            from memory_anki.infrastructure.llm.external_ai_call_logs import (
                prune_old_ai_call_log_files,
            )

            prune_old_ai_call_log_files()
        except Exception:
            # File retention is best-effort; never block startup.
            pass
    finally:
        session.close()
    runtime_info = build_runtime_info(shared_state, channel="prepare")
    return StartupState(
        mode=STARTUP_MODE_PREPARE,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )


def initialize_service_runtime(app: FastAPI, *, mode: str | None = None) -> StartupState:
    configure_logging()
    startup_mode = mode or resolve_startup_mode()
    shared_state: dict[str, Any] = {}
    ensure_legacy_repo_data_migrated()
    init_db()
    # Alembic's fileConfig reconfigures the root logger while applying
    # migrations, so re-apply ours afterwards (see core.logging).
    configure_logging()
    _run_review_scheduler_switch()
    runtime_info = build_runtime_info(shared_state)
    if startup_mode == STARTUP_MODE_SERVE:
        started_state = record_runtime_start(
            shared_state,
            channel=os.environ.get("MEMORY_ANKI_CHANNEL") or "production",
            commit=os.environ.get("MEMORY_ANKI_GIT_COMMIT"),
        )
        runtime_info = build_runtime_info(started_state)
        shared_state = started_state
    app.state.runtime_info = runtime_info
    app.state.startup_mode = startup_mode
    logger = __import__("logging").getLogger(__name__)
    logger.info(
        "Using database: %s (app_home=%s source=%s)",
        runtime_info.get("database_path") or runtime_info.get("app_home"),
        runtime_info.get("app_home"),
        runtime_info.get("app_home_source"),
    )
    for warning in runtime_info.get("alternate_home_warnings") or []:
        logger.warning("%s", warning.get("message") or warning)
    return StartupState(
        mode=startup_mode,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )
