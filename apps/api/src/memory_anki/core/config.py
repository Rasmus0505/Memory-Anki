from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings

from memory_anki.core.dotenv_compat import load_dotenv
from memory_anki.core.runtime_paths import REPO_ROOT, resolve_app_home
from memory_anki.core.storage_layout import get_managed_storage_items

load_dotenv()


# ---------------------------------------------------------------------------
# Environment-based settings (API keys, base URLs, model names)
# ---------------------------------------------------------------------------

class EnvSettings(BaseSettings):
    """All settings that come from environment variables or .env files."""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    # --- DashScope ---
    DASHSCOPE_API_KEY: str | None = None
    DASHSCOPE_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    DASHSCOPE_ASR_MODEL: str = "qwen3-asr-flash-filetrans"
    DASHSCOPE_VISION_MODEL: str = "qwen3-vl-flash"
    DASHSCOPE_OCR_MODEL: str = "qwen3.5-ocr"
    DASHSCOPE_TEXT_MODEL: str = "qwen3.6-flash"
    ENGLISH_TRANSLATION_MODEL: str = "qwen-mt-flash"

    # --- Zhipu ---
    ZHIPU_API_KEY: str | None = None
    ZHIPU_BASE_URL: str = "https://open.bigmodel.cn/api/paas/v4"

    # --- SiliconFlow ---
    SILICONFLOW_API_KEY: str | None = None
    SILICONFLOW_BASE_URL: str = "https://api.siliconflow.cn/v1"

    # --- DeepSeek ---
    DEEPSEEK_API_KEY: str | None = None
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"

    # --- Remote access auth (03-01) ---
    MEMORY_ANKI_API_TOKEN: str | None = None


# Singleton – created once at import time.
_env = EnvSettings()


def get_env_settings() -> EnvSettings:
    """Recommended entry point for new environment-backed settings access."""
    return _env


# Re-export each setting as a module-level constant so existing imports work
# unchanged (e.g. `from memory_anki.core.config import DASHSCOPE_API_KEY`).
# 【冻结】以下 re-export 仅为兼容存量 import，禁止新增条目；新字段经 get_env_settings() 访问。
DASHSCOPE_API_KEY = _env.DASHSCOPE_API_KEY
DASHSCOPE_BASE_URL = _env.DASHSCOPE_BASE_URL
DASHSCOPE_ASR_MODEL = _env.DASHSCOPE_ASR_MODEL
DASHSCOPE_VISION_MODEL = _env.DASHSCOPE_VISION_MODEL
DASHSCOPE_OCR_MODEL = _env.DASHSCOPE_OCR_MODEL
DASHSCOPE_TEXT_MODEL = _env.DASHSCOPE_TEXT_MODEL
ENGLISH_TRANSLATION_MODEL = _env.ENGLISH_TRANSLATION_MODEL
ZHIPU_API_KEY = _env.ZHIPU_API_KEY
ZHIPU_BASE_URL = _env.ZHIPU_BASE_URL
SILICONFLOW_API_KEY = _env.SILICONFLOW_API_KEY
SILICONFLOW_BASE_URL = _env.SILICONFLOW_BASE_URL
DEEPSEEK_API_KEY = _env.DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL = _env.DEEPSEEK_BASE_URL
MEMORY_ANKI_API_TOKEN = _env.MEMORY_ANKI_API_TOKEN


# ---------------------------------------------------------------------------
# Path / directory constants (computed from APP_HOME, not from env vars)
# ---------------------------------------------------------------------------


def _default_app_home() -> Path:
    from memory_anki.core.runtime_paths import default_app_home

    return default_app_home()


def _resolve_app_home() -> tuple[Path, str]:
    explicit_home = os.environ.get("MEMORY_ANKI_HOME")
    if not explicit_home:
        return _default_app_home(), "default"
    resolution = resolve_app_home()
    return resolution.app_home, resolution.source


