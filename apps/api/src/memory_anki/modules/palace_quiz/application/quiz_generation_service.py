"""Quiz question generation flows (review-mindmap / image / PDF / short-answer).

Extracted from ai_service.py to reduce its size. The generation flow calls the
shared AI runtime (``ai_service._call_logged_chat_completion`` and friends) via
module-attribute access so ``unittest.mock.patch.object(ai_service, ...)`` from
the route tests keeps working.
"""

from __future__ import annotations

import json
import re
from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Chapter, ExternalAiCallLog, Palace
from memory_anki.infrastructure.llm.external_ai_call_logs import get_external_ai_call_log
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
from memory_anki.modules.settings.application.ai_prompt_templates import (
    PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT,
    build_palace_quiz_generation_user_text,
    build_palace_quiz_pdf_pairing_prompt,
    build_palace_quiz_pdf_review_prompt,
    build_palace_quiz_review_mindmap_prompt,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
)

from . import ai_service as _ai
from ._question_utils import (
    build_generation_source_meta as _build_generation_source_meta,
)
from ._question_utils import (
    extract_mini_palace_grouping_payload as _extract_mini_palace_grouping_payload,
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .quiz_grouping_service import (
    group_questions_by_mini_palaces as _group_questions_by_mini_palaces,
    question_payload_for_grouping as _question_payload_for_grouping,
)
from .service import (
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPES,
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    batch_create_chapter_questions,
    get_chapter_or_raise,
    get_palace_or_raise,
    get_question_or_raise,
    serialize_question,
)

QuizStreamEvent = tuple[str, dict[str, Any]]
ScenarioAiOptionsMap = dict[str, AiRuntimeOptions]

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
        PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT
        if is_pdf_question_answer_pairing
        else render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    )
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": build_palace_quiz_generation_user_text(
                source_label=source_label,
                is_pdf_question_answer_pairing=is_pdf_question_answer_pairing,
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
    return build_palace_quiz_pdf_pairing_prompt(extra_prompt)


def _resolve_pdf_step_ai_options(
    *,
    scenario_key: str,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
    legacy_ai_options: AiRuntimeOptions | None = None,
    allow_legacy_fallback: bool = False,
) -> AiRuntimeOptions | None:
    if ai_options_by_scenario and scenario_key in ai_options_by_scenario:
        return ai_options_by_scenario[scenario_key]
    if allow_legacy_fallback:
        return legacy_ai_options
    return None




def _pair_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, str, dict[str, Any]]:
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
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=90,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
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
    return response_text, log_id, resolved_ai


def _recover_pdf_pairing_from_log(
    session: Session,
    *,
    palace_id: int,
    vision_draft_text: str,
    source_context: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, dict[str, Any]]:
    response_text, _log_id, resolved_ai = _pair_pdf_generation_with_turbo(
        session,
        palace_id=palace_id,
        response_text=vision_draft_text,
        source_context=source_context,
        source_meta=source_meta,
        extra_prompt=extra_prompt,
        ai_options=ai_options,
    )
    return response_text, resolved_ai




def _should_review_pdf_generation_with_turbo(enable_secondary_review: bool) -> bool:
    return bool(enable_secondary_review)




def _build_pdf_review_prompt(extra_prompt: str) -> str:
    return build_palace_quiz_pdf_review_prompt(extra_prompt)




def _review_pdf_generation_with_turbo(
    session: Session,
    *,
    palace_id: int,
    response_text: str,
    source_meta: dict[str, Any],
    extra_prompt: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[str, str, dict[str, Any]]:
    system_prompt = _build_pdf_review_prompt(extra_prompt)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": response_text},
    ]
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_review",
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=90,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
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
    return response_text, log_id, resolved_ai
    return response_text, log_id, resolved_ai


