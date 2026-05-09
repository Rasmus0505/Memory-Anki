from __future__ import annotations

import os
from pathlib import Path


def _default_app_home() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MemoryAnki"
    return Path.home() / "AppData" / "Local" / "MemoryAnki"


REPO_ROOT = Path(__file__).resolve().parents[5]
LEGACY_DATA_DIR = REPO_ROOT / "data"
APP_HOME = Path(os.environ.get("MEMORY_ANKI_HOME") or _default_app_home())
DATA_DIR = APP_HOME / "data"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
BACKUPS_DIR = DATA_DIR / "backups"
FULL_BACKUPS_DIR = BACKUPS_DIR / "full"
RESCUE_BACKUPS_DIR = BACKUPS_DIR / "rescue"
DB_PATH = DATA_DIR / "memory_palace.db"
MIGRATION_STATE_PATH = APP_HOME / "migration-state.json"
DATABASE_URL = f"sqlite:///{DB_PATH}"

DEFAULTS = {
    "default_algorithm": "ebbinghaus",
    "default_review_mode": "flashcard",
    "custom_intervals": "1,2,4,7,15,30,60",
    "algorithm_change_scope": "future_only",
    "sleep_review_time": "22:00",
    "early_review_anchor": "true",
    "ebbinghaus_intervals": "1h,sleep,1,2,4,7,15,30,60",
    "daily_max_reviews": "0",
    "mastered_interval": "180",
    "auto_smooth_overdue": "true",
    "overdue_smoothing_days": "7",
    "overdue_smoothing_threshold": "5",
    "time_recording_threshold_seconds": "0",
}


def ensure_runtime_dirs() -> None:
    for directory in (APP_HOME, DATA_DIR, ATTACHMENTS_DIR, FULL_BACKUPS_DIR, RESCUE_BACKUPS_DIR):
        directory.mkdir(parents=True, exist_ok=True)
