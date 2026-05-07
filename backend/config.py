from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # 项目根目录
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "memory_palace.db"
ATTACHMENTS_DIR = DATA_DIR / "attachments"

DATA_DIR.mkdir(parents=True, exist_ok=True)
ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

# 默认配置
DEFAULTS = {
    "default_algorithm": "ebbinghaus",
    "default_review_mode": "flashcard",
    "custom_intervals": "1,2,4,7,15,30,60",
    "sm2_initial_ease": "2.5",
    "sm2_min_ease": "1.3",
    "sm2_initial_interval": "1",
    "algorithm_change_scope": "future_only",
    "sleep_review_time": "22:00",
    "early_review_anchor": "true",
    "ebbinghaus_intervals": "1h,sleep,1,2,4,7,15,30,60",
    "daily_max_reviews": "0",
    "mastered_interval": "180",
}
