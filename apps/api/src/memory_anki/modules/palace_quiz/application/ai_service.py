from __future__ import annotations

import json
from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
    DASHSCOPE_VISION_MODEL,
)
from memory_anki.infrastructure.db.models import Config
from memory_anki.infrastructure.db.models import Palace
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
    stream_chat_completion_text,
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
from memory_anki.modules.mindmap.application.editor_state_service import _deserialize
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
    QUESTION_TYPES,
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


def _build_generation_messages(
    *,
    session: Session,
    extra_prompt: str,
    source_label: str,
    image_items: list[tuple[bytes, str | None]],
    source_context: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    is_pdf_question_answer_pairing = bool(
        source_context
        and "题目来源" in source_context
        and "答案与解析来源" in source_context
    )
    system_prompt = (
        (
            "你是扫描版 PDF 视觉抄录助手，只输出 JSON，不要 markdown。"
            "本次资料包含题目册和答案册；不要生成最终题库，只完整抄录候选。"
            "输出格式：{\"question_candidates\":[],\"answer_candidates\":[]}。"
            "question_candidates 按题目来源页从上到下抄录所有单项选择题，"
            "字段含 section、number、stem、options[{id,text}]；保留 A/B/C/D 原文和顺序。"
            "answer_candidates 按答案来源页抄录 section、number、correct_option_id、analysis。"
            "必须包含同一英国章节内的所有栏目，例如真题典例、模拟练习；"
            "不要在页面中途或下一个非英国章节标题前漏掉题。"
            "如用户限定英国，只跳过明显法国/德国/美国/日本等非英国题；不确定先保留。"
        )
        if is_pdf_question_answer_pairing
        else render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    )
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                (
                    "请完整抄录接下来 PDF 图片中的题目候选和答案候选。"
                    f"当前来源：{source_label}。"
                    "题目来源页里每一道单项选择题都要抄录；答案来源页里每个对应答案和解析都要抄录。"
                    "不要补题，不要改写选项，不要提前丢弃英国章节内的模拟练习。"
                )
                if is_pdf_question_answer_pairing
                else (
                    "请基于接下来提供的资料生成题目。"
                    f"当前来源：{source_label}。"
                    "如果资料里已经有现成题号、序号或题型，请优先按原题抽取；"
                    "如果没有明确题目，请基于资料内容补出适量题目，数量和题型由你自行判断。"
                )
            ),
        }
    ]
    if source_context:
        user_content.append({"type": "text", "text": source_context})
    for image_bytes, filename in image_items:
        user_content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        range_guard = ""
        if "只要" in normalized_extra_prompt or "仅" in normalized_extra_prompt:
            range_guard = (
                "\n如果材料中有不符合该范围限定的原题，必须直接跳过，不要改写成题目；"
                "最终 questions 数组只能包含满足限定范围的题目。"
            )
            if "英国" in normalized_extra_prompt:
                range_guard += (
                    "只要英国=仅保留英国教育、英国学校/法案/大学、英国教育家相关题；"
                    "欧美多国比较题以及德国、法国、美国、俄国等非英国题跳过。"
                )
        messages.append(
            {
                "role": "system",
                "content": (
                    "用户临时补充要求必须优先严格遵守；如果补充要求限定范围，"
                    "不要生成范围外题目。\n"
                    f"{normalized_extra_prompt}{range_guard}"
                ),
            }
        )
    if is_pdf_question_answer_pairing:
        messages.append(
            {
                "role": "system",
                "content": (
                    "重点检查：同一英国章节内若出现“模拟练习”，其中单项选择题也必须抄录。"
                    "看见“第二节 法国近代教育”等非英国章节后，后续题可跳过。"
                ),
            }
        )
    messages.append({"role": "user", "content": user_content})
    return messages, system_prompt


