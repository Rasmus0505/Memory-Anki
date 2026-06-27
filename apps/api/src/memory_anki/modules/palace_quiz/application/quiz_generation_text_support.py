"""Support utilities for text-file quiz generation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .question_contracts import PalaceQuizValidationError

TEXT_FILE_EXTENSIONS = {".txt", ".md", ".markdown", ".json"}
TEXT_FILE_DECODE_ENCODINGS = ("utf-8", "utf-8-sig", "utf-16", "gb18030")


def normalize_text_file_extension(filename: str | None) -> str:
    return Path(str(filename or "")).suffix.lower()


def validate_text_file_upload(*, filename: str | None, content: bytes) -> str:
    extension = normalize_text_file_extension(filename)
    if extension not in TEXT_FILE_EXTENSIONS:
        raise PalaceQuizValidationError("仅支持上传 txt、md、markdown、json 文本文件。")
    if not content:
        raise PalaceQuizValidationError("未读取到文本文件内容。")
    return extension


def decode_text_file_content(content: bytes) -> str:
    for encoding in TEXT_FILE_DECODE_ENCODINGS:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise PalaceQuizValidationError("文本文件编码无法识别。")


def build_text_file_artifact(
    *,
    filename: str | None,
    mime_type: str | None,
    content: bytes,
) -> dict[str, Any]:
    extension = validate_text_file_upload(filename=filename, content=content)
    return {
        "filename": str(filename or "untitled" + extension),
        "extension": extension,
        "mime_type": str(mime_type or "text/plain"),
        "decoded_text": decode_text_file_content(content),
    }


def parse_json_text_or_none(text: str) -> dict[str, Any] | list[Any] | None:
    normalized = str(text or "").strip()
    if not normalized:
        return None
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, (dict, list)):
        return parsed
    return None


def is_standard_questions_payload(parsed: object) -> bool:
    return isinstance(parsed, dict) and isinstance(parsed.get("questions"), list)


def is_candidate_questions_payload(parsed: object) -> bool:
    if not isinstance(parsed, dict):
        return False
    return isinstance(parsed.get("question_candidates"), list) and isinstance(
        parsed.get("answer_candidates"), list
    )


__all__ = [
    "TEXT_FILE_DECODE_ENCODINGS",
    "TEXT_FILE_EXTENSIONS",
    "build_text_file_artifact",
    "decode_text_file_content",
    "is_candidate_questions_payload",
    "is_standard_questions_payload",
    "normalize_text_file_extension",
    "parse_json_text_or_none",
    "validate_text_file_upload",
]
