from __future__ import annotations

import json
from typing import Any

from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion

from ..question_contracts import json_load


def _normalize_text_key(value: Any) -> str:
    return " ".join(str(value or "").split())


def _normalize_key_value(value: Any) -> Any:
    if isinstance(value, str):
        return _normalize_text_key(value)
    if isinstance(value, list):
        return [_normalize_key_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _normalize_key_value(item)
            for key, item in sorted(value.items(), key=lambda item: str(item[0]))
        }
    return value


def build_question_dedup_key(payload: dict[str, Any]) -> str:
    normalized_key_payload = {
        "mini_palace_id": payload.get("mini_palace_id"),
        "classified_chapter_id": payload.get("classified_chapter_id"),
        "question_type": payload.get("question_type"),
        "stem": _normalize_text_key(payload.get("stem")),
        "options": _normalize_key_value(payload.get("options") or []),
        "answer_payload": _normalize_key_value(payload.get("answer_payload") or {}),
        "analysis": _normalize_text_key(payload.get("analysis")),
    }
    return json.dumps(
        normalized_key_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def question_to_dedup_payload(question: PalaceQuizQuestion) -> dict[str, Any]:
    return {
        "mini_palace_id": question.mini_palace_id,
        "classified_chapter_id": question.classified_chapter_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": json_load(question.options_json, []),
        "answer_payload": json_load(question.answer_payload_json, {}),
        "analysis": question.analysis,
    }


__all__ = [
    "build_question_dedup_key",
    "question_to_dedup_payload",
]
