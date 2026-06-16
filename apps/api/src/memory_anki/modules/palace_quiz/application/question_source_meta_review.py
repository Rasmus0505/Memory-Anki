from __future__ import annotations

from typing import Any

from .question_source_meta_shared import (
    normalize_non_empty_string_list,
    normalize_positive_int_list,
)


def normalize_review_source_meta(source_meta: dict[str, Any]) -> dict[str, Any]:
    question_count_raw = source_meta.get("question_count")
    try:
        question_count = (
            int(question_count_raw)
            if question_count_raw not in (None, "", 0, "0")
            else None
        )
    except (TypeError, ValueError):
        question_count = None
    related_palace_summaries = (
        [item for item in source_meta.get("related_palace_summaries") if isinstance(item, dict)]
        if isinstance(source_meta.get("related_palace_summaries"), list)
        else None
    )
    return {
        "review_mode": str(source_meta.get("review_mode") or "").strip() or None,
        "related_palace_ids": normalize_positive_int_list(source_meta.get("related_palace_ids")),
        "related_palace_summaries": related_palace_summaries,
        "question_types": normalize_non_empty_string_list(source_meta.get("question_types")),
        "question_count": question_count,
    }


__all__ = ["normalize_review_source_meta"]
