"""Shared result projection helpers for quiz-generation preview flows."""

from __future__ import annotations

from typing import Any


def build_quiz_generation_preview_result(
    *,
    scope_key: str,
    scope_id: int,
    questions: list[dict[str, Any]],
    source_meta: dict[str, Any],
    log_id: str,
    warnings: list[str],
    generation_stats: dict[str, Any],
    grouped_questions: dict[str, Any] | None,
    resolved_ai: dict[str, Any] | None,
    extra_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        scope_key: scope_id,
        "questions": questions,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
        "grouped_questions": grouped_questions,
        "resolved_ai": resolved_ai,
    }
    if extra_fields:
        result.update(extra_fields)
    return result


__all__ = ["build_quiz_generation_preview_result"]
