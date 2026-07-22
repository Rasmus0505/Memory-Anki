from __future__ import annotations

from typing import Any

JOB_STATUS_DRAFT = "draft"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_PAUSED = "paused"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_INTERRUPTED = "interrupted"

JOB_STAGE_PREPARED = "prepared"
JOB_STAGE_STRUCTURE = "structure"
JOB_STAGE_OCR = "ocr"
JOB_STAGE_MERGE = "merge"
JOB_STAGE_TEXT = "text"
JOB_STAGE_COMPLETED = "completed"

SOURCE_KIND_IMAGE_SINGLE = "image-single"
SOURCE_KIND_IMAGE_BATCH = "image-batch"
SOURCE_KIND_PDF_DOCUMENT = "pdf-document"

MODE_MINDMAP = "mindmap"
MODE_TEXT = "text"

UNSET = object()


def empty_progress() -> dict[str, Any]:
    return {
        "phase": "",
        "message": "",
        "step": None,
        "total_steps": None,
        "preview_text": "",
    }


def empty_usage() -> dict[str, int]:
    return {
        "structure": 0,
        "ocr": 0,
        "merge": 0,
        "text": 0,
        "total": 0,
    }
