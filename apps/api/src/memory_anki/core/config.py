from __future__ import annotations

import os
from pathlib import Path

from memory_anki.core.storage_layout import get_managed_storage_items


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
SUBJECT_DOCUMENTS_DIR = ATTACHMENTS_DIR / "subjects"
IMPORT_JOBS_DIR = APP_HOME / "import_jobs"
AI_CALL_LOGS_DIR = APP_HOME / "ai_call_logs"
VOICE_COACH_CACHE_DIR = APP_HOME / "voice_coach"
ENGLISH_DIR = APP_HOME / "english"
ENGLISH_MEDIA_DIR = ENGLISH_DIR / "media"
ENGLISH_TASKS_DIR = ENGLISH_DIR / "tasks"
ENGLISH_READING_DIR = APP_HOME / "english_reading"
ENGLISH_READING_LEXICON_DIR = ENGLISH_READING_DIR / "lexicon"
ENGLISH_READING_CEFR_PATH = ENGLISH_READING_LEXICON_DIR / "cefr.json"
REPO_ENGLISH_READING_CEFR_SOURCE = REPO_ROOT / "apps" / "shared" / "english-reading-cefr.json"
ENGLISH_READING_DEFAULT_CEFR_SOURCE = Path(
    os.environ.get("MEMORY_ANKI_CEFR_SOURCE") or REPO_ENGLISH_READING_CEFR_SOURCE
)
BACKUPS_DIR = DATA_DIR / "backups"
FULL_BACKUPS_DIR = BACKUPS_DIR / "full"
RESCUE_BACKUPS_DIR = BACKUPS_DIR / "rescue"
DB_PATH = DATA_DIR / "memory_palace.db"
MIGRATION_STATE_PATH = APP_HOME / "migration-state.json"
DATABASE_URL = f"sqlite:///{DB_PATH}"
WEB_DIST_DIR = Path(os.environ["MEMORY_ANKI_WEB_DIST"]) if os.environ.get("MEMORY_ANKI_WEB_DIST") else None

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY")
DASHSCOPE_BASE_URL = os.environ.get("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DASHSCOPE_TTS_BASE_URL = os.environ.get("DASHSCOPE_TTS_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
DASHSCOPE_ASR_MODEL = os.environ.get("DASHSCOPE_ASR_MODEL", "qwen3-asr-flash-filetrans")
DASHSCOPE_VISION_MODEL = os.environ.get("DASHSCOPE_VISION_MODEL", "qwen3-vl-flash")
DASHSCOPE_TEXT_MODEL = os.environ.get("DASHSCOPE_TEXT_MODEL", "qwen3.6-flash")
ENGLISH_TRANSLATION_MODEL = os.environ.get("ENGLISH_TRANSLATION_MODEL", "qwen-mt-flash")
ZHIPU_API_KEY = os.environ.get("ZHIPU_API_KEY")
ZHIPU_BASE_URL = os.environ.get("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")

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
    "import_pdf_quote_original_default": "true",
    "import_pdf_mount_leaf_only_default": "true",
    "import_pdf_preserve_emphasis_default": "true",
    "import_pdf_semantic_split_default": "true",
    "import_pdf_preserve_line_breaks_default": "true",
    "mindmap_ai_split_api_key": "",
    "mindmap_ai_split_base_url": "",
    "mindmap_ai_split_model": DASHSCOPE_TEXT_MODEL,
    "mindmap_ai_split_temperature": "0.2",
    "mindmap_ai_split_max_children": "5",
    "mindmap_ai_split_include_note": "true",
    "mindmap_ai_split_custom_instruction": "",
    "mindmap_ai_split_thinking_enabled": "false",
    "flow_voice_api_key": "",
    "flow_voice_base_url": "",
    "flow_voice_model": "cosyvoice-v3-flash",
    "flow_voice_voice": "longanyang",
    "flow_voice_format": "mp3",
    "flow_voice_sample_rate": "24000",
    "flow_voice_instruction": "",
    "flow_voice_thinking_enabled": "false",
    "ai_model_vision": DASHSCOPE_VISION_MODEL,
    "ai_model_vision_thinking_enabled": "false",
    "ai_model_text": DASHSCOPE_TEXT_MODEL,
    "ai_model_text_thinking_enabled": "false",
    "ai_model_quiz_text": DASHSCOPE_TEXT_MODEL,
    "ai_model_quiz_text_thinking_enabled": "false",
    "ai_model_quiz_mini_palace": "qwen-turbo",
    "ai_model_quiz_mini_palace_thinking_enabled": "false",
    "ai_model_translation": ENGLISH_TRANSLATION_MODEL,
    "ai_model_translation_thinking_enabled": "false",
    "ai_model_asr": DASHSCOPE_ASR_MODEL,
    "ai_model_asr_thinking_enabled": "false",
}


def ensure_runtime_dirs() -> None:
    directories = {
        APP_HOME,
        DATA_DIR,
        ATTACHMENTS_DIR,
        SUBJECT_DOCUMENTS_DIR,
        IMPORT_JOBS_DIR,
        AI_CALL_LOGS_DIR,
        VOICE_COACH_CACHE_DIR,
        ENGLISH_DIR,
        ENGLISH_MEDIA_DIR,
        ENGLISH_TASKS_DIR,
        ENGLISH_READING_DIR,
        ENGLISH_READING_LEXICON_DIR,
        FULL_BACKUPS_DIR,
        RESCUE_BACKUPS_DIR,
    }
    for item in get_managed_storage_items():
        if item.kind == "directory":
            directories.add(item.absolute_path(APP_HOME))
        else:
            directories.add(item.absolute_path(APP_HOME).parent)
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
