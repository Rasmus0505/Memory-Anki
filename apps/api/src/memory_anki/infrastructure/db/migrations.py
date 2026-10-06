from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


def _api_root() -> Path:
    return Path(__file__).resolve().parents[4]


def build_alembic_config() -> Config:
    api_root = _api_root()
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    return config


def run_migrations() -> None:
    from memory_anki.core.config import DB_PATH
    from memory_anki.infrastructure.db.migration_binding_guard import ensure_binding_migration_safe

    config = build_alembic_config()
    ensure_binding_migration_safe(config, DB_PATH)
    command.upgrade(config, "head")