def _normalize_pdf_sources_input(
    raw_pdf_sources: Any,
    *,
    legacy_subject_document_id: int | None = None,
    legacy_page_selection: list[int] | None = None,
) -> list[dict[str, Any]]:
    def normalize_role_hint(raw_value: Any) -> str:
        normalized = str(raw_value or "").strip().lower()
        if normalized in {"question", "questions", "题目", "题目册", "练习", "习题"}:
            return "question"
        if normalized in {"answer", "answers", "答案", "答案册", "解析", "答案解析"}:
            return "answer"
        return ""

    normalized_sources: list[dict[str, Any]] = []
    if isinstance(raw_pdf_sources, list):
        for item in raw_pdf_sources:
            if not isinstance(item, dict):
                continue
            try:
                subject_document_id = int(item.get("subject_document_id") or 0)
            except (TypeError, ValueError):
                continue
            page_selection_raw = item.get("page_selection")
            if not isinstance(page_selection_raw, list):
                page_selection_raw = []
            normalized_pages = sorted(
                {int(page) for page in page_selection_raw if int(page) > 0}
            )
            if subject_document_id <= 0 or len(normalized_pages) == 0:
                continue
            normalized_sources.append(
                {
                    "subject_document_id": subject_document_id,
                    "page_selection": normalized_pages,
                    "role_hint": normalize_role_hint(item.get("role_hint")),
                }
            )
    if normalized_sources:
        return normalized_sources
    normalized_legacy_pages = sorted(
        {int(page) for page in (legacy_page_selection or []) if int(page) > 0}
    )
    if legacy_subject_document_id and normalized_legacy_pages:
        return [
            {
                "subject_document_id": int(legacy_subject_document_id),
                "page_selection": normalized_legacy_pages,
                "role_hint": "",
            }
        ]
    return []


def _build_pdf_source_context(pdf_sources: list[dict[str, Any]]) -> str:
    role_labels = {
        "question": "题目来源",
        "answer": "答案与解析来源",
    }
    lines = [
        "下面会按顺序提供多份 PDF 页面，请按用户标注的角色综合整合。",
        "角色为“题目来源”的 PDF 优先抽取题干和选项；角色为“答案与解析来源”的 PDF 同时提供答案和解析。",
        "如果不同 PDF 分别是题目册和答案册，请优先把对应答案与解析对齐到同一题里。",
        "如果无法完全一一对应，也要尽量根据题号、顺序、关键词和知识点做最合理匹配。",
        "保留题目来源里的原始选项文字和 A/B/C/D 顺序，不要重排或改写选项。",
        "所选页如有现成选择题，尽量抽取全部符合用户范围的题，不要自行精选少量题。",
        "不要因为来源分散就重复出题；同一题只保留一份整合后的结果。",
        "资料来源清单：",
    ]
    for index, item in enumerate(pdf_sources, start=1):
        role_hint = role_labels.get(str(item.get("role_hint") or "").strip(), "未指定")
        document_name = str(item.get("document_name") or "").strip() or f"PDF {index}"
        page_numbers = item.get("page_numbers") or []
        page_text = ",".join(str(page) for page in page_numbers) if page_numbers else "未提供页码"
        lines.append(
            f"{index}. {document_name}；页码：{page_text}；用户提示角色：{role_hint}"
        )
    return "\n".join(lines)


def _should_pair_pdf_generation_with_turbo(source_meta: dict[str, Any]) -> bool:
    pdf_sources = source_meta.get("pdf_sources")
    if not isinstance(pdf_sources, list) or len(pdf_sources) < 2:
        return False
    roles = {str(item.get("role_hint") or "").strip() for item in pdf_sources if isinstance(item, dict)}
    return "question" in roles and "answer" in roles