def _extract_pdf_candidate_lists(vision_draft_text: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        parsed = json.loads(vision_draft_text)
    except json.JSONDecodeError as exc:
        raise PalaceQuizValidationError("AI 日志里的候选题 JSON 无法解析。") from exc
    if not isinstance(parsed, dict):
        raise PalaceQuizValidationError("AI 日志里的候选题格式不正确。")
    question_candidates = (
        [item for item in parsed.get("question_candidates") if isinstance(item, dict)]
        if isinstance(parsed.get("question_candidates"), list)
        else []
    )
    answer_candidates = (
        [item for item in parsed.get("answer_candidates") if isinstance(item, dict)]
        if isinstance(parsed.get("answer_candidates"), list)
        else []
    )
    if not question_candidates:
        raise PalaceQuizValidationError("AI 日志里没有可恢复的题目候选。")
    return question_candidates, answer_candidates


def _pair_pdf_candidates_deterministically(
    question_candidates: list[dict[str, Any]],
    answer_candidates: list[dict[str, Any]],
) -> str:
    answer_index: dict[tuple[str, str], dict[str, Any]] = {}
    for item in answer_candidates:
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        if not section or not number:
            continue
        answer_index[(section, number)] = item

    questions: list[dict[str, Any]] = []
    for item in question_candidates:
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        stem = str(item.get("stem") or "").strip()
        options_raw = item.get("options")
        if not section or not number or not stem or not isinstance(options_raw, list):
            continue
        matched_answer = answer_index.get((section, number))
        if not matched_answer:
            continue
        correct_option_id = str(matched_answer.get("correct_option_id") or "").strip()
        analysis = str(matched_answer.get("analysis") or "").strip()
        options: list[dict[str, str]] = []
        valid_option_ids: set[str] = set()
        for option in options_raw:
            if not isinstance(option, dict):
                continue
            option_id = str(option.get("id") or "").strip()
            option_text = str(option.get("text") or "").strip()
            if not option_id or not option_text:
                continue
            options.append({"id": option_id, "text": option_text})
            valid_option_ids.add(option_id)
        if len(options) < 2 or correct_option_id not in valid_option_ids or not analysis:
            continue
        questions.append(
            {
                "question_type": "multiple_choice",
                "stem": stem,
                "options": options,
                "correct_option_id": correct_option_id,
                "analysis": analysis,
            }
        )
    if not questions:
        raise PalaceQuizValidationError("AI 日志里的候选题无法恢复为可用题目。")
    return json.dumps({"questions": questions}, ensure_ascii=False)


def _build_pdf_candidate_skip_summary(
    question_candidates: list[dict[str, Any]],
    answer_candidates: list[dict[str, Any]],
    *,
    drafts: list[dict[str, Any]] | None = None,
    unmatched_chapter_candidate_indexes: list[int] | None = None,
) -> list[dict[str, Any]]:
    answer_index: dict[tuple[str, str], dict[str, Any]] = {}
    for item in answer_candidates:
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        if section and number:
            answer_index[(section, number)] = item

    missing_answer_indexes: list[int] = []
    unsupported_indexes: list[int] = []
    insufficient_indexes: list[int] = []
    draft_stems = {
        _normalize_pdf_marker_text(question.get("stem"))
        for question in (drafts or [])
        if isinstance(question, dict) and _normalize_pdf_marker_text(question.get("stem"))
    }
    for index, item in enumerate(question_candidates):
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        answer_candidate = answer_index.get((section, number))
        if not answer_candidate:
            missing_answer_indexes.append(index)
            continue
        if not draft_stems:
            continue
        stem_key = _normalize_pdf_marker_text(item.get("stem"))
        if stem_key and stem_key in draft_stems:
            continue
        if _candidate_supports_known_final_type(item, answer_candidate):
            unsupported_indexes.append(index)
        else:
            insufficient_indexes.append(index)

    result: list[dict[str, Any]] = []
    if missing_answer_indexes:
        result.append(
            {
                "code": "missing_answer_candidate",
                "count": len(missing_answer_indexes),
                "question_indexes": missing_answer_indexes,
            }
        )
    if unsupported_indexes:
        result.append(
            {
                "code": "unsupported_final_question_type",
                "count": len(unsupported_indexes),
                "question_indexes": unsupported_indexes,
            }
        )
    if insufficient_indexes:
        result.append(
            {
                "code": "insufficient_candidate_data",
                "count": len(insufficient_indexes),
                "question_indexes": insufficient_indexes,
            }
        )
    if unmatched_chapter_candidate_indexes:
        result.append(
            {
                "code": "unmatched_chapter_marker",
                "count": len(unmatched_chapter_candidate_indexes),
                "question_indexes": unmatched_chapter_candidate_indexes,
            }
        )
    return result


_PDF_CHAPTER_MARKER_PATTERN = re.compile(r"第\s*[0-9一二三四五六七八九十百千两]+\s*[章节目部分篇讲课单元]")


def _normalize_pdf_marker_text(value: Any) -> str:
    return "".join(str(value or "").strip().lower().split())


def _extract_chapter_markers_from_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    markers: list[str] = []
    seen: set[str] = set()
    for match in _PDF_CHAPTER_MARKER_PATTERN.findall(text):
        normalized = _normalize_pdf_marker_text(match)
        if normalized and normalized not in seen:
            seen.add(normalized)
            markers.append(str(match).strip())
    compact = text if len(text) <= 40 else ""
    normalized_compact = _normalize_pdf_marker_text(compact)
    if compact and normalized_compact and normalized_compact not in seen:
        seen.add(normalized_compact)
        markers.append(compact)
    return markers


def _candidate_supports_known_final_type(
    question_candidate: dict[str, Any],
    answer_candidate: dict[str, Any],
) -> bool:
    options = question_candidate.get("options")
    valid_option_count = 0
    if isinstance(options, list):
        for option in options:
            if not isinstance(option, dict):
                continue
            option_id = str(option.get("id") or "").strip()
            option_text = str(option.get("text") or "").strip()
            if option_id and option_text:
                valid_option_count += 1
    if valid_option_count >= 2 and str(answer_candidate.get("correct_option_id") or "").strip():
        return True
    if str(answer_candidate.get("reference_answer") or "").strip():
        return True
    raw_type_text = " ".join(
        str(value or "").strip()
        for value in (
            question_candidate.get("raw_type_label"),
            answer_candidate.get("raw_type_label"),
        )
        if str(value or "").strip()
    )
    if any(token in raw_type_text for token in ("简答", "论述", "问答", "主观")):
        return True
    if str(answer_candidate.get("raw_answer_text") or "").strip() and not options:
        return True
    return False


def _build_grouped_summary(grouped_questions: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(grouped_questions, dict):
        return []
    child_groups = grouped_questions.get("child_chapter_groups")
    if not isinstance(child_groups, list):
        return []
    summary: list[dict[str, Any]] = []
    for group in child_groups:
        if not isinstance(group, dict):
            continue
        chapter_id = group.get("classified_chapter_id")
        chapter_name = str(group.get("classified_chapter_name") or "").strip()
        questions = group.get("questions")
        if chapter_id is None or not isinstance(questions, list):
            continue
        summary.append(
            {
                "classified_chapter_id": int(chapter_id),
                "classified_chapter_name": chapter_name,
                "question_count": len(questions),
            }
        )
    return summary


def _reuse_grouped_child_chapter_questions_from_log(
    session: Session,
    *,
    ai_call_log_id: str,
    selected_chapter: Chapter,
    drafts: list[dict[str, Any]],
) -> dict[str, Any] | None:
    source_log = session.query(ExternalAiCallLog).filter_by(id=ai_call_log_id).first()
    if not source_log or source_log.created_at is None:
        return None
    candidate_rows = (
        session.query(ExternalAiCallLog)
        .filter(ExternalAiCallLog.operation == "palace_quiz_group_by_child_chapter")
        .filter(ExternalAiCallLog.status == "success")
        .filter(ExternalAiCallLog.created_at >= source_log.created_at)
        .order_by(ExternalAiCallLog.created_at.asc(), ExternalAiCallLog.id.asc())
        .limit(12)
        .all()
    )
    expected_child_ids = {child.id for child in selected_chapter.children or []}
    for row in candidate_rows:
        payload = get_external_ai_call_log(session, row.id)
        if not payload:
            continue
        request_payload = payload.get("request_payload") or {}
        model_input = request_payload.get("model_input") if isinstance(request_payload, dict) else {}
        if not isinstance(model_input, dict):
            continue
        questions = model_input.get("questions")
        mini_palaces = model_input.get("mini_palaces")
        if not isinstance(questions, list) or len(questions) != len(drafts):
            continue
        if not isinstance(mini_palaces, list):
            continue
        mini_palace_ids = {
            int(item.get("mini_palace_id"))
            for item in mini_palaces
            if isinstance(item, dict) and item.get("mini_palace_id") is not None
        }
        if mini_palace_ids != expected_child_ids:
            continue
        response_payload = payload.get("response_payload") or {}
        response_text = str(response_payload.get("response_text") or "").strip()
        if not response_text:
            continue
        grouping_payload = _extract_mini_palace_grouping_payload(response_text)
        return _build_group_questions_by_child_chapter_preview(
            drafts=drafts,
            child_contexts=_flatten_child_chapter_contexts(selected_chapter),
            grouping_payload=grouping_payload,
        )
    return None


def _build_group_questions_by_child_chapter_preview(
    *,
    drafts: list[dict[str, Any]],
    child_contexts: list[dict[str, Any]],
    grouping_payload: dict[str, Any],
) -> dict[str, Any]:
    grouped_items: list[dict[str, Any]] = []
    assigned_indexes: set[int] = set()
    context_by_id = {int(item["mini_palace_id"]): item for item in child_contexts}
    for item in grouping_payload.get("mini_palace_groups", []):
        if not isinstance(item, dict):
            continue
        try:
            child_chapter_id = int(item.get("mini_palace_id"))
        except (TypeError, ValueError):
            continue
        question_indexes = item.get("question_indexes")
        if not isinstance(question_indexes, list):
            continue
        if child_chapter_id not in context_by_id:
            raise PalaceQuizValidationError("章节分类节点必须是当前章节的直接子章节。")
        group_questions: list[dict[str, Any]] = []
        for raw_index in question_indexes:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(drafts) and index not in assigned_indexes:
                assigned_indexes.add(index)
                group_questions.append(
                    {
                        **drafts[index],
                        "classified_chapter_id": child_chapter_id,
                        "mini_palace_id": None,
                    }
                )
        if group_questions:
            grouped_items.append(
                {
                    "classified_chapter_id": child_chapter_id,
                    "classified_chapter_name": context_by_id[child_chapter_id]["name"],
                    "questions": group_questions,
                }
            )
    unassigned_questions: list[dict[str, Any]] = []
    for index, question in enumerate(drafts):
        if index in assigned_indexes:
            continue
        unassigned_questions.append({**question, "classified_chapter_id": None})
    return {
        "child_chapter_groups": grouped_items,
        "unassigned_questions": unassigned_questions,
    }


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
    return build_palace_quiz_review_mindmap_prompt()


def _normalize_outline_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    return normalized or ["multiple_choice", "short_answer"]


def _normalize_outline_question_count(raw_question_count: Any) -> int:
    try:
        count = int(raw_question_count or 5)
    except (TypeError, ValueError):
        count = 5
    return max(1, min(count, 30))


def _chapter_outline_payload(chapter: Chapter) -> dict[str, Any]:
    return {
        "id": chapter.id,
        "name": chapter.name,
        "notes": str(chapter.notes or "").strip(),
        "children": [_chapter_outline_payload(child) for child in (chapter.children or [])],
    }


def _flatten_child_chapter_contexts(chapter: Chapter) -> list[dict[str, Any]]:
    contexts: list[dict[str, Any]] = []
    for child in chapter.children or []:
        contexts.append(
            {
                "mini_palace_id": child.id,
                "name": child.name,
                "node_texts": [child.name, str(child.notes or "").strip()],
                "node_text_summary": "；".join(
                    [item for item in [child.name, str(child.notes or "").strip()] if item]
                ),
            }
        )
    return contexts


def _flatten_descendant_chapter_contexts(
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
        contexts.extend(_flatten_descendant_chapter_contexts(child, depth=depth + 1))
    return contexts


def _resolve_pdf_grouping_scope_contexts(selected_chapter: Chapter | None) -> list[dict[str, Any]]:
    if selected_chapter is None:
        return []
    return _flatten_descendant_chapter_contexts(selected_chapter)


def _select_pdf_question_candidate(
    draft: dict[str, Any],
    question_candidates: list[dict[str, Any]],
    *,
    used_indexes: set[int],
) -> tuple[int | None, dict[str, Any] | None]:
    draft_stem = _normalize_pdf_marker_text(draft.get("stem"))
    if not draft_stem:
        return None, None
    for index, item in enumerate(question_candidates):
        if index in used_indexes or not isinstance(item, dict):
            continue
        candidate_stem = _normalize_pdf_marker_text(item.get("stem"))
        if candidate_stem and candidate_stem == draft_stem:
            return index, item
    fuzzy_matches: list[tuple[int, dict[str, Any]]] = []
    for index, item in enumerate(question_candidates):
        if index in used_indexes or not isinstance(item, dict):
            continue
        candidate_stem = _normalize_pdf_marker_text(item.get("stem"))
        if candidate_stem and (candidate_stem in draft_stem or draft_stem in candidate_stem):
            fuzzy_matches.append((index, item))
    if len(fuzzy_matches) == 1:
        return fuzzy_matches[0]
    return None, None


def _extract_pdf_candidate_markers(question_candidate: dict[str, Any]) -> list[str]:
    markers: list[str] = []
    seen: set[str] = set()
    for raw_value in (
        question_candidate.get("section"),
        question_candidate.get("raw_type_label"),
        question_candidate.get("source_snippet"),
        question_candidate.get("stem"),
    ):
        for marker in _extract_chapter_markers_from_text(raw_value):
            normalized = _normalize_pdf_marker_text(marker)
            if normalized and normalized not in seen:
                seen.add(normalized)
                markers.append(marker)
    return markers


def _match_descendant_chapter_from_candidate_markers(
    question_candidate: dict[str, Any],
    descendant_contexts: list[dict[str, Any]],
) -> dict[str, Any] | None:
    markers = _extract_pdf_candidate_markers(question_candidate)
    if not markers:
        return None
    best_match: dict[str, Any] | None = None
    best_score: tuple[int, int, int] | None = None
    for context in descendant_contexts:
        blob = _normalize_pdf_marker_text(context.get("match_blob"))
        if not blob:
            continue
        marker_hits = 0
        longest_hit = 0
        for marker in markers:
            normalized_marker = _normalize_pdf_marker_text(marker)
            if normalized_marker and normalized_marker in blob:
                marker_hits += 1
                longest_hit = max(longest_hit, len(normalized_marker))
        if marker_hits == 0:
            continue
        score = (marker_hits, int(context.get("depth") or 0), longest_hit)
        if best_score is None or score > best_score:
            best_score = score
            best_match = context
    return best_match


def _group_pdf_questions_by_detected_chapters(
    *,
    drafts: list[dict[str, Any]],
    question_candidates: list[dict[str, Any]],
    selected_chapter: Chapter,
) -> tuple[dict[str, Any], list[int]]:
    descendant_contexts = _resolve_pdf_grouping_scope_contexts(selected_chapter)
    if len(descendant_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有可匹配的下级章节，暂时无法按识别章节分类。")

    grouped_by_chapter: dict[int, dict[str, Any]] = {}
    unassigned_questions: list[dict[str, Any]] = []
    unmatched_candidate_indexes: list[int] = []
    used_candidate_indexes: set[int] = set()

    for draft in drafts:
        candidate_index, question_candidate = _select_pdf_question_candidate(
            draft,
            question_candidates,
            used_indexes=used_candidate_indexes,
        )
        if candidate_index is None or question_candidate is None:
            unassigned_questions.append({**draft, "classified_chapter_id": None})
            continue
        used_candidate_indexes.add(candidate_index)
        matched_context = _match_descendant_chapter_from_candidate_markers(
            question_candidate,
            descendant_contexts,
        )
        if matched_context is None:
            unmatched_candidate_indexes.append(candidate_index)
            unassigned_questions.append({**draft, "classified_chapter_id": None})
            continue
        chapter_id = int(matched_context["chapter_id"])
        group = grouped_by_chapter.setdefault(
            chapter_id,
            {
                "classified_chapter_id": chapter_id,
                "classified_chapter_name": matched_context["name"],
                "questions": [],
            },
        )
        group["questions"].append(
            {
                **draft,
                "classified_chapter_id": chapter_id,
                "mini_palace_id": None,
            }
        )
    return (
        {
            "child_chapter_groups": list(grouped_by_chapter.values()),
            "unassigned_questions": unassigned_questions,
        },
        unmatched_candidate_indexes,
    )


def _chapter_belongs_to_explicit_scope(chapter: Chapter, explicit_ids: set[int]) -> bool:
    current: Chapter | None = chapter
    while current is not None:
        if current.id in explicit_ids:
            return True
        current = current.parent
    return False


def _chapter_contains_explicit_scope(
    session: Session,
    *,
    chapter: Chapter,
    explicit_ids: set[int],
) -> bool:
    for explicit_id in explicit_ids:
        explicit_chapter = get_chapter_or_raise(session, explicit_id)
        current: Chapter | None = explicit_chapter
        while current is not None:
            if current.id == chapter.id:
                return True
            current = current.parent
    return False


def _resolve_selected_generation_chapter(
    session: Session,
    *,
    palace: Palace,
    selected_chapter_id: int | None,
) -> Chapter | None:
    if selected_chapter_id is None:
        return None
    chapter = get_chapter_or_raise(session, selected_chapter_id)
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    if not explicit_ids:
        raise PalaceQuizValidationError("当前宫殿还没有绑定可用章节，无法选择题目所属范围。")
    if not _chapter_belongs_to_explicit_scope(
        chapter,
        explicit_ids,
    ) and not _chapter_contains_explicit_scope(
        session,
        chapter=chapter,
        explicit_ids=explicit_ids,
    ):
        raise PalaceQuizValidationError("所选章节不在当前宫殿已绑定的章节范围内。")
    return chapter


def _apply_source_chapter_to_drafts(
    drafts: list[dict[str, Any]],
    *,
    chapter_id: int | None,
) -> None:
    if chapter_id is None:
        return
    for draft in drafts:
        draft["source_chapter_id"] = chapter_id


def _group_questions_by_child_chapters(
    session: Session,
    *,
    drafts: list[dict[str, Any]],
    child_contexts: list[dict[str, Any]],
    feature: str,
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    grouping_system_prompt = render_prompt(
        "ai_prompt_palace_quiz_group_by_mini_palace",
        {},
        session=session,
    )
    grouping_input = {
        "mini_palaces": child_contexts,
        "questions": [
            _question_payload_for_grouping(question, index)
            for index, question in enumerate(drafts)
        ],
    }
    grouping_messages = [
        {"role": "system", "content": grouping_system_prompt},
        {"role": "user", "content": json.dumps(grouping_input, ensure_ascii=False)},
    ]
    grouping_config, grouping_extra_payload, _ = _ai._build_chat_config(
        session,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    grouping_response_text, _ = _ai._call_logged_chat_completion(
        config=grouping_config,
        extra_payload=grouping_extra_payload,
        feature=feature,
        operation=operation,
        palace_id=None,
        messages=grouping_messages,
        response_format={"type": "json_object"},
        request_payload={
            "prompt": grouping_system_prompt,
            "messages": grouping_messages,
            "model_input": grouping_input,
        },
    )
    grouping_payload = _extract_mini_palace_grouping_payload(grouping_response_text)
    return _build_group_questions_by_child_chapter_preview(
        drafts=drafts,
        child_contexts=child_contexts,
        grouping_payload=grouping_payload,
    )




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
        scenario_key="quiz_review_mindmap_generation",
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


def generate_quiz_preview_from_chapter_outline(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    extra_prompt: str,
    classify_by_child_chapter: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    chapter = get_chapter_or_raise(session, chapter_id)
    normalized_question_types = _normalize_outline_question_types(question_types)
    normalized_question_count = _normalize_outline_question_count(question_count)
    child_contexts = _flatten_child_chapter_contexts(chapter)
    if classify_by_child_chapter and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前章节没有下级小节，暂时无法按宫殿分类。")

    source_meta = _build_generation_source_meta(
        source_kind="chapter_outline",
        generation_mode="chapter_outline_grouped" if classify_by_child_chapter else "chapter_outline",
        extra_prompt=extra_prompt,
    )
    source_meta["source_chapter_id"] = chapter.id

    system_prompt = render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    model_input = {
        "selected_chapter": _chapter_outline_payload(chapter),
        "question_count": normalized_question_count,
        "allowed_question_types": normalized_question_types,
        "task": "请严格基于所给章节与下级小节内容生成题目，不要扩展到该章节范围之外。",
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        messages.append(
            {
                "role": "system",
                "content": "用户临时补充要求必须优先严格遵守。\n" + normalized_extra_prompt,
            }
        )
    messages.append({"role": "user", "content": json.dumps(model_input, ensure_ascii=False)})
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_image_generation",
        ai_options=ai_options,
        temperature=0.25,
        timeout_seconds=120,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
        config=config,
        extra_payload=extra_payload,
        feature="章节做题",
        operation="chapter_quiz_generate_outline",
        palace_id=None,
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
    _apply_source_chapter_to_drafts(drafts, chapter_id=chapter.id)

    grouped_questions = None
    if classify_by_child_chapter:
        grouped_questions = _group_questions_by_child_chapters(
            session,
            drafts=drafts,
            child_contexts=child_contexts,
            feature="章节做题",
            operation="chapter_quiz_group_by_child_chapter",
            ai_options=ai_options,
        )
        source_meta["generation_mode"] = "chapter_outline_grouped"
    return {
        "chapter_id": chapter_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
        "grouped_questions": grouped_questions,
        "resolved_ai": resolved_ai,
    }




def generate_quiz_preview_from_images(
    session: Session,
    *,
    palace_id: int,
    image_items: list[tuple[bytes, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
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
    selected_chapter = _resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
    child_contexts = (
        _flatten_child_chapter_contexts(selected_chapter) if selected_chapter is not None else []
    )
    if selected_chapter is not None and classify_by_mini_palace and len(child_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
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
    if selected_chapter is not None:
        source_meta["source_chapter_id"] = selected_chapter.id
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
    _apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    grouped_questions = None
    if classify_by_mini_palace:
        grouped_questions = (
            _group_questions_by_child_chapters(
                session,
                drafts=drafts,
                child_contexts=child_contexts,
                feature="宫殿做题",
                operation="palace_quiz_group_by_child_chapter",
                ai_options=ai_options,
            )
            if selected_chapter is not None
            else _group_questions_by_mini_palaces(
                session,
                palace=palace,
                questions=drafts,
                operation="ai_prompt_palace_quiz_group_by_mini_palace",
                ai_options=ai_options,
            )[0]
        )
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
        "grouped_questions": grouped_questions,
        "resolved_ai": resolved_ai,
    }




def _prepare_pdf_generation_request(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool = False,
    pdf_sources: list[dict[str, Any]] | None = None,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
) -> dict[str, Any]:
    generation_ai_options = _resolve_pdf_step_ai_options(
        scenario_key="quiz_pdf_generation",
        ai_options_by_scenario=ai_options_by_scenario,
        legacy_ai_options=ai_options,
        allow_legacy_fallback=True,
    )
    config, extra_payload, resolved_ai = _ai._build_chat_config(
        session,
        scenario_key="quiz_pdf_generation",
        ai_options=generation_ai_options,
        temperature=0.2,
        timeout_seconds=120,
    )
    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = _resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
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
        secondary_review_enabled=enable_secondary_review,
        subject_document_id=primary_subject_document_id,
        page_numbers=sorted({page for page in all_page_numbers if page > 0}),
        image_names=all_image_names,
        pdf_sources=source_items,
    )
    if selected_chapter is not None:
        source_meta["source_chapter_id"] = selected_chapter.id
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
        "selected_chapter": selected_chapter,
        "config": config,
        "extra_payload": extra_payload,
        "source_meta": source_meta,
        "source_context": source_context,
        "system_prompt": system_prompt,
        "messages": messages,
        "image_items": image_items,
        "resolved_ai": resolved_ai,
        "generation_ai_options": generation_ai_options,
        "resolved_ai_steps": {"generation": resolved_ai},
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
    selected_chapter: Chapter | None = None,
    ai_options: AiRuntimeOptions | None = None,
    resolved_ai_steps: dict[str, Any] | None = None,
    vision_draft_text: str | None = None,
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
    _apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    grouped_questions = None
    if classify_by_mini_palace:
        if selected_chapter is not None and vision_draft_text:
            question_candidates, _answer_candidates = _extract_pdf_candidate_lists(vision_draft_text)
            grouped_questions, _unmatched_indexes = _group_pdf_questions_by_detected_chapters(
                drafts=drafts,
                question_candidates=question_candidates,
                selected_chapter=selected_chapter,
            )
        elif selected_chapter is not None:
            child_contexts = _flatten_child_chapter_contexts(selected_chapter)
            if len(child_contexts) == 0:
                raise PalaceQuizValidationError("当前范围没有下级小节，暂时无法按宫殿分类。")
            grouped_questions = _group_questions_by_child_chapters(
                session,
                drafts=drafts,
                child_contexts=child_contexts,
                feature="宫殿做题",
                operation="palace_quiz_group_by_child_chapter",
                ai_options=ai_options,
            )
        else:
            grouped_questions = _group_questions_by_mini_palaces(
                session,
                palace=palace,
                questions=drafts,
                operation="ai_prompt_palace_quiz_group_by_mini_palace",
                ai_options=ai_options,
            )[0]
    return {
        "palace_id": palace_id,
        "questions": drafts,
        "source_meta": source_meta,
        "ai_call_log_id": log_id,
        "warnings": warnings,
        "generation_stats": generation_stats,
        "grouped_questions": grouped_questions,
        "resolved_ai": source_meta.get("resolved_ai"),
        "resolved_ai_steps": resolved_ai_steps or {"generation": source_meta.get("resolved_ai")},
    }




def generate_quiz_preview_from_pdf(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool = False,
    pdf_sources: list[dict[str, Any]] | None = None,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
) -> dict[str, Any]:
    prepared = _prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        pdf_sources=pdf_sources,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    vision_draft_text: str | None = None
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
    resolved_ai_steps = dict(prepared.get("resolved_ai_steps") or {})
    if _should_pair_pdf_generation_with_turbo(prepared["source_meta"]):
        vision_draft_text = response_text
        response_text, log_id, pairing_resolved_ai = _pair_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_context=prepared["source_context"],
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
            ai_options=_resolve_pdf_step_ai_options(
                scenario_key="quiz_pdf_pairing",
                ai_options_by_scenario=ai_options_by_scenario,
            ),
        )
        resolved_ai_steps["pairing"] = pairing_resolved_ai
    if _should_review_pdf_generation_with_turbo(enable_secondary_review):
        response_text, log_id, review_resolved_ai = _review_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
            ai_options=_resolve_pdf_step_ai_options(
                scenario_key="quiz_pdf_review",
                ai_options_by_scenario=ai_options_by_scenario,
            ),
        )
        resolved_ai_steps["review"] = review_resolved_ai
    return _build_pdf_generation_preview_result(
        session,
        palace=prepared["palace"],
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
        source_meta=prepared["source_meta"],
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=prepared["selected_chapter"],
        ai_options=ai_options,
        resolved_ai_steps=resolved_ai_steps,
        vision_draft_text=vision_draft_text,
    )




def generate_quiz_preview_from_pdf_events(
    session: Session,
    *,
    palace_id: int,
    subject_document_id: int,
    page_selection: list[int],
    extra_prompt: str,
    enable_secondary_review: bool = False,
    pdf_sources: list[dict[str, Any]] | None = None,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
) -> Generator[QuizStreamEvent, None, None]:
    total_steps = 4 if pdf_sources else 3
    yield ("status", {"phase": "preparing", "message": "正在准备 PDF 页面", "step": 1, "total": total_steps})
    prepared = _prepare_pdf_generation_request(
        session,
        palace_id=palace_id,
        subject_document_id=subject_document_id,
        page_selection=page_selection,
        extra_prompt=extra_prompt,
        enable_secondary_review=enable_secondary_review,
        pdf_sources=pdf_sources,
        selected_chapter_id=selected_chapter_id,
        ai_options=ai_options,
        ai_options_by_scenario=ai_options_by_scenario,
    )
    should_pair_with_turbo = _should_pair_pdf_generation_with_turbo(prepared["source_meta"])
    vision_draft_text: str | None = None
    resolved_ai_steps = dict(prepared.get("resolved_ai_steps") or {})
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
        vision_draft_text = response_text
        yield ("status", {"phase": "pairing", "message": "正在用 Turbo 配对题目与答案", "step": 3, "total": total_steps})
        response_text, log_id, pairing_resolved_ai = _pair_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_context=prepared["source_context"],
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
            ai_options=_resolve_pdf_step_ai_options(
                scenario_key="quiz_pdf_pairing",
                ai_options_by_scenario=ai_options_by_scenario,
            ),
        )
        resolved_ai_steps["pairing"] = pairing_resolved_ai
    if _should_review_pdf_generation_with_turbo(enable_secondary_review):
        yield ("status", {"phase": "reviewing", "message": "正在复核题目范围", "step": total_steps, "total": total_steps})
        response_text, log_id, review_resolved_ai = _review_pdf_generation_with_turbo(
            session,
            palace_id=palace_id,
            response_text=response_text,
            source_meta=prepared["source_meta"],
            extra_prompt=extra_prompt,
            ai_options=_resolve_pdf_step_ai_options(
                scenario_key="quiz_pdf_review",
                ai_options_by_scenario=ai_options_by_scenario,
            ),
        )
        resolved_ai_steps["review"] = review_resolved_ai
    yield ("status", {"phase": "normalizing", "message": "正在整理可保存题目", "step": total_steps, "total": total_steps})
    result = _build_pdf_generation_preview_result(
        session,
        palace=prepared["palace"],
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
        source_meta=prepared["source_meta"],
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=prepared["selected_chapter"],
        ai_options=ai_options,
        resolved_ai_steps=resolved_ai_steps,
        vision_draft_text=vision_draft_text,
    )
    yield ("result", result)


def recover_quiz_preview_from_ai_call_log(
    session: Session,
    *,
    palace_id: int,
    ai_call_log_id: str,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    log_payload = get_external_ai_call_log(session, ai_call_log_id)
    if not log_payload:
        raise PalaceQuizValidationError("AI 日志不存在，无法恢复题目。")
    request_payload = log_payload.get("request_payload") or {}
    response_payload = log_payload.get("response_payload") or {}
    if not isinstance(request_payload, dict) or not isinstance(response_payload, dict):
        raise PalaceQuizValidationError("AI 日志内容不完整，无法恢复题目。")
    model_input = request_payload.get("messages")
    if not isinstance(model_input, list) or len(model_input) < 2:
        raise PalaceQuizValidationError("AI 日志里缺少可恢复的题答配对输入。")
    user_message = model_input[-1]
    vision_draft_text = ""
    source_context = ""
    if isinstance(user_message, dict):
        try:
            user_payload = json.loads(str(user_message.get("content") or "{}"))
        except json.JSONDecodeError as exc:
            raise PalaceQuizValidationError("AI 日志里的配对输入无法解析。") from exc
        vision_draft_text = str(user_payload.get("vision_draft") or "").strip()
        source_context = str(user_payload.get("source_context") or "").strip()
    if not vision_draft_text or not source_context:
        raise PalaceQuizValidationError("AI 日志里缺少候选题或来源说明，无法恢复题目。")

    source_meta = request_payload.get("source_meta") if isinstance(request_payload.get("source_meta"), dict) else {}
    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = _resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=(
            selected_chapter_id
            if selected_chapter_id is not None
            else (
                int(source_meta.get("source_chapter_id"))
                if source_meta.get("source_chapter_id") not in (None, "", 0, "0")
                else None
            )
        ),
    )
    recovered_source_meta = {
        **source_meta,
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "extra_prompt": str(source_meta.get("extra_prompt") or "").strip(),
        "secondary_review_enabled": False,
        "recovered_from_ai_call_log_id": ai_call_log_id,
    }
    if selected_chapter is not None:
        recovered_source_meta["source_chapter_id"] = selected_chapter.id
    pairing_response_text, pairing_resolved_ai = _recover_pdf_pairing_from_log(
        session,
        palace_id=palace_id,
        vision_draft_text=vision_draft_text,
        source_context=source_context,
        source_meta=recovered_source_meta,
        extra_prompt=str(source_meta.get("extra_prompt") or "").strip(),
        ai_options=ai_options,
    )
    return _build_pdf_generation_preview_result(
        session,
        palace=palace,
        palace_id=palace_id,
        response_text=pairing_response_text,
        log_id=ai_call_log_id,
        source_meta=recovered_source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter=selected_chapter,
        ai_options=ai_options,
        resolved_ai_steps={"pairing": pairing_resolved_ai},
        vision_draft_text=vision_draft_text,
    )


def recover_quiz_questions_from_ai_call_log_and_save(
    session: Session,
    *,
    palace_id: int,
    ai_call_log_id: str,
    selected_chapter_id: int,
    classify_by_mini_palace: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    if selected_chapter_id <= 0:
        raise PalaceQuizValidationError("请先选择要写入的章节范围。")
    log_payload = get_external_ai_call_log(session, ai_call_log_id)
    if not log_payload:
        raise PalaceQuizValidationError("AI 日志不存在，无法恢复题目。")
    request_payload = log_payload.get("request_payload") or {}
    if not isinstance(request_payload, dict):
        raise PalaceQuizValidationError("AI 日志内容不完整，无法恢复题目。")
    model_input = request_payload.get("messages")
    if not isinstance(model_input, list) or len(model_input) < 2:
        raise PalaceQuizValidationError("AI 日志里缺少可恢复的题答配对输入。")
    user_message = model_input[-1]
    vision_draft_text = ""
    source_context = ""
    if isinstance(user_message, dict):
        try:
            user_payload = json.loads(str(user_message.get("content") or "{}"))
        except json.JSONDecodeError as exc:
            raise PalaceQuizValidationError("AI 日志里的配对输入无法解析。") from exc
        vision_draft_text = str(user_payload.get("vision_draft") or "").strip()
        source_context = str(user_payload.get("source_context") or "").strip()
    if not vision_draft_text or not source_context:
        raise PalaceQuizValidationError("AI 日志里缺少候选题或来源说明，无法恢复题目。")

    source_meta = request_payload.get("source_meta") if isinstance(request_payload.get("source_meta"), dict) else {}
    palace = get_palace_or_raise(session, palace_id)
    selected_chapter = _resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
    question_candidates, answer_candidates = _extract_pdf_candidate_lists(vision_draft_text)
    pairing_response_text = _pair_pdf_candidates_deterministically(
        question_candidates,
        answer_candidates,
    )
    recovered_source_meta = {
        **source_meta,
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "extra_prompt": str(source_meta.get("extra_prompt") or "").strip(),
        "secondary_review_enabled": False,
        "recovered_from_ai_call_log_id": ai_call_log_id,
        "source_chapter_id": selected_chapter.id,
    }
    pairing_response_text, _pairing_resolved_ai = _recover_pdf_pairing_from_log(
        session,
        palace_id=palace_id,
        vision_draft_text=vision_draft_text,
        source_context=source_context,
        source_meta=recovered_source_meta,
        extra_prompt=str(source_meta.get("extra_prompt") or "").strip(),
        ai_options=ai_options,
    )
    drafts, warnings, generation_stats = _normalize_generated_question_drafts(
        pairing_response_text,
        source_meta=recovered_source_meta,
    )
    _apply_source_chapter_to_drafts(drafts, chapter_id=selected_chapter.id)
    question_candidates, answer_candidates = _extract_pdf_candidate_lists(vision_draft_text)

    grouped_questions = None
    unmatched_chapter_candidate_indexes: list[int] = []
    if classify_by_mini_palace:
        grouped_questions, unmatched_chapter_candidate_indexes = _group_pdf_questions_by_detected_chapters(
            drafts=drafts,
            question_candidates=question_candidates,
            selected_chapter=selected_chapter,
        )
    skipped_reasons = _build_pdf_candidate_skip_summary(
        question_candidates,
        answer_candidates,
        drafts=drafts,
        unmatched_chapter_candidate_indexes=unmatched_chapter_candidate_indexes,
    )

    if grouped_questions and grouped_questions.get("child_chapter_groups"):
        questions_to_save = [
            {
                **question,
                "source_chapter_id": selected_chapter.id,
                "classified_chapter_id": group["classified_chapter_id"],
                "mini_palace_id": None,
            }
            for group in grouped_questions["child_chapter_groups"]
            for question in group.get("questions", [])
        ]
        questions_to_save.extend(
            {
                **question,
                "source_chapter_id": selected_chapter.id,
                "classified_chapter_id": None,
                "mini_palace_id": None,
            }
            for question in grouped_questions.get("unassigned_questions", [])
        )
    else:
        questions_to_save = [
            {
                **question,
                "source_chapter_id": selected_chapter.id,
                "classified_chapter_id": None,
                "mini_palace_id": None,
            }
            for question in drafts
        ]

    if not questions_to_save:
        raise PalaceQuizValidationError("AI 日志里没有可写入题库的题目。")

    items = batch_create_chapter_questions(session, selected_chapter.id, questions_to_save)
    saved_count = len(items)
    recovered_count = len(questions_to_save)
    return {
        "items": items,
        "ai_call_log_id": ai_call_log_id,
        "recovered_count": recovered_count,
        "saved_count": saved_count,
        "deduped_count": recovered_count - saved_count,
        "grouped_summary": _build_grouped_summary(grouped_questions),
        "generation_stats": generation_stats,
        "warnings": warnings,
        "skipped_reasons": skipped_reasons,
    }




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
