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
    command.upgrade(build_alembic_config(), "head")