def _build_pdf_pairing_prompt(extra_prompt: str) -> str:
    normalized_extra_prompt = str(extra_prompt or "").strip()
    range_rule = ""
    if "英国" in normalized_extra_prompt:
        range_rule = (
            "范围：只保留英国教育、英国学校/法案/大学、英国教育家；欧美综合题和非英国国家题跳过。"
            "即使题目位于英国章节内，只要题干考点是德国/法国/美国/日本教育或非英国教育家，也必须跳过；干扰项可保留。\n"
            "保留例子：洛克、斯宾塞、英国公学、英国初等学校、苏格兰大学、福斯特法案、新大学运动、大学推广运动。"
            "跳过例子：题干考查“德国教育家第斯多惠”的题不是英国题，必须跳过。\n"
        )
    return (
        "你是题目册-答案册配对助手。根据视觉模型初稿和资料角色说明，输出最终题库 JSON。\n"
        f"{range_rule}"
        "视觉初稿可能是 question_candidates/answer_candidates；你必须把它转换为最终 questions 数组，禁止原样返回候选字段。\n"
        "最终每题格式：{\"question_type\":\"multiple_choice\",\"stem\":\"...\",\"options\":[{\"id\":\"A\",\"text\":\"...\"}],\"correct_option_id\":\"A\",\"analysis\":\"...\"}。\n"
        "规则：题目来源提供题干/选项，答案来源提供答案/解析；按栏目+题号优先配对，无法配对的题不要输出。\n"
        "同号但栏目不同的题不能合并，例如真题典例1和模拟练习1是两道题。\n"
        "必须保留题目来源原始选项文字和 A/B/C/D 顺序，禁止重排、替换或按答案重写选项。\n"
        "根据答案/解析文字选择对应选项 id；若解析字母与选项文字冲突，以答案文字匹配到的选项为准。\n"
        "输出前逐题自检：correct_option_id 指向的选项文字必须与答案/解析一致，否则整题跳过。\n"
        "每题必须输出 analysis，优先使用答案来源的解析；如果解析很短，也要保留答案依据，禁止省略。\n"
        "选择题 options 只能是 {\"id\":\"A\",\"text\":\"...\"}，correct_option_id 必须等于已有 id。\n"
        "只输出 multiple_choice；尽量保留所选页全部可配对且符合范围的选择题，不要只挑重点题。\n"
        f"用户补充：{normalized_extra_prompt or '无'}\n"
        "只输出 {\"questions\":[...]}，不要 markdown。"
    )


def _pair_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
) -> tuple[str, str]:
    system_prompt = _build_pdf_pairing_prompt(extra_prompt)
    model_input = {
        "source_context": source_context,
        "vision_draft": response_text,
    }
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="quiz_mini_palace",
        ai_options=AiRuntimeOptions(model="qwen-plus", thinking_enabled=False),
        temperature=0.0,
        timeout_seconds=90,
    )
    return _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_pair_pdf_with_turbo",
        palace_id=palace_id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "source_meta": source_meta,
        },
    )


def _should_review_pdf_generation_with_turbo(extra_prompt: str) -> bool:
    normalized_extra_prompt = str(extra_prompt or "").strip()
    return "英国" in normalized_extra_prompt


def _build_pdf_review_prompt(extra_prompt: str) -> str:
    normalized_extra_prompt = str(extra_prompt or "").strip()
    return (
        "你是题库最终范围审核助手，只输出最终题库 JSON：{\"questions\":[...]}。\n"
        "任务：检查输入 questions，只保留英国教育、英国学校/法案/大学、英国教育家相关题。\n"
        "必须删除：题干考查德国/法国/美国/日本教育或非英国教育家的题。"
        "特别删除：题干含“德国教育家第斯多惠”或“形式教育与实质教育基本观点”的题。\n"
        "必须保留：洛克、斯宾塞、英国公学、英国初等学校、苏格兰大学、福斯特法案、新大学运动、大学推广运动相关题。\n"
        "不得改写题干、选项、答案和解析；只做保留/删除。"
        "每题仍必须含 question_type、stem、options、correct_option_id、analysis。\n"
        f"用户补充：{normalized_extra_prompt or '无'}"
    )


def _review_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
) -> tuple[str, str]:
    system_prompt = _build_pdf_review_prompt(extra_prompt)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": response_text},
    ]
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="quiz_mini_palace",
        ai_options=AiRuntimeOptions(model="qwen-turbo", thinking_enabled=False),
        temperature=0.0,
        timeout_seconds=90,
    )
    return _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_review_pdf_with_turbo",
        palace_id=palace_id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "source_meta": source_meta,
        },
    )


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


def _node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    data = node.get("data") if isinstance(node.get("data"), dict) else {}
    return str(data.get("text") or node.get("text") or "").strip()


def _node_children(node: Any) -> list[Any]:
    if not isinstance(node, dict):
        return []
    children = node.get("children")
    return children if isinstance(children, list) else []


