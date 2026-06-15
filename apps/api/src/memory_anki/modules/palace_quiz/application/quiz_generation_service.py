"""Quiz question generation flows (review-mindmap / image / PDF / short-answer).

Extracted from ai_service.py to reduce its size. The generation flow calls the
shared AI runtime (``ai_service._call_logged_chat_completion`` and friends) via
module-attribute access so ``unittest.mock.patch.object(ai_service, ...)`` from
the route tests keeps working.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Palace
from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
)
from memory_anki.modules.mindmap.application.editor_state_service import _deserialize
from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    build_image_content_part,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from . import ai_service as _ai
from ._question_utils import (
    build_generation_source_meta as _build_generation_source_meta,
)
from ._question_utils import (
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .quiz_grouping_service import (
    group_questions_by_mini_palaces as _group_questions_by_mini_palaces,
)
from .service import (
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPES,
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    get_palace_or_raise,
    get_question_or_raise,
    serialize_question,
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
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_pairing",
        ai_options=None,
        temperature=0.0,
        timeout_seconds=90,
    )
    return _ai._call_logged_chat_completion(
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
            "resolved_ai": resolved_ai,
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
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_review",
        ai_options=None,
        temperature=0.0,
        timeout_seconds=90,
    )
    return _ai._call_logged_chat_completion(
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
            "resolved_ai": resolved_ai,
        },
    )




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
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_short_answer_feedback",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
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
            "resolved_ai": resolved_ai,
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
        "resolved_ai": resolved_ai,
    }




def generate_quiz_preview_from_images(
    session: Session,
    *,
    palace_id: int,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_image_generation",
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
    response_text, log_id = _ai._call_logged_chat_completion(
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
            "resolved_ai": resolved_ai,
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
        "resolved_ai": resolved_ai,
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
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_generation",
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
        rendered_pages = _ai.render_selected_pdf_pages(
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
    source_meta["resolved_ai"] = resolved_ai
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
        "resolved_ai": resolved_ai,
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
        "resolved_ai": source_meta.get("resolved_ai"),
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
    prepared = _prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        pdf_sources=pdf_sources,
        ai_options=ai_options,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
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
            "resolved_ai": prepared["resolved_ai"],
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
    stream = _ai._call_logged_chat_completion_stream(
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
            "resolved_ai": prepared["resolved_ai"],
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




def generate_short_answer_feedback(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_short_answer_feedback",
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
    response_text, log_id = _ai._call_logged_chat_completion(
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
            "resolved_ai": resolved_ai,
        },
    )
    return {
        "question_id": question.id,
        "feedback_text": response_text.strip(),
        "ai_call_log_id": log_id,
        "resolved_ai": resolved_ai,
    }


# Grouping logic moved to quiz_grouping_service.py; re-exported here so
# internal callers (generate_quiz_preview_from_images / pdf / classify) and
# any external `from .ai_service import _group_questions_by_mini_palaces`
# keep resolving. Imported at module tail to avoid a circular import
# (quiz_grouping_service does `from . import ai_service as _ai`).
