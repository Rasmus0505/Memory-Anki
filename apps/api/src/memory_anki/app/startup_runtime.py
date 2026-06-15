from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import FastAPI
from sqlalchemy.orm import Session

from memory_anki.core.config import DEFAULTS
from memory_anki.core.logging import configure_logging
from memory_anki.core.migration import (
    ensure_legacy_repo_data_migrated,
    is_app_migration_completed,
    mark_app_migration_completed,
)
from memory_anki.core.runtime import (
    assert_runtime_compatible,
    build_runtime_info,
    load_runtime_contract,
    record_runtime_start,
)
from memory_anki.infrastructure.db.models import Config, get_session, init_db
from memory_anki.modules.backups.application.backup_service import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
from memory_anki.modules.english.application.startup import (
    prepare_english_runtime,
)
from memory_anki.modules.english_reading.application.startup import (
    prepare_english_reading,
)
from memory_anki.modules.reviews.application.review_execution_service import (
    repair_review_stage_progress,
)
from memory_anki.modules.reviews.application.schedule_service import (
    migrate_sm2_to_ebbinghaus,
    normalize_algorithm,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    ensure_ai_model_catalog_seed,
)
from memory_anki.modules.time_records.application.time_records_service import (
    ensure_review_log_time_records,
    normalize_time_record_event_timezones,
)

STARTUP_MODE_PREPARE = "prepare"
STARTUP_MODE_SERVE = "serve"
STARTUP_MODE_HEALTHCHECK = "healthcheck"
SUPPORTED_STARTUP_MODES = {
    STARTUP_MODE_PREPARE,
    STARTUP_MODE_SERVE,
    STARTUP_MODE_HEALTHCHECK,
}
REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY = "review_schedule_anchor_repair_v1"


@dataclass(frozen=True, slots=True)
class StartupState:
    mode: str
    runtime_contract: object
    shared_state: dict
    runtime_info: dict


def resolve_startup_mode() -> str:
    mode = str(os.environ.get("MEMORY_ANKI_STARTUP_MODE") or STARTUP_MODE_SERVE).strip().lower()
    if mode not in SUPPORTED_STARTUP_MODES:
        return STARTUP_MODE_SERVE
    return mode


def run_review_schedule_repair_migration(session: Session):
    if is_app_migration_completed(REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY):
        return None
    result = repair_review_stage_progress(session)
    mark_app_migration_completed(
        REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY,
        {
            "result": result,
        },
    )
    return result


def _seed_default_config_rows(session: Session) -> None:
    for key, value in DEFAULTS.items():
        existing = session.query(Config).filter_by(key=key).first()
        if not existing:
            session.add(Config(key=key, value=value))
        elif key == "default_algorithm":
            existing.value = normalize_algorithm(existing.value)


def run_prepare_runtime() -> StartupState:
    configure_logging()
    runtime_contract = load_runtime_contract()
    shared_state = assert_runtime_compatible(runtime_contract)
    ensure_legacy_repo_data_migrated()
    init_db()
    session = get_session()
    try:
        prepare_english_runtime(session)
        prepare_english_reading(session)
        ensure_ai_model_catalog_seed(session)
        _seed_default_config_rows(session)
        session.commit()
        migrate_sm2_to_ebbinghaus(session)
        ensure_review_log_time_records(session)
        normalize_time_record_event_timezones(session)
        run_review_schedule_repair_migration(session)
        ensure_daily_backup()
        maybe_create_periodic_backup()
    finally:
        session.close()
    runtime_info = build_runtime_info(runtime_contract, shared_state, channel="prepare")
    return StartupState(
        mode=STARTUP_MODE_PREPARE,
        runtime_contract=runtime_contract,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )


def initialize_service_runtime(app: FastAPI, *, mode: str | None = None) -> StartupState:
    configure_logging()
    startup_mode = mode or resolve_startup_mode()
    runtime_contract = load_runtime_contract()
    shared_state = assert_runtime_compatible(runtime_contract)
    ensure_legacy_repo_data_migrated()
    init_db()
    runtime_info = build_runtime_info(runtime_contract, shared_state)
    if startup_mode == STARTUP_MODE_SERVE:
        started_state = record_runtime_start(
            runtime_contract,
            shared_state,
            channel=os.environ.get("MEMORY_ANKI_CHANNEL") or "production",
            commit=os.environ.get("MEMORY_ANKI_GIT_COMMIT"),
        )
        runtime_info = build_runtime_info(runtime_contract, started_state)
        shared_state = started_state
    app.state.runtime_contract = runtime_contract
    app.state.runtime_info = runtime_info
    app.state.startup_mode = startup_mode
    return StartupState(
        mode=startup_mode,
        runtime_contract=runtime_contract,
        shared_state=shared_state,
        runtime_info=runtime_info,
    )