def _compact_mindmap_for_prompt(editor_doc: Any, *, max_nodes: int = 160) -> dict[str, Any]:
    doc = _deserialize(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    count = 0

    def walk(node: Any, depth: int = 0) -> dict[str, Any] | None:
        nonlocal count
        if not isinstance(node, dict) or count >= max_nodes:
            return None
        text = _node_text(node)
        children = _node_children(node)
        count += 1
        return {
            "text": text,
            "children": [
                child_payload
                for child in children
                if (child_payload := walk(child, depth + 1)) is not None
            ],
        }

    compact = walk(root)
    return compact or {"text": "", "children": []}


def _extract_first_multi_node_summary(editor_doc: Any, *, max_items: int = 24) -> list[str]:
    doc = _deserialize(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    if not isinstance(root, dict):
        return []
    current_level = _node_children(root)
    while current_level:
        texts = [_node_text(node) for node in current_level if _node_text(node)]
        if len(texts) >= 2:
            return texts[:max_items]
        next_level: list[Any] = []
        for node in current_level:
            next_level.extend(_node_children(node))
        current_level = next_level
    return []


def _normalize_review_mindmap_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in REVIEW_MINDMAP_QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    if not normalized:
        normalized = list(REVIEW_MINDMAP_QUESTION_TYPES.keys())
    invalid = [item for item in normalized if item not in QUESTION_TYPES]
    if invalid:
        raise PalaceQuizValidationError("包含暂不支持的题型：" + "、".join(invalid))
    return normalized


def _normalize_review_mindmap_question_count(raw_question_count: Any) -> int:
    try:
        question_count = int(raw_question_count)
    except (TypeError, ValueError):
        question_count = 5
    return max(1, min(question_count, 12))


def _build_related_palace_summaries(
    session: Session,
    *,
    current_palace_id: int,
    related_palace_ids: Any,
) -> list[dict[str, Any]]:
    if not isinstance(related_palace_ids, list):
        return []
    normalized_ids: list[int] = []
    for raw_id in related_palace_ids:
        try:
            palace_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if palace_id > 0 and palace_id != current_palace_id and palace_id not in normalized_ids:
            normalized_ids.append(palace_id)
    if not normalized_ids:
        return []
    rows = (
        session.query(Palace)
        .filter(Palace.id.in_(normalized_ids))
        .order_by(Palace.id.asc())
        .all()
    )
    summaries: list[dict[str, Any]] = []
    for palace in rows:
        first_multi_nodes = _extract_first_multi_node_summary(palace.editor_doc)
        if not first_multi_nodes:
            continue
        subject = None
        primary_chapter = getattr(palace, "primary_chapter", None)
        if primary_chapter is not None and getattr(primary_chapter, "subject", None) is not None:
            subject = {
                "id": primary_chapter.subject.id,
                "name": primary_chapter.subject.name,
            }
        summaries.append(
            {
                "palace_id": palace.id,
                "title": palace.title,
                "subject": subject,
                "first_multi_nodes": first_multi_nodes,
            }
        )
    return summaries


def _review_mindmap_system_prompt() -> str:
    return """你是复习小游戏出题助手。只基于输入脑图/关联宫殿摘要出题，禁止资料外扩写；只输出 JSON：{"questions":[...]}。
每题必须含 question_type、stem、analysis，题型只能来自 allowed_question_types，数量尽量等于 question_count。
字段约束：
- multiple_choice: options[{id,text}], correct_option_id 必须等于某个选项 id。
- true_false: correct_answer 必须为布尔值，false_explanation 写错误点。
- fill_blank: stem 用 {{blank_1}} 占位，blanks[{id,answer,aliases}]，最多 3 空。
- matching: pairs[{left_id,left,right_id,right}]，至少 2 组。
- ordering: items[{id,text}], correct_order_ids 覆盖全部 item id。
- categorization: categories[{id,name}], items[{id,text,category_id}]。
- short_answer: reference_answer。"""


def generate_quiz_preview_from_review_mindmap(
    session: Session,
    *,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    palace = get_palace_or_raise(session, palace_id)
    normalized_mode = str(mode or "chapter").strip()
    if normalized_mode not in {"chapter", "cross_palace"}:
        raise PalaceQuizValidationError("做题休息模式必须是 chapter 或 cross_palace。")
    normalized_question_types = _normalize_review_mindmap_question_types(question_types)
    normalized_question_count = _normalize_review_mindmap_question_count(question_count)
    current_mindmap = _compact_mindmap_for_prompt(review_editor_doc)
    related_summaries = (
        _build_related_palace_summaries(
            session,
            current_palace_id=palace_id,
            related_palace_ids=related_palace_ids or [],
        )
        if normalized_mode == "cross_palace"
        else []
    )
    if normalized_mode == "cross_palace" and not related_summaries:
        raise PalaceQuizValidationError("跨宫殿联系模式至少需要一个可用的关联宫殿摘要。")
    source_meta = _build_generation_source_meta(
        source_kind="review_mindmap",
        generation_mode=(
            "review_cross_palace" if normalized_mode == "cross_palace" else "review_chapter"
        ),
        extra_prompt="",
    )
    source_meta.update(
        {
            "review_mode": normalized_mode,
            "question_types": normalized_question_types,
            "question_count": normalized_question_count,
            "related_palace_ids": [item["palace_id"] for item in related_summaries],
            "related_palace_summaries": related_summaries,
        }
    )
    model_input = {
        "current_palace": {"id": palace.id, "title": palace.title},
        "mode": normalized_mode,
        "question_count": normalized_question_count,
        "allowed_question_types": [
            {"type": item, "label": REVIEW_MINDMAP_QUESTION_TYPES[item]}
            for item in normalized_question_types
        ],
        "current_review_mindmap": current_mindmap,
        "related_palaces": related_summaries,
    }
    system_prompt = _review_mindmap_system_prompt()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="quiz_text",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    response_text, log_id = _call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_review_mindmap",
        palace_id=palace_id,
        messages=messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "source_meta": source_meta,
        },
    )
    source_meta["ai_call_log_id"] = log_id
    source_meta["generated_at"] = utc_now_naive().isoformat()
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
        "grouped_questions": None,
        "related_palace_summaries": related_summaries,
    }


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
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
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


