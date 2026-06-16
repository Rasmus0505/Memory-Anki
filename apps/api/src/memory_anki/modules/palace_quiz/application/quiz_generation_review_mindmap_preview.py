"""Preview normalization for review-mindmap quiz generation."""

from __future__ import annotations

from typing import Any

from ._question_utils import (
    finalize_generation_source_meta,
    normalize_generated_question_drafts,
)
from .quiz_generation_preview_result import build_quiz_generation_preview_result
from .quiz_generation_review_mindmap_request import ReviewMindmapPreparedRequest


def build_review_mindmap_preview_result(
    *,
    prepared_request: ReviewMindmapPreparedRequest,
    palace_id: int,
    response_text: str,
    log_id: str,
) -> dict[str, Any]:
    source_meta = prepared_request.source_meta
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=None,
        resolved_ai=prepared_request.resolved_ai,
        extra_fields={"related_palace_summaries": prepared_request.related_summaries},
    )


__all__ = ["build_review_mindmap_preview_result"]
