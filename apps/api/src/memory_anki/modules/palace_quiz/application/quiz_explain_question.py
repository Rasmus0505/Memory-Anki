"""General AI explanation service for palace quiz questions."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
)
from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .question_contracts import PalaceQuizValidationError, json_load
from .question_lookup_queries import get_question_or_raise


@dataclass(frozen=True, slots=True)
class QuestionExplainPreparedRequest:
    question: PalaceQuizQuestion
    normalized_user_question: str
    model_input: dict[str, Any]
    messages: list[dict[str, object]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def _format_options(options: Any) -> list[str]:
    if not isinstance(options, list):
        return []
    lines: list[str] = []
    for option in options:
        if not isinstance(option, dict):
            lines.append(str(option))
            continue
        label = option.get("label") or option.get("id") or option.get("key") or ""
        text = option.get("text") or option.get("content") or option.get("value") or ""
        prefix = f"{label}. " if label else ""
        lines.append(f"{prefix}{text}".strip())
    return [line for line in lines if line]


def _build_question_model_input(session: Session, question: PalaceQuizQuestion) -> dict[str, Any]:
    options = json_load(question.options_json, [])
    answer_payload = json_load(question.answer_payload_json, {})
    palace_title: str | None = None
    mini_palace_name: str | None = None
    source_chapter_name: str | None = None

    if question.palace_id:
        palace = session.get(Palace, question.palace_id)
        palace_title = palace.title if palace else None
    if question.mini_palace_id:
        mini_palace = session.get(PalaceMiniPalace, question.mini_palace_id)
        mini_palace_name = mini_palace.name if mini_palace else None
    if question.source_chapter_id:
        chapter = session.get(Chapter, question.source_chapter_id)
        source_chapter_name = chapter.name if chapter else None

    return {
        "question_id": question.id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": options,
        "answer_payload": answer_payload,
        "analysis": question.analysis,
        "palace_title": palace_title,
        "mini_palace_name": mini_palace_name,
        "source_chapter_name": source_chapter_name,
    }


def _build_question_context_text(model_input: dict[str, Any]) -> str:
    lines = [
        f"题型：{model_input.get('question_type') or ''}",
        f"题干：{model_input.get('stem') or ''}",
    ]
    option_lines = _format_options(model_input.get("options"))
    if option_lines:
        lines.append("选项：")
        lines.extend(f"- {line}" for line in option_lines)
    answer_payload = model_input.get("answer_payload")
    if answer_payload:
        lines.append(f"参考答案/判题信息：{_json_text(answer_payload)}")
    if model_input.get("analysis"):
        lines.append(f"题目解析：{model_input['analysis']}")
    if model_input.get("palace_title"):
        lines.append(f"所属宫殿：{model_input['palace_title']}")
    if model_input.get("mini_palace_name"):
        lines.append(f"学习组：{model_input['mini_palace_name']}")
    if model_input.get("source_chapter_name"):
        lines.append(f"来源章节：{model_input['source_chapter_name']}")
    return "\n".join(lines)


def _build_question_explain_messages(
    *,
    model_input: dict[str, Any],
    user_question: str,
) -> list[dict[str, object]]:
    context_text = _build_question_context_text(model_input)
    return [
        {
            "role": "system",
            "content": (
                "你是一名专业、耐心的学习辅导老师。用户正在做一道记忆宫殿学习题，"
                "请只根据题目、选项、参考答案和解析回答用户的问题。回答要简洁清晰，"
                "优先解释考点、答题思路和记忆方法；不超过 300 字。"
            ),
        },
        {
            "role": "user",
            "content": f"{context_text}\n\n---\n\n用户的问题：{user_question}",
        },
    ]


def prepare_question_explain_request(
    session: Session,
    *,
    question_id: int,
    user_question: str,
    ai_options: AiRuntimeOptions | None,
) -> QuestionExplainPreparedRequest:
    question = get_question_or_raise(session, question_id)
    normalized_user_question = str(user_question or "").strip()
    if not normalized_user_question:
        raise PalaceQuizValidationError("请先输入你想让 AI 讲解的问题。")

    model_input = _build_question_model_input(session, question)
    messages = _build_question_explain_messages(
        model_input=model_input,
        user_question=normalized_user_question,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_short_answer_feedback",
        ai_options=ai_options,
        temperature=0.3,
        timeout_seconds=90,
    )
    return QuestionExplainPreparedRequest(
        question=question,
        normalized_user_question=normalized_user_question,
        model_input=model_input,
        messages=messages,
        request_payload={
            "messages": messages,
            "model_input": model_input,
            "user_question": normalized_user_question,
            "resolved_ai": resolved_ai,
        },
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
    )


def explain_question(
    session: Session,
    *,
    question_id: int,
    user_question: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_question_explain_request(
        session,
        question_id=question_id,
        user_question=user_question,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_question_explain",
        palace_id=prepared_request.question.palace_id,
        messages=prepared_request.messages,
        response_format=None,
        request_payload=prepared_request.request_payload,
    )
    return {
        "question_id": prepared_request.question.id,
        "explanation_text": response_text.strip(),
        "ai_call_log_id": log_id,
        "resolved_ai": prepared_request.resolved_ai,
    }


__all__ = [
    "QuestionExplainPreparedRequest",
    "explain_question",
    "prepare_question_explain_request",
]
