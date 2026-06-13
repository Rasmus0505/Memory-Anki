from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
    DASHSCOPE_VISION_MODEL,
)
from memory_anki.infrastructure.db.models import Config
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
    render_selected_pdf_pages,
)
from memory_anki.modules.palaces.application.mini_palace_service import (
    parse_mini_palace_node_uids,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    collect_doc_nodes_with_descendants,
)
from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    build_image_content_part,
    extract_first_json_object,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_scenario_runtime,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from .service import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    QUESTION_TYPE_SHORT_ANSWER,
    get_palace_or_raise,
    get_question_or_raise,
    list_root_questions,
    normalize_question_payload,
    serialize_question,
    upsert_classified_question_copy,
)


class PalaceQuizAiError(RuntimeError):
    pass


def _has_non_empty_config(session: Session, key: str) -> bool:
    row = session.query(Config).filter_by(key=key).first()
    return bool(row and str(row.value or "").strip())


def _ensure_ai_ready() -> None:
    return None


def _build_chat_config(
    session: Session,
    *,
    scenario_key: str,
    ai_options: AiRuntimeOptions | None,
    temperature: float,
    timeout_seconds: float,
) -> tuple[OpenAICompatibleChatConfig, dict[str, Any] | None]:
    runtime = resolve_scenario_runtime(session, scenario_key, ai_options=ai_options)
    if runtime.provider == "dashscope":
        if not _has_non_empty_config(session, "dashscope_api_key"):
            runtime_api_key = str(DASHSCOPE_API_KEY or runtime.api_key or "").strip()
        else:
            runtime_api_key = runtime.api_key
        if not _has_non_empty_config(session, "dashscope_base_url"):
            runtime_base_url = str(DASHSCOPE_BASE_URL or runtime.base_url or "").strip()
        else:
            runtime_base_url = runtime.base_url
        runtime_model = runtime.model
        if not (ai_options and ai_options.model) and not _has_non_empty_config(
            session, runtime.scenario.config_key
        ):
            if scenario_key == "vision":
                runtime_model = str(DASHSCOPE_VISION_MODEL or runtime.model or "").strip()
            elif scenario_key == "quiz_text":
                runtime_model = str(DASHSCOPE_TEXT_MODEL or runtime.model or "").strip()
        runtime = runtime.__class__(
            scenario=runtime.scenario,
            model=runtime_model,
            thinking_enabled=runtime.thinking_enabled,
            provider=runtime.provider,
            modality=runtime.modality,
            supports_thinking=runtime.supports_thinking,
            supports_temperature=runtime.supports_temperature,
            api_key=runtime_api_key,
            base_url=runtime_base_url,
            extra_payload=runtime.extra_payload,
        )
    if not runtime.api_key:
        raise PalaceQuizAiError("未配置对应模型的 Provider API Key，暂时无法调用 AI。")
    return (
        OpenAICompatibleChatConfig(
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            model=runtime.model,
            temperature=(temperature if runtime.supports_temperature else None),
            timeout_seconds=timeout_seconds,
        ),
        runtime.extra_payload,
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


def _extract_mini_palace_grouping_payload(response_text: str) -> dict[str, Any]:
    candidate = extract_first_json_object(response_text) or response_text
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise PalaceQuizAiError("AI 返回的小宫殿归类 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizAiError("AI 返回的小宫殿归类结果不是对象。")
    groups = parsed.get("mini_palace_groups")
    unassigned = parsed.get("unassigned_question_indexes")
    if not isinstance(groups, list) or not isinstance(unassigned, list):
        raise PalaceQuizAiError("AI 返回的小宫殿归类结果缺少必需字段。")
    return parsed


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


def _build_generation_messages(
    *,
    session: Session,
    extra_prompt: str,
    source_label: str,
    image_items: list[tuple[bytes, str | None]],
) -> tuple[list[dict[str, Any]], str]:
    system_prompt = render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "请基于接下来提供的资料生成题目。"
                f"当前来源：{source_label}。"
                "如果资料里已经有现成题号、序号或题型，请优先按原题抽取；"
                "如果没有明确题目，请基于资料内容补出适量题目，数量和题型由你自行判断。"
            ),
        }
    ]
    for image_bytes, filename in image_items:
        user_content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        messages.append(
            {
                "role": "system",
                "content": f"用户临时补充要求（仍需遵守系统模板）：\n{normalized_extra_prompt}",
            }
        )
    messages.append({"role": "user", "content": user_content})
    return messages, system_prompt


