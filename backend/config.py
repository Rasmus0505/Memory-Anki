from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # 项目根目录
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "memory_palace.db"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
BACKUPS_DIR = DATA_DIR / "backups"
FULL_BACKUPS_DIR = BACKUPS_DIR / "full"
RESCUE_BACKUPS_DIR = BACKUPS_DIR / "rescue"

DATA_DIR.mkdir(parents=True, exist_ok=True)
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
FULL_BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
RESCUE_BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

# 默认配置
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
}
