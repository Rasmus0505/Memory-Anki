"""Persist existing palace quiz questions into grouped mini-palace copies."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)

from .quiz_grouping_ai_runtime import group_questions_by_mini_palaces
from .quiz_grouping_existing_question_apply import apply_grouped_question_copies
from .quiz_grouping_existing_question_request import (
    prepare_existing_question_grouping_request,
)


def classify_existing_quiz_questions_to_mini_palaces(
    session: Session,
    *,
    palace_id: int,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_existing_question_grouping_request(
        session,
        palace_id=palace_id,
        ai_options=ai_options,
    )
    grouped_preview, log_id, _resolved_ai = group_questions_by_mini_palaces(
        session,
        palace=prepared_request.palace,
        questions=prepared_request.source_payloads,
        operation="ai_prompt_palace_quiz_classify_existing_to_mini_palace",
        ai_options=prepared_request.ai_options,
    )
    created_or_updated, mini_palace_hit_counts = apply_grouped_question_copies(
        session,
        source_questions=prepared_request.source_questions,
        grouped_preview=grouped_preview,
    )
    session.commit()
    return {
        "palace_id": palace_id,
        "mini_palace_groups": mini_palace_hit_counts,
        "unassigned_count": len(grouped_preview.get("unassigned_questions") or []),
        "ai_call_log_id": log_id,
        "copied_question_count": created_or_updated,
    }


__all__ = ["classify_existing_quiz_questions_to_mini_palaces"]