def _build_mini_palace_context(palace: Any) -> list[dict[str, Any]]:
    _, labels = collect_doc_nodes_with_descendants(getattr(palace, "editor_doc", None))
    contexts: list[dict[str, Any]] = []
    for mini_palace in getattr(palace, "mini_palaces", []) or []:
        node_uids = parse_mini_palace_node_uids(getattr(mini_palace, "node_uids_json", None))
        node_texts = [labels.get(uid, uid) for uid in node_uids if labels.get(uid, uid)]
        contexts.append(
            {
                "mini_palace_id": mini_palace.id,
                "name": mini_palace.name,
                "node_uids": node_uids,
                "node_texts": node_texts[:24],
                "node_text_summary": "；".join(node_texts[:12]),
            }
        )
    return contexts


def _question_payload_for_grouping(question: dict[str, Any], index: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "question_index": index,
        "question_type": question.get("question_type"),
        "stem": question.get("stem"),
        "analysis": question.get("analysis"),
    }
    if question.get("question_type") == "multiple_choice":
        payload["options"] = question.get("options") or []
        payload["correct_option_id"] = (
            question.get("answer_payload", {}) or {}
        ).get("correct_option_id")
    else:
        payload["reference_answer"] = (
            question.get("answer_payload", {}) or {}
        ).get("reference_answer")
    return payload


def _build_grouped_preview_from_indexes(
    *,
    questions: list[dict[str, Any]],
    grouping_payload: dict[str, Any],
    mini_palace_contexts: list[dict[str, Any]],
) -> dict[str, Any]:
    question_count = len(questions)
    context_by_id = {
        int(item["mini_palace_id"]): item
        for item in mini_palace_contexts
        if item.get("mini_palace_id") is not None
    }
    grouped_questions: list[dict[str, Any]] = []
    assigned_indexes: set[int] = set()
    for item in grouping_payload.get("mini_palace_groups", []):
        if not isinstance(item, dict):
            continue
        mini_palace_id = item.get("mini_palace_id")
        question_indexes_raw = item.get("question_indexes")
        try:
            mini_palace_id_int = int(mini_palace_id)
        except (TypeError, ValueError):
            continue
        if mini_palace_id_int not in context_by_id or not isinstance(question_indexes_raw, list):
            continue
        question_indexes: list[int] = []
        for raw_index in question_indexes_raw:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < question_count and index not in question_indexes:
                question_indexes.append(index)
                assigned_indexes.add(index)
        if not question_indexes:
            continue
        grouped_questions.append(
            {
                "mini_palace_id": mini_palace_id_int,
                "mini_palace_name": context_by_id[mini_palace_id_int]["name"],
                "questions": [
                    {
                        **questions[index],
                        "mini_palace_id": mini_palace_id_int,
                    }
                    for index in question_indexes
                ],
            }
        )

    unassigned_indexes_raw = grouping_payload.get("unassigned_question_indexes", [])
    unassigned_indexes: list[int] = []
    for raw_index in unassigned_indexes_raw:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if 0 <= index < question_count and index not in unassigned_indexes:
            unassigned_indexes.append(index)
    if not unassigned_indexes:
        unassigned_indexes = [index for index in range(question_count) if index not in assigned_indexes]

    return {
        "mini_palace_groups": grouped_questions,
        "unassigned_questions": [questions[index] for index in unassigned_indexes],
    }


