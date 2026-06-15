from __future__ import annotations

import json
from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
    stream_chat_completion_text,
)
from memory_anki.infrastructure.llm.config_helpers import has_non_empty_config
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)

# render_selected_pdf_pages is imported here (not used in this module) so that
# quiz_generation_service can access it via ``_ai.render_selected_pdf_pages`` and
# route tests can patch it with ``patch.object(ai_service, ...)``.
from memory_anki.modules.knowledge.application.subject_document_service import (  # noqa: F401
    render_selected_pdf_pages,
)
from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    extract_first_json_object,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    is_dashscope_compatible_provider,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

from ._question_utils import PalaceQuizAiError
from .service import (
    PalaceQuizValidationError,
    build_question_dedup_key,
    normalize_question_payload,
)

QuizStreamEvent = tuple[str, dict[str, Any]]

REVIEW_MINDMAP_QUESTION_TYPES = {
    "multiple_choice": "选择题",
    "true_false": "判断题",
    "fill_blank": "填空题",
    "matching": "连线题",
    "ordering": "排序题",
    "categorization": "归类题",
    "short_answer": "简答题",
}


def _build_chat_config(
    session: Session,
    *,
    scenario_key: str,
    ai_options: AiRuntimeOptions | None,
    temperature: float,
    timeout_seconds: float,
) -> tuple[OpenAICompatibleChatConfig, dict[str, Any] | None, dict[str, Any]]:
    runtime = resolve_scenario_runtime(session, scenario_key, ai_options=ai_options)
    runtime_api_key = runtime.api_key
    runtime_base_url = runtime.base_url
    if is_dashscope_compatible_provider(runtime.provider):
        if not has_non_empty_config(session, "dashscope_api_key"):
            runtime_api_key = str(DASHSCOPE_API_KEY or runtime.api_key or "").strip()
        if not has_non_empty_config(session, "dashscope_base_url"):
            runtime_base_url = str(DASHSCOPE_BASE_URL or runtime.base_url or "").strip()
    if not runtime_api_key:
        raise PalaceQuizAiError("未配置对应模型的 Provider API Key，暂时无法调用 AI。")
    resolved_ai = serialize_resolved_ai_runtime(runtime)
    return (
        OpenAICompatibleChatConfig(
            api_key=runtime_api_key,
            base_url=runtime_base_url,
            model=runtime.model,
            temperature=(temperature if runtime.supports_temperature else None),
            timeout_seconds=timeout_seconds,
        ),
        runtime.extra_payload,
        resolved_ai,
    )


def _build_generation_source_meta(
    *,
    source_kind: str,
    generation_mode: str,
    extra_prompt: str,
    subject_document_id: int | None = None,
    page_numbers: list[int] | None = None,
    image_names: list[str] | None = None,
    ai_call_log_id: str | None = None,
    pdf_sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "source_kind": source_kind,
        "subject_document_id": subject_document_id,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "extra_prompt": str(extra_prompt or "").strip(),
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "generation_mode": generation_mode,
        "pdf_sources": pdf_sources,
    }


