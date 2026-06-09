from __future__ import annotations

from pathlib import Path

from memory_anki.core.config import ENGLISH_MEDIA_DIR, ENGLISH_TASKS_DIR

GENERATION_LOG_FILENAME = "generation-log.jsonl"


def task_dir(task_id: str) -> Path:
    return ENGLISH_TASKS_DIR / task_id


def course_dir(course_id: int) -> Path:
    return ENGLISH_MEDIA_DIR / f"course-{course_id}"


def task_log_path(task_id: str) -> Path:
    return task_dir(task_id) / GENERATION_LOG_FILENAME


def course_log_path(course_id: int) -> Path:
    return course_dir(course_id) / GENERATION_LOG_FILENAME