def _group_questions_by_mini_palaces(
    session: Session,
    *,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, Any], str]:
    mini_palace_contexts = _build_mini_palace_context(palace)
    if len(mini_palace_contexts) == 0:
        raise PalaceQuizValidationError("当前宫殿还没有小宫殿，暂时无法按小宫殿分类。")
    if len(questions) == 0:
        raise PalaceQuizValidationError("没有可分类的题目。")
    system_prompt = render_prompt(
        operation,
        {},
        session=session,
    )
    model_input = {
        "mini_palaces": mini_palace_contexts,
        "questions": [
            _question_payload_for_grouping(question, index)
            for index, question in enumerate(questions)
        ],
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="quiz_mini_palace",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    response_text, log_id = _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation=operation,
        palace_id=palace.id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
        },
    )
    grouping_payload = _extract_mini_palace_grouping_payload(response_text)
    grouped_preview = _build_grouped_preview_from_indexes(
        questions=questions,
        grouping_payload=grouping_payload,
        mini_palace_contexts=mini_palace_contexts,
    )
    return grouped_preview, log_id


def generate_quiz_preview_from_images(
    session: Session,
    *,
    palace_id: int,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="vision",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    palace = get_palace_or_raise(session, palace_id)
    if len(image_items) == 0:
        raise PalaceQuizValidationError("请至少上传一张图片。")
    image_names = [str(filename or f"image-{index + 1}.png") for index, (_, filename) in enumerate(image_items)]
    generation_mode = "single_image" if len(image_items) == 1 else "multi_image"
    source_meta = _build_generation_source_meta(
        source_kind="image_upload",
        generation_mode=generation_mode,
        extra_prompt=extra_prompt,
        image_names=image_names,
    )
    messages, system_prompt = _build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label="图片识别",
        image_items=image_items,
    )
    response_text, log_id = _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_images",
        palace_id=palace_id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "message_roles": [message.get("role") for message in messages],
            "response_format": {"type": "json_object"},
            "source_meta": source_meta,
        },
        image_items=image_items,
    )
    source_meta["ai_call_log_id"] = log_id
    source_meta["generated_at"] = _build_generation_source_meta(
        source_kind=source_meta["source_kind"],
        generation_mode=source_meta["generation_mode"],
        extra_prompt=source_meta["extra_prompt"],
        image_names=source_meta["image_names"],
        ai_call_log_id=log_id,
    )["generated_at"]
    drafts = [
        {
            **normalize_question_payload(item, default_source_meta=source_meta),
            "source_meta": source_meta,
        }
        for item in _extract_questions_payload(response_text)
    ]
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "grouped_questions": (
            _group_questions_by_mini_palaces(
                session,
                palace=palace,
                questions=drafts,
                operation="ai_prompt_palace_quiz_group_by_mini_palace",
                ai_options=ai_options,
            )[0]
            if classify_by_mini_palace
            else None
        ),
    }


def generate_quiz_preview_from_pdf(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="vision",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    palace = get_palace_or_raise(session, palace_id)
    document = get_subject_document_by_id(session, subject_document_id)
    if not document:
        raise PalaceQuizNotFoundError("PDF 资料不存在。")
    normalized_pages = sorted({int(page) for page in page_selection if int(page) > 0})
    if len(normalized_pages) == 0:
        raise PalaceQuizValidationError("请至少选择一页 PDF。")
    rendered_pages = render_selected_pdf_pages(document, page_numbers=normalized_pages, kind="preview")
    image_items = [(image_bytes, filename) for _, image_bytes, filename in rendered_pages]
    source_meta = _build_generation_source_meta(
        source_kind="subject_pdf",
        generation_mode="subject_pdf",
        extra_prompt=extra_prompt,
        subject_document_id=document.id,
        page_numbers=normalized_pages,
        image_names=[filename for _, _, filename in rendered_pages],
    )
    messages, system_prompt = _build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label=f"学科 PDF《{document.original_name}》第 {', '.join(str(page) for page in normalized_pages)} 页",
        image_items=image_items,
    )
    response_text, log_id = _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_pdf",
        palace_id=palace_id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "message_roles": [message.get("role") for message in messages],
            "response_format": {"type": "json_object"},
            "source_meta": source_meta,
        },
        image_items=image_items,
    )
    source_meta["ai_call_log_id"] = log_id
    source_meta["generated_at"] = _build_generation_source_meta(
        source_kind=source_meta["source_kind"],
        generation_mode=source_meta["generation_mode"],
        extra_prompt=source_meta["extra_prompt"],
        subject_document_id=source_meta["subject_document_id"],
        page_numbers=source_meta["page_numbers"],
        image_names=source_meta["image_names"],
        ai_call_log_id=log_id,
    )["generated_at"]
    drafts = [
        {
            **normalize_question_payload(item, default_source_meta=source_meta),
            "source_meta": source_meta,
        }
        for item in _extract_questions_payload(response_text)
    ]
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "grouped_questions": (
            _group_questions_by_mini_palaces(
                session,
                palace=palace,
                questions=drafts,
                operation="ai_prompt_palace_quiz_group_by_mini_palace",
                ai_options=ai_options,
            )[0]
            if classify_by_mini_palace
            else None
        ),
    }