def _extract_questions_payload(response_text: str) -> list[dict[str, Any]]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError("AI 返回的做题 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError("AI 返回的做题结果不是对象。")
    questions = parsed.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise PalaceQuizAiError("AI 没有返回可用题目。")
    normalized_questions: list[dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            raise PalaceQuizAiError("AI 返回的题目列表格式不正确。")
        normalized_questions.append(item)
    return normalized_questions


def _normalize_generated_question_drafts(
    response_text: str,
    *,
    source_meta: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str], dict[str, int]]:
    raw_questions = _extract_questions_payload(response_text)
    drafts: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_dedup_keys: set[str] = set()
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


def _call_logged_chat_completion(
    *,
    config: OpenAICompatibleChatConfig,
    extra_payload: dict[str, Any] | None,
    feature: str,
    operation: str,
    palace_id: int,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None,
    request_payload: dict[str, Any],
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> tuple[str, str]:
    log_id = begin_external_ai_call_log(
        feature=feature,
        operation=operation,
        provider="openai_compatible",
        base_url=config.base_url,
        model=config.model,
        palace_id=palace_id,
        request_payload=request_payload,
        image_items=image_items,
    )
    try:
        response_text = call_chat_completion_text(
            config=config,
            messages=messages,
            response_format=response_format,
            extra_payload=extra_payload,
        )
    except OpenAICompatibleProtocolError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={"type": "protocol_error", "message": str(exc)},
        )
        raise PalaceQuizAiError(str(exc)) from exc
    except OpenAICompatibleHttpError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "http_error",
                "status_code": exc.status_code,
                "message": str(exc),
                "response_body": exc.response_body,
            },
        )
        detail = exc.response_body.strip()
        raise PalaceQuizAiError(
            f"AI 调用失败：HTTP {exc.status_code} {detail}".strip()
        ) from exc
    except OpenAICompatibleNetworkError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "network_error",
                "message": str(exc),
                "reason": exc.reason,
            },
        )
        raise PalaceQuizAiError(
            f"AI 网络异常：{exc.reason}。当前目标地址：{config.base_url.rstrip('/')}/chat/completions"
        ) from exc

    complete_external_ai_call_log(
        log_id,
        response_payload={"response_text": response_text},
    )
    return response_text, log_id


def _call_logged_chat_completion_stream(
    *,
    config: OpenAICompatibleChatConfig,
    extra_payload: dict[str, Any] | None,
    feature: str,
    operation: str,
    palace_id: int,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None,
    request_payload: dict[str, Any],
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> Generator[str, None, tuple[str, str]]:
    log_id = begin_external_ai_call_log(
        feature=feature,
        operation=operation,
        provider="openai_compatible",
        base_url=config.base_url,
        model=config.model,
        palace_id=palace_id,
        request_payload=request_payload,
        image_items=image_items,
    )
    response_parts: list[str] = []
    try:
        stream = stream_chat_completion_text(
            config=config,
            messages=messages,
            response_format=response_format,
            extra_payload=extra_payload,
        )
        while True:
            try:
                delta = next(stream)
            except StopIteration as exc:
                final_text = str(exc.value or "".join(response_parts))
                complete_external_ai_call_log(
                    log_id,
                    response_payload={"response_text": final_text},
                )
                return final_text, log_id
            response_parts.append(delta)
            yield delta
    except OpenAICompatibleProtocolError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={"type": "protocol_error", "message": str(exc)},
        )
        raise PalaceQuizAiError(str(exc)) from exc
    except OpenAICompatibleHttpError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "http_error",
                "status_code": exc.status_code,
                "message": str(exc),
                "response_body": exc.response_body,
            },
        )
        detail = exc.response_body.strip()
        raise PalaceQuizAiError(
            f"AI 调用失败：HTTP {exc.status_code} {detail}".strip()
        ) from exc
    except OpenAICompatibleNetworkError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "network_error",
                "message": str(exc),
                "reason": exc.reason,
            },
        )
        raise PalaceQuizAiError(
            f"AI 网络异常：{exc.reason}。当前目标地址：{config.base_url.rstrip('/')}/chat/completions"
        ) from exc
from .quiz_grouping_service import (  # noqa: E402,F401,I001
    build_grouped_preview_from_indexes as _build_grouped_preview_from_indexes,
    build_mini_palace_context as _build_mini_palace_context,
    group_questions_by_mini_palaces as _group_questions_by_mini_palaces,
    question_payload_for_grouping as _question_payload_for_grouping,
)

# Generation flows moved to quiz_generation_service.py; re-exported here so
# internal router imports `from .ai_service import generate_quiz_preview_from_*`
# keep resolving. Imported at module tail to avoid circular import.
from .quiz_generation_service import (  # noqa: E402,F401,I001
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_pdf,
    generate_quiz_preview_from_pdf_events,
    generate_quiz_preview_from_review_mindmap,
    generate_short_answer_feedback,
)
from .quiz_grouping_service import (  # noqa: E402,F401,I001
    classify_existing_quiz_questions_to_mini_palaces,
)
