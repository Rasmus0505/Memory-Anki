"""Log reuse helpers for child-chapter grouping flows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, ExternalAiCallLog
from memory_anki.infrastructure.llm.external_ai_call_logs import get_external_ai_call_log

from ._question_utils import (
    extract_mini_palace_grouping_payload as _extract_mini_palace_grouping_payload,
)
from .quiz_generation_child_chapter_context import flatten_child_chapter_contexts
from .quiz_generation_child_chapter_preview import (
    build_group_questions_by_child_chapter_preview,
)


def _iter_candidate_grouping_logs(
    session: Session,
    *,
    source_log_id: str,
):
    source_log = session.query(ExternalAiCallLog).filter_by(id=source_log_id).first()
    if not source_log or source_log.created_at is None:
        return []
    return (
        session.query(ExternalAiCallLog)
        .filter(ExternalAiCallLog.operation == "palace_quiz_group_by_child_chapter")
        .filter(ExternalAiCallLog.status == "success")
        .filter(ExternalAiCallLog.created_at >= source_log.created_at)
        .order_by(ExternalAiCallLog.created_at.asc(), ExternalAiCallLog.id.asc())
        .limit(12)
        .all()
    )


def _payload_matches_child_chapter_request(
    *,
    model_input: dict[str, Any],
    drafts: list[dict[str, object]],
    expected_child_ids: set[int],
) -> bool:
    questions = model_input.get("questions")
    mini_palaces = model_input.get("mini_palaces")
    if not isinstance(questions, list) or len(questions) != len(drafts):
        return False
    if not isinstance(mini_palaces, list):
        return False
    mini_palace_ids = {
        int(item.get("mini_palace_id"))
        for item in mini_palaces
        if isinstance(item, dict) and item.get("mini_palace_id") is not None
    }
    return mini_palace_ids == expected_child_ids


def reuse_grouped_child_chapter_questions_from_log(
    session: Session,
    *,
    ai_call_log_id: str,
    selected_chapter: Chapter,
    drafts: list[dict[str, object]],
) -> dict[str, object] | None:
    candidate_rows = _iter_candidate_grouping_logs(
        session,
        source_log_id=ai_call_log_id,
    )
    expected_child_ids = {child.id for child in selected_chapter.children or []}
    child_contexts = flatten_child_chapter_contexts(selected_chapter)
    for row in candidate_rows:
        payload = get_external_ai_call_log(session, row.id)
        if not payload:
            continue
        request_payload = payload.get("request_payload") or {}
        model_input = request_payload.get("model_input") if isinstance(request_payload, dict) else {}
        if not isinstance(model_input, dict):
            continue
        if not _payload_matches_child_chapter_request(
            model_input=model_input,
            drafts=drafts,
            expected_child_ids=expected_child_ids,
        ):
            continue
        response_payload = payload.get("response_payload") or {}
        response_text = str(response_payload.get("response_text") or "").strip()
        if not response_text:
            continue
        grouping_payload = _extract_mini_palace_grouping_payload(response_text)
        return build_group_questions_by_child_chapter_preview(
            drafts=drafts,
            child_contexts=child_contexts,
            grouping_payload=grouping_payload,
        )
    return None


__all__ = ["reuse_grouped_child_chapter_questions_from_log"]