def classify_existing_quiz_questions_to_mini_palaces(
    session: Session,
    *,
    palace_id: int,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    palace = get_palace_or_raise(session, palace_id)
    source_questions = list_root_questions(session, palace_id)
    if len(source_questions) == 0:
        raise PalaceQuizValidationError("当前大宫殿题库还没有可归类的题目。")
    source_payloads = [serialize_question(question) for question in source_questions]
    grouped_preview, log_id = _group_questions_by_mini_palaces(
        session,
        palace=palace,
        questions=source_payloads,
        operation="ai_prompt_palace_quiz_classify_existing_to_mini_palace",
        ai_options=ai_options,
    )
    created_or_updated = 0
    mini_palace_hit_counts: list[dict[str, Any]] = []
    for group in grouped_preview["mini_palace_groups"]:
        mini_palace_id = int(group["mini_palace_id"])
        question_items = group.get("questions") or []
        hit_count = 0
        source_by_origin = {
            question.id: question
            for question in source_questions
        }
        for item in question_items:
            origin_question_id = item.get("origin_question_id") or item.get("id")
            try:
                origin_question_id_int = int(origin_question_id)
            except (TypeError, ValueError):
                continue
            source_question = source_by_origin.get(origin_question_id_int)
            if source_question is None:
                continue
            upsert_classified_question_copy(
                session,
                source_question=source_question,
                mini_palace_id=mini_palace_id,
            )
            hit_count += 1
            created_or_updated += 1
        mini_palace_hit_counts.append(
            {
                "mini_palace_id": mini_palace_id,
                "mini_palace_name": group.get("mini_palace_name") or f"小宫殿 {mini_palace_id}",
                "question_count": hit_count,
            }
        )
    session.commit()
    return {
        "palace_id": palace_id,
        "mini_palace_groups": mini_palace_hit_counts,
        "unassigned_count": len(grouped_preview.get("unassigned_questions") or []),
        "ai_call_log_id": log_id,
        "copied_question_count": created_or_updated,
    }


def generate_short_answer_feedback(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="quiz_text",
        ai_options=ai_options,
        temperature=0.3,
        timeout_seconds=90,
    )
    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_SHORT_ANSWER:
        raise PalaceQuizValidationError("只有简答题可以生成 AI 点评。")
    answer_payload = serialize_question(question)["answer_payload"]
    reference_answer = str(answer_payload.get("reference_answer") or "").strip()
    normalized_user_answer = str(user_answer or "").strip()
    if not normalized_user_answer:
        raise PalaceQuizValidationError("请先填写你的答案。")
    system_prompt = render_prompt(
        "ai_prompt_palace_quiz_short_answer_feedback",
        {},
        session=session,
    )
    model_input = {
        "stem": question.stem,
        "user_answer": normalized_user_answer,
        "reference_answer": reference_answer,
        "analysis": question.analysis,
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    response_text, log_id = _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_short_answer_feedback",
        palace_id=question.palace_id,
        messages=messages,
        response_format=None,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
        },
    )
    return {
        "question_id": question.id,
        "feedback_text": response_text.strip(),
        "ai_call_log_id": log_id,
    }
