"""Consolidated shared quiz-generation helpers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.infrastructure.llm.external_ai_call_logs import get_external_ai_call_log
from memory_anki.modules.content.api import get_palace_explicit_chapter_ids
from memory_anki.modules.mindmap_document.api import (
    deserialize_editor_payload,
)
from memory_anki.platform.application import (
    AiRuntimeOptions,
    build_image_content_part,
    extract_first_json_object,
)

from ..ai_dependencies import PalaceQuizAiDependencies
from ..question_contracts import (
    QUESTION_TYPE_SHORT_ANSWER,
    PalaceQuizValidationError,
)


def group_questions_by_child_chapters(*args, **kwargs):
    from .child_chapter import group_questions_by_child_chapters as impl

    return impl(*args, **kwargs)


def flatten_child_chapter_contexts(*args, **kwargs):
    from .child_chapter import flatten_child_chapter_contexts as impl

    return impl(*args, **kwargs)


# === question_generation_errors.py ===
class PalaceQuizAiError(RuntimeError):
    """Raised when an AI call fails (protocol/HTTP/network/parse)."""


# === question_generation_payloads.py ===
def _extract_json_object(
    response_text: str,
    *,
    parse_error_message: str,
    type_error_message: str,
) -> dict[str, Any]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError(parse_error_message) from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError(type_error_message)
    return parsed


def extract_questions_payload(response_text: str) -> list[dict[str, Any]]:
    parsed = _extract_json_object(
        response_text,
        parse_error_message="AI 返回的做题 JSON 无法解析。",
        type_error_message="AI 返回的做题结果不是对象。",
    )
    questions = parsed.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    normalized_questions: list[dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            raise PalaceQuizAiError("AI 返回的题目列表格式不正确。")
        normalized_questions.append(item)
    return normalized_questions


def extract_mini_palace_grouping_payload(response_text: str) -> dict[str, Any]:
    parsed = _extract_json_object(
        response_text,
        parse_error_message="AI 返回的学习组归类 JSON 无法解析。",
        type_error_message="AI 返回的学习组归类结果不是对象。",
    )
    groups = parsed.get("segment_groups", parsed.get("mini_palace_groups"))
    unassigned = parsed.get("unassigned_question_indexes")
    if not isinstance(groups, list) or not isinstance(unassigned, list):
        raise PalaceQuizAiError("AI 返回的学习组归类结果缺少必需字段。")
    return parsed


# === question_generation_drafts.py ===
def normalize_generated_question_drafts(
    response_text: str,
    *,
    source_meta: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], dict[str, int]]:
    raw_questions = extract_questions_payload(response_text)
    drafts: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_dedup_keys: set[str] = set()
    from ..questions.dedup_keys import build_question_dedup_key
    from ..questions.validation import normalize_question_payload

    for index, item in enumerate(raw_questions, start=1):
        try:
            normalized = normalize_question_payload(
                item,
                default_source_meta=source_meta,
            )
        except PalaceQuizValidationError as exc:
            reason = str(exc)
            if "每个选项都必须填写内容" in reason:
                reason = "选项格式不完整"
            elif "正确选项必须出现在选项列表中" in reason:
                reason = "正确答案不在选项列表中"
            warnings.append(f"第 {index} 题{reason}，已跳过；请重试或补充提示词要求选项完整。")
            continue
        dedup_key = build_question_dedup_key(normalized)
        if dedup_key in seen_dedup_keys:
            warnings.append(f"第 {index} 题与前面题目重复，已自动去重。")
            continue
        seen_dedup_keys.add(dedup_key)
        drafts.append({**normalized, "source_meta": source_meta})
    stats = {
        "returned_count": len(raw_questions),
        "savable_count": len(drafts),
        "skipped_count": len(raw_questions) - len(drafts),
    }
    if len(drafts) == 0:
        if warnings:
            raise PalaceQuizAiError("AI 返回的题目全部无法使用：" + "；".join(warnings))
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    return drafts, warnings, stats


# === quiz_generation_editor_summary.py ===
def node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    raw_data = node.get("data")
    data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
    return str(data.get("text") or node.get("text") or "").strip()


def node_children(node: Any) -> list[Any]:
    if not isinstance(node, dict):
        return []
    children = node.get("children")
    return children if isinstance(children, list) else []


def extract_first_multi_node_summary(editor_doc: Any, *, max_items: int = 24) -> list[str]:
    doc = deserialize_editor_payload(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    if not isinstance(root, dict):
        return []
    current_level = node_children(root)
    while current_level:
        texts = [node_text(node) for node in current_level if node_text(node)]
        if len(texts) >= 2:
            return texts[:max_items]
        next_level: list[Any] = []
        for node in current_level:
            next_level.extend(node_children(node))
        current_level = next_level
    return []


# === question_generation_source_meta.py ===
def build_generation_source_meta(
    *,
    source_kind: str,
    generation_mode: str,
    extra_prompt: str,
    secondary_review_enabled: bool = False,
    page_numbers: list[int] | None = None,
    image_names: list[str] | None = None,
    ai_call_log_id: str | None = None,
) -> dict[str, Any]:
    return {
        "source_kind": source_kind,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "extra_prompt": str(extra_prompt or "").strip(),
        "secondary_review_enabled": bool(secondary_review_enabled),
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "generation_mode": generation_mode,
    }


def finalize_generation_source_meta(
    source_meta: dict[str, Any],
    *,
    ai_call_log_id: str,
) -> None:
    source_meta["ai_call_log_id"] = str(ai_call_log_id or "").strip() or None
    source_meta["generated_at"] = utc_now_naive().isoformat()


# === quiz_generation_chapter_scope_context.py ===
def flatten_descendant_chapter_contexts(
    chapter: Chapter,
    *,
    depth: int = 1,
) -> list[dict[str, Any]]:
    contexts: list[dict[str, Any]] = []
    for child in chapter.children or []:
        notes = str(child.notes or "").strip()
        contexts.append(
            {
                "chapter_id": child.id,
                "name": child.name,
                "notes": notes,
                "depth": depth,
                "match_blob": " ".join(item for item in [child.name, notes] if item).strip(),
            }
        )
        contexts.extend(flatten_descendant_chapter_contexts(child, depth=depth + 1))
    return contexts


def resolve_pdf_grouping_scope_contexts(selected_chapter: Chapter | None) -> list[dict[str, Any]]:
    if selected_chapter is None:
        return []
    return flatten_descendant_chapter_contexts(selected_chapter)

# === quiz_generation_chapter_scope_drafts.py ===
def apply_source_chapter_to_drafts(
    drafts: list[dict[str, Any]],
    *,
    chapter_id: int | None,
) -> None:
    if chapter_id is None:
        return
    for draft in drafts:
        draft["source_chapter_id"] = chapter_id

# === quiz_generation_chapter_scope_selection.py ===
def chapter_belongs_to_explicit_scope(chapter: Chapter, explicit_ids: set[int]) -> bool:
    current: Chapter | None = chapter
    while current is not None:
        if current.id in explicit_ids:
            return True
        current = current.parent
    return False


def chapter_contains_explicit_scope(
    session: Session,
    *,
    chapter: Chapter,
    explicit_ids: set[int],
) -> bool:
    from ..questions.validation import get_chapter_or_raise

    for explicit_id in explicit_ids:
        explicit_chapter = get_chapter_or_raise(session, explicit_id)
        current: Chapter | None = explicit_chapter
        while current is not None:
            if current.id == chapter.id:
                return True
            current = current.parent
    return False


def resolve_selected_generation_chapter(
    session: Session,
    *,
    palace: Palace,
    selected_chapter_id: int | None,
) -> Chapter | None:
    if selected_chapter_id is None:
        return None
    from ..questions.validation import get_chapter_or_raise

    chapter = get_chapter_or_raise(session, selected_chapter_id)
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    if not explicit_ids:
        raise PalaceQuizValidationError("当前宫殿还没有绑定可用章节，无法选择题目所属范围。")
    if not chapter_belongs_to_explicit_scope(
        chapter,
        explicit_ids,
    ) and not chapter_contains_explicit_scope(
        session,
        chapter=chapter,
        explicit_ids=explicit_ids,
    ):
        raise PalaceQuizValidationError("所选章节不在当前宫殿已绑定的章节范围内。")
    return chapter

# === quiz_generation_chapter_scope.py ===


# === quiz_generation_preview_result.py ===
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

# === quiz_generation_prompt_messages.py ===
def build_generation_messages(
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    session: Session,
    extra_prompt: str,
    source_label: str,
    image_items: list[tuple[bytes, str | None]],
    source_context: str | None = None,
    prompt_override: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    is_source_pair_transcription = bool(
        source_context
        and "题目来源" in source_context
        and "答案与解析来源" in source_context
    )
    system_prompt = (
        ai_dependencies.prompts.render("ai_prompt_palace_quiz_source_pair_transcription")
        if is_source_pair_transcription
        else ai_dependencies.prompts.render("ai_prompt_palace_quiz_generate")
    )
    if prompt_override and str(prompt_override).strip():
        system_prompt = str(prompt_override).strip()
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": ai_dependencies.prompts.render(
                (
                    "ai_prompt_palace_quiz_source_pair_user_text"
                    if is_source_pair_transcription
                    else "ai_prompt_palace_quiz_generation_user_text"
                ),
                {"source_label": source_label},
            ),
        }
    ]
    if source_context:
        user_content.append({"type": "text", "text": source_context})
    if is_source_pair_transcription:
        user_content.append(
            {
                "type": "text",
                "text": (
                    "请严格按接下来图片出现的顺序处理。"
                    "每张图片只能写入它在上方“图片顺序与角色绑定”里指定的候选池。"
                    "如果某张图是题目来源，即使没有选项，只要题型标题或题面显示为简答题、论述题、材料分析题等主观题，"
                    "也必须写入 question_candidates。"
                ),
            }
        )
    for image_bytes, filename in image_items:
        user_content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        range_guard = ""
        if "只要" in normalized_extra_prompt or "仅" in normalized_extra_prompt:
            range_guard = (
                "\n如果材料中有不符合该范围限定的原题，必须直接跳过，不要改写成题目；"
                "最终 questions 数组只能包含满足限定范围的题目。"
            )
        system_prompt = (
            f"{system_prompt}\n\n"
            "用户临时补充要求必须优先严格遵守；如果补充要求限定范围，"
            "不要生成范围外题目。\n"
            f"{normalized_extra_prompt}{range_guard}"
        )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    messages.append({"role": "user", "content": user_content})
    return messages, system_prompt

# === quiz_generation_preview_grouping.py ===
def _grouping_service():
    from .. import quiz_grouping_service

    return quiz_grouping_service


def require_child_chapter_contexts(
    child_contexts: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
    return child_contexts


def group_questions_for_child_chapter_preview(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    drafts: list[dict[str, Any]],
    child_contexts: list[dict[str, object]],
    feature: str,
    operation: str,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    return group_questions_by_child_chapters(
        session,
        ai_dependencies=ai_dependencies,
        drafts=drafts,
        child_contexts=require_child_chapter_contexts(child_contexts),
        feature=feature,
        operation=operation,
        ai_options=ai_options,
    )


def group_questions_for_preview_scope(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    palace: Any,
    drafts: list[dict[str, Any]],
    selected_chapter: Any = None,
    child_contexts: list[dict[str, object]] | None = None,
    feature: str,
    child_chapter_operation: str,
    mini_palace_operation: str,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    if selected_chapter is not None:
        return group_questions_for_child_chapter_preview(
            session,
            ai_dependencies=ai_dependencies,
            drafts=drafts,
            child_contexts=list(child_contexts or []),
            feature=feature,
            operation=child_chapter_operation,
            ai_options=ai_options,
        )
    return _grouping_service().group_questions_by_mini_palaces(
        session,
        ai_dependencies=ai_dependencies,
        palace=palace,
        questions=drafts,
        operation=mini_palace_operation,
        ai_options=ai_options,
    )[0]

# === quiz_generation_feedback_request_context.py ===
@dataclass(frozen=True, slots=True)
class ShortAnswerFeedbackRequestContext:
    question: PalaceQuizQuestion
    normalized_user_answer: str
    reference_answer: str


def load_short_answer_feedback_request_context(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
) -> ShortAnswerFeedbackRequestContext:
    from ..question_schema import json_load
    from ..questions.queries import get_question_or_raise

    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_SHORT_ANSWER:
        raise PalaceQuizValidationError("只有简答题可以生成 AI 点评。")
    normalized_user_answer = str(user_answer or "").strip()
    if not normalized_user_answer:
        raise PalaceQuizValidationError("请先填写你的答案。")
    answer_payload = json_load(question.answer_payload_json, {})
    reference_answer = str(answer_payload.get("reference_answer") or "").strip()
    return ShortAnswerFeedbackRequestContext(
        question=question,
        normalized_user_answer=normalized_user_answer,
        reference_answer=reference_answer,
    )

# === quiz_generation_feedback_request_payload.py ===
def build_short_answer_feedback_model_input(
    context: ShortAnswerFeedbackRequestContext,
) -> dict[str, Any]:
    return {
        "stem": context.question.stem,
        "user_answer": context.normalized_user_answer,
        "reference_answer": context.reference_answer,
        "analysis": context.question.analysis,
    }


def build_short_answer_feedback_messages(
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    session: Session,
    model_input: dict[str, Any],
) -> tuple[str, list[dict[str, object]]]:
    system_prompt = ai_dependencies.prompts.render(
        "ai_prompt_palace_quiz_short_answer_feedback"
    )
    messages: list[dict[str, object]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages

# === quiz_generation_feedback_request.py ===
@dataclass(frozen=True, slots=True)
class ShortAnswerFeedbackPreparedRequest:
    question: Any
    normalized_user_answer: str
    system_prompt: str
    model_input: dict[str, Any]
    messages: list[dict[str, object]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


def _ai_service():
    from .. import ai_service

    return ai_service


def prepare_short_answer_feedback_request(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None,
) -> ShortAnswerFeedbackPreparedRequest:
    request_context = load_short_answer_feedback_request_context(
        session,
        question_id=question_id,
        user_answer=user_answer,
    )
    model_input = build_short_answer_feedback_model_input(request_context)
    system_prompt, messages = build_short_answer_feedback_messages(
        ai_dependencies=ai_dependencies,
        session=session,
        model_input=model_input,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        ai_runtime=ai_dependencies.runtime,
        scenario_key="quiz_short_answer_feedback",
        ai_options=ai_options,
        temperature=0.3,
        timeout_seconds=90,
    )
    return ShortAnswerFeedbackPreparedRequest(
        question=request_context.question,
        normalized_user_answer=request_context.normalized_user_answer,
        system_prompt=system_prompt,
        model_input=model_input,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "resolved_ai": resolved_ai,
        },
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
    )

# === quiz_generation_feedback.py ===
def _coerce_feedback_points(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _parse_structured_feedback(response_text: str) -> dict[str, object] | None:
    """Extract structured feedback from model output, or return None for text fallback."""
    text = response_text.strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None

    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in {"correct", "partial", "incorrect"}:
        return None

    hit_points = _coerce_feedback_points(payload.get("hit_points"))
    missed_points = _coerce_feedback_points(payload.get("missed_points"))
    suggestion = str(payload.get("suggestion") or "").strip()
    fallback_lines = []
    if hit_points:
        fallback_lines.append("答到的要点：\n" + "\n".join(f"- {item}" for item in hit_points))
    if missed_points:
        fallback_lines.append("遗漏或有偏差：\n" + "\n".join(f"- {item}" for item in missed_points))
    if suggestion:
        fallback_lines.append(f"建议：{suggestion}")
    return {
        "verdict": verdict,
        "hit_points": hit_points,
        "missed_points": missed_points,
        "suggestion": suggestion,
        "fallback_text": "\n\n".join(fallback_lines) or text,
    }


def generate_short_answer_feedback(
    session: Session,
    *,
    ai_dependencies: PalaceQuizAiDependencies,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_short_answer_feedback_request(
        session,
        ai_dependencies=ai_dependencies,
        question_id=question_id,
        user_answer=user_answer,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_short_answer_feedback",
        palace_id=prepared_request.question.palace_id,
        messages=prepared_request.messages,
        response_format=None,
        request_payload=prepared_request.request_payload,
    )
    structured = _parse_structured_feedback(response_text)
    return {
        "question_id": prepared_request.question.id,
        "feedback_text": (
            structured["fallback_text"] if structured else response_text.strip()
        ),
        "verdict": structured["verdict"] if structured else None,
        "hit_points": structured["hit_points"] if structured else [],
        "missed_points": structured["missed_points"] if structured else [],
        "suggestion": structured["suggestion"] if structured else "",
        "ai_call_log_id": log_id,
        "resolved_ai": prepared_request.resolved_ai,
    }

# === quiz_generation_recovery.py ===
RECOVERABLE_OPERATIONS = {
    "palace_quiz_generate_images",
    "palace_quiz_generate_text_files",
    "palace_quiz_generate_review_mindmap",
    "chapter_quiz_generate_outline",
}


def _recover_source_meta(payload: dict[str, Any], log_id: str) -> dict[str, Any]:
    request_payload = payload.get("request_payload")
    raw_source_meta = request_payload.get("source_meta") if isinstance(request_payload, dict) else None
    source_meta = dict(raw_source_meta) if isinstance(raw_source_meta, dict) else {}
    source_meta["ai_call_log_id"] = log_id
    source_meta["recovered_from_ai_call_log_id"] = log_id
    return source_meta


def recover_quiz_preview_from_log(
    session: Session,
    *,
    palace_id: int,
    log_id: str,
) -> dict[str, Any]:
    normalized_log_id = str(log_id or "").strip()
    if not normalized_log_id:
        raise PalaceQuizAiError("AI 调用日志不存在。")

    payload = get_external_ai_call_log(session, normalized_log_id)
    if not payload:
        raise PalaceQuizAiError("AI 调用日志不存在。")
    if payload.get("status") != "success":
        raise PalaceQuizAiError("该日志不是成功记录，无法恢复预览。")
    if payload.get("operation") not in RECOVERABLE_OPERATIONS:
        raise PalaceQuizAiError("该日志不是出题生成记录。")
    if payload.get("palace_id") not in (None, palace_id):
        raise PalaceQuizAiError("日志与当前宫殿不匹配。")

    response_payload = payload.get("response_payload")
    response_text = str(
        payload.get("response_text")
        or (
            response_payload.get("response_text")
            if isinstance(response_payload, dict)
            else ""
        )
        or ""
    )
    if not response_text.strip():
        raise PalaceQuizAiError("日志中没有可用的模型返回文本。")

    source_meta = _recover_source_meta(payload, normalized_log_id)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=normalized_log_id,
        warnings=[
            *warnings,
            "本预览由历史 AI 日志恢复，OCR 溯源与关卡分组信息不含在内。",
        ],
        generation_stats=generation_stats,
        grouped_questions=None,
        resolved_ai=None,
        extra_fields={"ocr_sources": [], "recovered_from_log": True},
    )


__all__ = [
    "PalaceQuizAiError",
    "RECOVERABLE_OPERATIONS",
    "apply_source_chapter_to_drafts",
    "build_generation_source_meta",
    "build_generation_messages",
    "build_quiz_generation_preview_result",
    "finalize_generation_source_meta",
    "chapter_belongs_to_explicit_scope",
    "chapter_contains_explicit_scope",
    "extract_first_multi_node_summary",
    "extract_mini_palace_grouping_payload",
    "extract_questions_payload",
    "flatten_child_chapter_contexts",
    "flatten_descendant_chapter_contexts",
    "generate_short_answer_feedback",
    "group_questions_for_child_chapter_preview",
    "group_questions_for_preview_scope",
    "normalize_generated_question_drafts",
    "node_children",
    "node_text",
    "recover_quiz_preview_from_log",
    "require_child_chapter_contexts",
    "resolve_pdf_grouping_scope_contexts",
    "resolve_selected_generation_chapter",
]