def _prepare_pdf_generation_request(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    pdf_sources: list[dict[str, Any]] | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    config, extra_payload = _build_chat_config(
        session,
        scenario_key="vision",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    palace = get_palace_or_raise(session, palace_id)
    normalized_sources = _normalize_pdf_sources_input(
        pdf_sources,
        legacy_subject_document_id=subject_document_id,
        legacy_page_selection=page_selection,
    )
    if len(normalized_sources) == 0:
        raise PalaceQuizValidationError("请至少添加一份 PDF，并为每份 PDF 选择页码。")

    image_items: list[tuple[bytes, str | None]] = []
    source_items: list[dict[str, Any]] = []
    all_page_numbers: list[int] = []
    all_image_names: list[str] = []
    source_labels: list[str] = []
    primary_subject_document_id: int | None = None

    for index, source in enumerate(normalized_sources, start=1):
        document = get_subject_document_by_id(session, source["subject_document_id"])
        if not document:
            raise PalaceQuizNotFoundError("PDF 资料不存在。")
        normalized_pages = sorted(
            {int(page) for page in source["page_selection"] if int(page) > 0}
        )
        if len(normalized_pages) == 0:
            raise PalaceQuizValidationError("每份 PDF 至少需要选择一页。")
        rendered_pages = render_selected_pdf_pages(
            document,
            page_numbers=normalized_pages,
            kind="preview",
        )
        image_items.extend((image_bytes, filename) for _, image_bytes, filename in rendered_pages)
        all_page_numbers.extend(normalized_pages)
        all_image_names.extend(
            [filename for _, _, filename in rendered_pages if str(filename or "").strip()]
        )
        role_hint = str(source.get("role_hint") or "").strip() or None
        source_items.append(
            {
                "subject_document_id": document.id,
                "document_name": document.original_name,
                "page_numbers": normalized_pages,
                "image_names": [filename for _, _, filename in rendered_pages],
                "role_hint": role_hint,
            }
        )
        source_labels.append(
            f"资料{index}《{document.original_name}》第 {', '.join(str(page) for page in normalized_pages)} 页"
        )
        if primary_subject_document_id is None:
            primary_subject_document_id = document.id

    source_meta = _build_generation_source_meta(
        source_kind="subject_pdf",
        generation_mode="subject_pdf_multi" if len(source_items) > 1 else "subject_pdf",
        extra_prompt=extra_prompt,
        subject_document_id=primary_subject_document_id,
        page_numbers=sorted({page for page in all_page_numbers if page > 0}),
        image_names=all_image_names,
        pdf_sources=source_items,
    )
    source_context = _build_pdf_source_context(source_items)
    messages, system_prompt = _build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label="；".join(source_labels),
        image_items=image_items,
        source_context=source_context,
    )
    return {
        "palace": palace,
        "config": config,
        "extra_payload": extra_payload,
        "source_meta": source_meta,
        "source_context": source_context,
        "system_prompt": system_prompt,
        "messages": messages,
        "image_items": image_items,
    }


def _build_pdf_generation_preview_result(
    session: Session,
    *,
    palace: Any,
    palace_id: int,
    response_text: str,
    log_id: str,
    source_meta: dict[str, Any],
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    source_meta["ai_call_log_id"] = log_id
    source_meta["generated_at"] = _build_generation_source_meta(
        source_kind=source_meta["source_kind"],
        generation_mode=source_meta["generation_mode"],
        extra_prompt=source_meta["extra_prompt"],
        subject_document_id=source_meta["subject_document_id"],
        page_numbers=source_meta["page_numbers"],
        image_names=source_meta["image_names"],
        ai_call_log_id=log_id,
        pdf_sources=source_meta.get("pdf_sources"),
    )["generated_at"]
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
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
    pdf_sources: list[dict[str, Any]] | None = None,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    _ensure_ai_ready()
    prepared = _prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        pdf_sources=pdf_sources,
        ai_options=ai_options,
    )
    response_text, log_id = _call_logged_chat_completion(
        config=prepared["config"],
        extra_payload=prepared["extra_payload"],
        feature="宫殿做题",
        operation="palace_quiz_generate_pdf",
        palace_id=palace_id,
        messages=prepared["messages"],
        response_format={"type": "json_object"},
        request_payload={
            "prompt": prepared["system_prompt"],
            "message_roles": [message.get("role") for message in prepared["messages"]],
            "response_format": {"type": "json_object"},
            "source_meta": prepared["source_meta"],
            "source_context": prepared["source_context"],
        },
        image_items=prepared["image_items"],
    )
    if _should_pair_pdf_generation_with_turbo(prepared["source_meta"]):
        response_text, log_id = _pair_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_context=prepared["source_context"],
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
        )
    if _should_review_pdf_generation_with_turbo(extra_prompt):
        response_text, log_id = _review_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
        )
    return _build_pdf_generation_preview_result(
        session,
        palace=prepared["palace"],
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
        source_meta=prepared["source_meta"],
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
    )


