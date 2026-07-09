from __future__ import annotations

import re
import unicodedata
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion

from ..question_contracts import json_load
from .dedup_keys import build_question_dedup_key, question_to_dedup_payload


def find_duplicate_question(
    session: Session,
    palace_id: int | None,
    source_chapter_id: int | None,
    normalized_payload: dict[str, Any],
    *,
    exclude_question_id: int | None = None,
) -> PalaceQuizQuestion | None:
    duplicate_key = build_question_dedup_key(normalized_payload)
    query = session.query(PalaceQuizQuestion)
    if palace_id is not None:
        query = query.filter(
            PalaceQuizQuestion.palace_id == palace_id,
            PalaceQuizQuestion.mini_palace_id == normalized_payload["mini_palace_id"],
            PalaceQuizQuestion.deleted_at.is_(None),
        )
    else:
        query = query.filter(
            PalaceQuizQuestion.source_chapter_id == source_chapter_id,
            PalaceQuizQuestion.classified_chapter_id == normalized_payload["classified_chapter_id"],
            PalaceQuizQuestion.deleted_at.is_(None),
        )
    candidates = (
        query.order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc()).all()
    )
    for candidate in candidates:
        if exclude_question_id is not None and candidate.id == exclude_question_id:
            continue
        if build_question_dedup_key(question_to_dedup_payload(candidate)) == duplicate_key:
            return candidate
    return None


def _dedupe_questions(
    session: Session,
    *,
    rows: list[PalaceQuizQuestion],
) -> int:
    from .writes import merge_question_attempt_counters

    kept_by_key: dict[str, PalaceQuizQuestion] = {}
    removed_count = 0
    for row in rows:
        dedup_key = build_question_dedup_key(question_to_dedup_payload(row))
        existing = kept_by_key.get(dedup_key)
        if existing is None:
            kept_by_key[dedup_key] = row
            continue
        merge_question_attempt_counters(existing, row)
        now = utc_now_naive()
        existing.updated_at = now
        row.deleted_at = now
        row.updated_at = now
        removed_count += 1
    if removed_count:
        session.commit()
    return removed_count


def dedupe_palace_questions(session: Session, palace_id: int) -> int:
    from .queries import list_palace_dedup_rows

    return _dedupe_questions(
        session,
        rows=list_palace_dedup_rows(session, palace_id=palace_id),
    )


def dedupe_chapter_questions(session: Session, chapter_id: int) -> int:
    from .queries import list_chapter_dedup_rows

    return _dedupe_questions(
        session,
        rows=list_chapter_dedup_rows(session, chapter_id=chapter_id),
    )


def _normalize_import_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(
        str.maketrans(
            {
                "“": '"',
                "”": '"',
                "‘": "'",
                "’": "'",
                "（": "(",
                "）": ")",
                "，": ",",
                "。": ".",
                "；": ";",
                "：": ":",
                "？": "?",
                "！": "!",
            }
        )
    )
    text = text.replace('"', "").replace("'", "")
    text = re.sub(r"^\s*\d+\s*[.、．]\s*", "", text)
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
        for question in session.query(PalaceQuizQuestion)
        .filter(PalaceQuizQuestion.deleted_at.is_(None))
        .all()
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
    "build_question_dedup_key",
    "dedupe_chapter_questions",
    "dedupe_palace_questions",
    "filter_global_duplicate_import_questions",
    "find_duplicate_question",
    "question_row_to_import_dedup_key",
    "question_to_dedup_payload",
]
