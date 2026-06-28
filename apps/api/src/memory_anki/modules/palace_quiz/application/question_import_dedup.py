from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import json_load


def _normalize_import_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"\s+", "", text)
    return text.strip().lower()


def build_import_dedup_key(payload: dict[str, Any]) -> str:
    options = payload.get("options") or []
    option_text = ""
    if isinstance(options, list):
        option_text = "|".join(
            f"{_normalize_import_text(item.get('id') if isinstance(item, dict) else '')}:"
            f"{_normalize_import_text(item.get('text') if isinstance(item, dict) else item)}"
            for item in options
        )
    return "|".join(
        [
            str(payload.get("question_type") or ""),
            _normalize_import_text(payload.get("stem")),
            option_text,
        ]
    )


def question_row_to_import_dedup_key(question: PalaceQuizQuestion) -> str:
    return build_import_dedup_key(
        {
            "question_type": question.question_type,
            "stem": question.stem,
            "options": json_load(question.options_json, []),
        }
    )


def build_existing_import_dedup_keys(
    session: Session,
    *,
    exclude_question_ids: set[int] | None = None,
) -> set[str]:
    excluded_ids = exclude_question_ids or set()
    return {
        question_row_to_import_dedup_key(question)
        for question in session.query(PalaceQuizQuestion).all()
        if question.id not in excluded_ids
    }


def filter_global_duplicate_import_questions(
    session: Session,
    questions: list[dict[str, Any]],
    warnings: list[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    existing_keys = build_existing_import_dedup_keys(session)
    seen_keys: set[str] = set()
    filtered: list[dict[str, Any]] = []
    skipped_count = 0
    resolved_warnings = warnings if warnings is not None else []
    for index, question in enumerate(questions, start=1):
        key = build_import_dedup_key(question)
        if key in existing_keys or key in seen_keys:
            skipped_count += 1
            resolved_warnings.append(f"第 {index} 题与现有题库重复，已按题干和选项跳过。")
            continue
        seen_keys.add(key)
        filtered.append(question)
    return filtered, skipped_count


__all__ = [
    "build_existing_import_dedup_keys",
    "build_import_dedup_key",
    "filter_global_duplicate_import_questions",
    "question_row_to_import_dedup_key",
]
