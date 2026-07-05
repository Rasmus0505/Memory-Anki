"""Text-file based quiz generation runtime."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import extract_questions_payload, normalize_generated_question_drafts
from .manual_text_quiz_parser import parse_manual_text_quiz_pairs
from .question_contracts import PalaceQuizValidationError
from .question_import_dedup import filter_global_duplicate_import_questions
from .quiz_generation_chaptering import apply_source_chapter_to_drafts
from .quiz_generation_image_request_context import load_image_generation_request_context
from .quiz_generation_text_preview import project_text_generation_preview_result
from .quiz_generation_text_request import prepare_text_generation_request
from .quiz_generation_text_support import (
    build_text_file_artifact,
    is_candidate_questions_payload,
    is_standard_questions_payload,
    parse_json_text_or_none,
)


def _ai_service():
    from . import ai_service

    return ai_service


def _manual_text_role(filename: str) -> str | None:
    normalized = Path(str(filename or "")).stem.lower()
    if "questions" in normalized or "question" in normalized or "题目" in normalized:
        return "question"
    if "answers" in normalized or "answer" in normalized or "答案" in normalized:
        return "answer"
    return None


def _manual_pair_key(filename: str) -> str:
    stem = Path(str(filename or "")).stem.lower()
    for token in ("questions", "question", "answers", "answer", "题目", "答案"):
        stem = stem.replace(token, "")
    return stem.strip("_- .") or "manual"


def _collect_manual_text_questions(
    file_artifacts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], set[int]]:
    questions_by_key: dict[str, list[dict[str, Any]]] = {}
    answers_by_key: dict[str, list[dict[str, Any]]] = {}
    for index, artifact in enumerate(file_artifacts):
        if artifact.get("extension") not in {".txt", ".md", ".markdown"}:
            continue
        role = _manual_text_role(str(artifact.get("filename") or ""))
        if not role:
            continue
        key = _manual_pair_key(str(artifact.get("filename") or ""))
        target = questions_by_key if role == "question" else answers_by_key
        target.setdefault(key, []).append({"index": index, "artifact": artifact})

    direct_questions: list[dict[str, Any]] = []
    warnings: list[str] = []
    consumed_indexes: set[int] = set()
    for key, question_items in questions_by_key.items():
        answer_items = answers_by_key.get(key) or []
        if not answer_items and len(questions_by_key) == 1 and len(answers_by_key) == 1:
            answer_items = next(iter(answers_by_key.values()))
        if not answer_items:
            continue
        question_text = "\n".join(
            str(item["artifact"].get("decoded_text") or "") for item in question_items
        )
        answer_text = "\n".join(
            str(item["artifact"].get("decoded_text") or "") for item in answer_items
        )
        source_names = [
            str(item["artifact"].get("filename") or "")
            for item in [*question_items, *answer_items]
        ]
        parsed, parse_warnings = parse_manual_text_quiz_pairs(
            question_text=question_text,
            answer_text=answer_text,
            source_filename=" + ".join(name for name in source_names if name),
        )
        if not parsed:
            continue
        direct_questions.extend(item.to_payload() for item in parsed)
        warnings.extend(parse_warnings)
        consumed_indexes.update(int(item["index"]) for item in [*question_items, *answer_items])
    return direct_questions, warnings, consumed_indexes


def _collect_direct_questions(
    file_artifacts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    direct_questions: list[dict[str, Any]] = []
    ai_required_artifacts: list[dict[str, Any]] = []
    warnings: list[str] = []
    manual_questions, manual_warnings, consumed_indexes = _collect_manual_text_questions(
        file_artifacts
    )
    direct_questions.extend(manual_questions)
    warnings.extend(manual_warnings)
    for index, artifact in enumerate(file_artifacts):
        if index in consumed_indexes:
            continue
        parsed = (
            parse_json_text_or_none(str(artifact.get("decoded_text") or ""))
            if artifact.get("extension") == ".json"
            else None
        )
        if is_standard_questions_payload(parsed):
            for item in parsed.get("questions", []):
                if isinstance(item, dict):
                    direct_questions.append(item)
            continue
        if parsed is not None and not (
            is_candidate_questions_payload(parsed) or isinstance(parsed, dict) or isinstance(parsed, list)
        ):
            raise PalaceQuizValidationError("JSON 文件格式不正确。")
        ai_required_artifacts.append(artifact)
    return direct_questions, ai_required_artifacts, warnings


def generate_quiz_preview_from_text_files(
    session: Session,
    *,
    palace_id: int,
    file_items: list[tuple[bytes, str | None, str | None]],
    extra_prompt: str,
    classify_by_mini_palace: bool = False,
    selected_chapter_id: int | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    file_artifacts = [
        build_text_file_artifact(filename=filename, mime_type=mime_type, content=content)
        for content, filename, mime_type in file_items
    ]
    if len(file_artifacts) == 0:
        raise PalaceQuizValidationError("请至少上传一个文本文件。")

    request_context = load_image_generation_request_context(
        session,
        palace_id=palace_id,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
    )
    source_meta = {
        "source_kind": "text_files",
        "page_numbers": None,
        "image_names": [str(item.get("filename") or "") for item in file_artifacts],
        "extra_prompt": str(extra_prompt or "").strip(),
        "secondary_review_enabled": False,
        "ai_call_log_id": None,
        "generated_at": None,
        "generation_mode": "text_files_multi" if len(file_artifacts) > 1 else "text_files",
    }
    if request_context.selected_chapter is not None:
        source_meta["source_chapter_id"] = request_context.selected_chapter.id

    direct_questions, ai_required_artifacts, warnings = _collect_direct_questions(file_artifacts)
    raw_questions = list(direct_questions)
    log_id = ""
    resolved_ai: dict[str, Any] | None = None

    if ai_required_artifacts:
        prepared_request = prepare_text_generation_request(
            session,
            palace_id=palace_id,
            file_artifacts=ai_required_artifacts,
            extra_prompt=extra_prompt,
            classify_by_mini_palace=classify_by_mini_palace,
            selected_chapter_id=selected_chapter_id,
            ai_options=ai_options,
        )
        response_text, log_id = _ai_service()._call_logged_chat_completion(
            config=prepared_request.config,
            extra_payload=prepared_request.extra_payload,
            feature="宫殿做题",
            operation="palace_quiz_generate_text_files",
            palace_id=palace_id,
            messages=prepared_request.messages,
            response_format={"type": "json_object"},
            request_payload=prepared_request.request_payload,
        )
        raw_questions.extend(extract_questions_payload(response_text))
        source_meta = prepared_request.source_meta
        resolved_ai = prepared_request.resolved_ai
        source_meta["resolved_ai"] = resolved_ai

    if not raw_questions:
        raise PalaceQuizValidationError("没有识别到可生成的题目。")

    response_text = json.dumps({"questions": raw_questions}, ensure_ascii=False)
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=source_meta,
    )
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=request_context.selected_chapter.id
        if request_context.selected_chapter is not None
        else None,
    )
    drafts, global_duplicate_count = filter_global_duplicate_import_questions(
        session,
        drafts,
        warnings,
    )
    if global_duplicate_count:
        generation_stats["savable_count"] = max(
            0,
            int(generation_stats.get("savable_count") or 0) - global_duplicate_count,
        )
        generation_stats["skipped_count"] = int(generation_stats.get("skipped_count") or 0) + global_duplicate_count
    if not drafts:
        raise PalaceQuizValidationError("识别到的题目都已存在或无法保存。")
    return project_text_generation_preview_result(
        session,
        palace=request_context.palace,
        palace_id=palace_id,
        log_id=log_id,
        source_meta=source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        drafts=drafts,
        warnings=warnings,
        generation_stats=generation_stats,
        selected_chapter=request_context.selected_chapter,
        child_contexts=request_context.child_contexts,
        ai_options=ai_options,
        resolved_ai=resolved_ai,
    )


__all__ = ["generate_quiz_preview_from_text_files"]
