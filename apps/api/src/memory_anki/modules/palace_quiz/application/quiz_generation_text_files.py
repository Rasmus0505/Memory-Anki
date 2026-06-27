"""Text-file based quiz generation runtime."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import extract_questions_payload, normalize_generated_question_drafts
from .question_contracts import PalaceQuizValidationError
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


def _collect_direct_questions(file_artifacts: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    direct_questions: list[dict[str, Any]] = []
    ai_required_artifacts: list[dict[str, Any]] = []
    for artifact in file_artifacts:
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
    return direct_questions, ai_required_artifacts


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
        "subject_document_id": None,
        "page_numbers": None,
        "image_names": [str(item.get("filename") or "") for item in file_artifacts],
        "extra_prompt": str(extra_prompt or "").strip(),
        "secondary_review_enabled": False,
        "ai_call_log_id": None,
        "generated_at": None,
        "generation_mode": "text_files_multi" if len(file_artifacts) > 1 else "text_files",
        "pdf_sources": None,
    }
    if request_context.selected_chapter is not None:
        source_meta["source_chapter_id"] = request_context.selected_chapter.id

    direct_questions, ai_required_artifacts = _collect_direct_questions(file_artifacts)
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