LEGACY_DATA_DIR = REPO_ROOT / "data"
APP_HOME, APP_HOME_SOURCE = _resolve_app_home()
DATA_DIR = APP_HOME / "data"
ATTACHMENTS_DIR = DATA_DIR / "attachments"
SUBJECT_DOCUMENTS_DIR = ATTACHMENTS_DIR / "subjects"
IMPORT_JOBS_DIR = APP_HOME / "import_jobs"
PDF_LIBRARY_DIR = APP_HOME / "pdf_library"
AI_CALL_LOGS_DIR = APP_HOME / "ai_call_logs"
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


# ---------------------------------------------------------------------------
# Application defaults (string dict used as runtime settings seed)
# ---------------------------------------------------------------------------

DEFAULTS = {
    "default_review_mode": "flashcard",
    "sleep_review_time": "22:00",
    "early_review_anchor": "true",
    "ebbinghaus_intervals": "1h,sleep,1,2,4,7,15,30,60",
    "daily_max_reviews": "0",
    "mastered_interval": "180",
    "desired_retention": "0.90",
    "mastery_horizon_days": "60",
    "maximum_interval": "180",
    "learning_steps": "10m,1h",
    "relearning_steps": "10m,1h",
    "auto_smooth_overdue": "true",
    "overdue_smoothing_days": "7",
    "overdue_smoothing_threshold": "5",
    "mindmap_ai_split_api_key": "",
    "mindmap_ai_split_base_url": "",
    "mindmap_ai_split_model": DASHSCOPE_TEXT_MODEL,
    "mindmap_ai_split_temperature": "0.2",
    "mindmap_ai_split_max_children": "5",
    "mindmap_ai_split_include_note": "true",
    "mindmap_ai_split_custom_instruction": "",
    "mindmap_ai_split_thinking_enabled": "false",
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
    "scene_model_ai_split": DASHSCOPE_TEXT_MODEL,
    "scene_model_ai_split_thinking_enabled": "false",
    "scene_model_reading_lexical": DASHSCOPE_TEXT_MODEL,
    "scene_model_reading_lexical_thinking_enabled": "false",
    "scene_model_reading_sentence": DASHSCOPE_TEXT_MODEL,
    "scene_model_reading_sentence_thinking_enabled": "false",
    "scene_model_quiz_short_answer": DASHSCOPE_TEXT_MODEL,
    "scene_model_quiz_short_answer_thinking_enabled": "false",
    "scene_model_quiz_mini_palace": "qwen-turbo",
    "scene_model_quiz_mini_palace_thinking_enabled": "false",
    "scene_model_quiz_node_binding": DASHSCOPE_TEXT_MODEL,
    "scene_model_quiz_node_binding_thinking_enabled": "false",
    "scene_model_quiz_text_generation": DASHSCOPE_TEXT_MODEL,
    "scene_model_quiz_text_generation_thinking_enabled": "false",
    "scene_model_vision_image_mindmap": DASHSCOPE_OCR_MODEL,
    "scene_model_vision_image_mindmap_thinking_enabled": "false",
    "scene_model_vision_image_text": DASHSCOPE_OCR_MODEL,
    "scene_model_vision_image_text_thinking_enabled": "false",
    "scene_model_vision_batch_mindmap": DASHSCOPE_OCR_MODEL,
    "scene_model_vision_batch_mindmap_thinking_enabled": "false",
    "scene_model_quiz_image_generation": DASHSCOPE_OCR_MODEL,
    "scene_model_quiz_image_generation_thinking_enabled": "false",
    "scene_model_translation_course": ENGLISH_TRANSLATION_MODEL,
    "scene_model_translation_course_thinking_enabled": "false",
    "scene_model_translation_reading_sentence": ENGLISH_TRANSLATION_MODEL,
    "scene_model_translation_reading_sentence_thinking_enabled": "false",
    "scene_model_asr_course": DASHSCOPE_ASR_MODEL,
    "scene_model_asr_course_thinking_enabled": "false",
}


# ---------------------------------------------------------------------------
# Runtime directory bootstrap
# ---------------------------------------------------------------------------


def ensure_runtime_dirs() -> None:
    directories = {
        APP_HOME,
        DATA_DIR,
        ATTACHMENTS_DIR,
        SUBJECT_DOCUMENTS_DIR,
        IMPORT_JOBS_DIR,
        PDF_LIBRARY_DIR,
        AI_CALL_LOGS_DIR,
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