def generate_quiz_preview_from_pdf_events(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    pdf_sources: list[dict[str, Any]] | None = None,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> Generator[QuizStreamEvent, None, None]:
    _ensure_ai_ready()
    total_steps = 4 if pdf_sources else 3
    yield ("status", {"phase": "preparing", "message": "正在准备 PDF 页面", "step": 1, "total": total_steps})
    prepared = _prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        pdf_sources=pdf_sources,
        ai_options=ai_options,
    )
    should_pair_with_turbo = _should_pair_pdf_generation_with_turbo(prepared["source_meta"])
    total_steps = 4 if should_pair_with_turbo else 3
    yield ("status", {"phase": "generating", "message": "正在调用视觉模型识别题目", "step": 2, "total": total_steps})
    stream = _call_logged_chat_completion_stream(
        config=prepared["config"],
        extra_payload=prepared["extra_payload"],
        feature="宫殿做题",
        operation="palace_quiz_generate_pdf_stream",
        palace_id=palace_id,
        messages=prepared["messages"],
        response_format={"type": "json_object"},
        request_payload={
            "prompt": prepared["system_prompt"],
            "message_roles": [message.get("role") for message in prepared["messages"]],
            "response_format": {"type": "json_object"},
            "source_meta": prepared["source_meta"],
            "source_context": prepared["source_context"],
        },
        image_items=prepared["image_items"],
    )
    while True:
        try:
            delta = next(stream)
        except StopIteration as exc:
            response_text, log_id = exc.value
            break
        yield ("delta", {"text": delta})
    if should_pair_with_turbo:
        yield ("status", {"phase": "pairing", "message": "正在用 Turbo 配对题目与答案", "step": 3, "total": total_steps})
        response_text, log_id = _pair_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_context=prepared["source_context"],
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
        )
    if _should_review_pdf_generation_with_turbo(extra_prompt):
        yield ("status", {"phase": "reviewing", "message": "正在复核题目范围", "step": total_steps, "total": total_steps})
        response_text, log_id = _review_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
        )
    yield ("status", {"phase": "normalizing", "message": "正在整理可保存题目", "step": total_steps, "total": total_steps})
    result = _build_pdf_generation_preview_result(
        session,
        palace=prepared["palace"],
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
        source_meta=prepared["source_meta"],
        classify_by_mini_palace=classify_by_mini_palace,
        ai_options=ai_options,
    )
    yield ("result", result)


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
