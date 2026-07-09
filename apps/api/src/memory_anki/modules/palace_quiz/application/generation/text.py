"""Merged text quiz generation helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions
from memory_anki.modules.settings.application.ai_prompt_templates import (
    build_palace_quiz_text_formatting_prompt,
)

from .._question_utils import (
    build_generation_source_meta,
    extract_questions_payload,
    finalize_generation_source_meta,
    normalize_generated_question_drafts,
)
from ..manual_text_quiz_parser import parse_manual_text_quiz_pairs
from ..question_contracts import PalaceQuizValidationError
from ..questions.dedup import filter_global_duplicate_import_questions
from .images import ImageGenerationRequestContext, load_image_generation_request_context
from .ocr_sources import build_text_file_ocr_sources
from .shared import (
    apply_source_chapter_to_drafts,
    build_quiz_generation_preview_result,
    group_questions_for_preview_scope,
)


# === quiz_generation_text_request.py ===
@dataclass(frozen=True, slots=True)
class TextGenerationPreparedRequest:
    palace: Any
    selected_chapter: Any
    child_contexts: list[dict[str, Any]]
    config: Any
    extra_payload: dict[str, Any]
    source_meta: dict[str, Any]
    system_prompt: str
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    file_artifacts: list[dict[str, Any]]
    resolved_ai: dict[str, Any]


def _ai_service():
    from .. import ai_service

    return ai_service


def prepare_text_generation_request(
    session: Session,
    *,
    palace_id: int,
    file_artifacts: list[dict[str, Any]],
    extra_prompt: str,
    classify_by_mini_palace: bool,
    selected_chapter_id: int | None,
    ai_options: AiRuntimeOptions | None,
) -> TextGenerationPreparedRequest:
    request_context = load_image_generation_request_context(
        session,
        palace_id=palace_id,
        classify_by_mini_palace=classify_by_mini_palace,
        selected_chapter_id=selected_chapter_id,
    )
    ai = _ai_service()
    config, extra_payload, resolved_ai = ai._build_chat_config(
        session,
        scenario_key="quiz_text_generation",
        ai_options=ai_options,
        temperature=0.0,
        timeout_seconds=120,
    )
    source_meta = build_text_generation_source_meta(
        context=request_context,
        file_artifacts=file_artifacts,
        extra_prompt=extra_prompt,
    )
    messages, system_prompt, model_input = build_text_generation_messages(
        extra_prompt=extra_prompt,
        file_artifacts=file_artifacts,
        prompt_override=ai_options.prompt_override if ai_options else None,
    )
    return TextGenerationPreparedRequest(
        palace=request_context.palace,
        selected_chapter=request_context.selected_chapter,
        child_contexts=request_context.child_contexts,
        config=config,
        extra_payload=extra_payload,
        source_meta=source_meta,
        system_prompt=system_prompt,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "message_roles": [message.get("role") for message in messages],
            "response_format": {"type": "json_object"},
            "source_meta": source_meta,
            "resolved_ai": resolved_ai,
            "input_artifacts": model_input,
        },
        file_artifacts=file_artifacts,
        resolved_ai=resolved_ai,
    )


__all__ = [
    "TextGenerationPreparedRequest",
    "prepare_text_generation_request",
]

# === quiz_generation_text_request_payload.py ===
def build_text_generation_source_meta(
    *,
    context: ImageGenerationRequestContext,
    file_artifacts: list[dict[str, Any]],
    extra_prompt: str,
) -> dict[str, Any]:
    file_names = [str(item.get("filename") or f"text-{index + 1}.txt") for index, item in enumerate(file_artifacts)]
    source_meta = build_generation_source_meta(
        source_kind="text_files",
        generation_mode="text_files_multi" if len(file_artifacts) > 1 else "text_files",
        extra_prompt=extra_prompt,
        image_names=file_names,
    )
    if context.selected_chapter is not None:
        source_meta["source_chapter_id"] = context.selected_chapter.id
    return source_meta


def build_text_generation_model_input(
    *,
    file_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "files": [
            {
                "filename": item.get("filename"),
                "extension": item.get("extension"),
                "mime_type": item.get("mime_type"),
                "content": item.get("decoded_text"),
            }
            for item in file_artifacts
        ]
    }


def build_text_generation_messages(
    *,
    extra_prompt: str,
    file_artifacts: list[dict[str, Any]],
    prompt_override: str | None = None,
) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    system_prompt = (
        str(prompt_override).strip()
        if prompt_override and str(prompt_override).strip()
        else build_palace_quiz_text_formatting_prompt(extra_prompt)
    )
    model_input = build_text_generation_model_input(file_artifacts=file_artifacts)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return messages, system_prompt, model_input


__all__ = [
    "build_text_generation_messages",
    "build_text_generation_model_input",
    "build_text_generation_source_meta",
]

# === quiz_generation_text_support.py ===
TEXT_FILE_EXTENSIONS = {".txt", ".md", ".markdown", ".json"}
TEXT_FILE_DECODE_ENCODINGS = ("utf-8", "utf-8-sig", "utf-16", "gb18030")


def normalize_text_file_extension(filename: str | None) -> str:
    return Path(str(filename or "")).suffix.lower()


def validate_text_file_upload(*, filename: str | None, content: bytes) -> str:
    extension = normalize_text_file_extension(filename)
    if extension not in TEXT_FILE_EXTENSIONS:
        raise PalaceQuizValidationError("仅支持上传 txt、md、markdown、json 文本文件。")
    if not content:
        raise PalaceQuizValidationError("未读取到文本文件内容。")
    return extension


def decode_text_file_content(content: bytes) -> str:
    for encoding in TEXT_FILE_DECODE_ENCODINGS:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise PalaceQuizValidationError("文本文件编码无法识别。")


def build_text_file_artifact(
    *,
    filename: str | None,
    mime_type: str | None,
    content: bytes,
) -> dict[str, Any]:
    extension = validate_text_file_upload(filename=filename, content=content)
    return {
        "filename": str(filename or "untitled" + extension),
        "extension": extension,
        "mime_type": str(mime_type or "text/plain"),
        "decoded_text": decode_text_file_content(content),
    }


def parse_json_text_or_none(text: str) -> dict[str, Any] | list[Any] | None:
    normalized = str(text or "").strip()
    if not normalized:
        return None
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict | list):
        return parsed
    return None


def is_standard_questions_payload(parsed: object) -> bool:
    return isinstance(parsed, dict) and isinstance(parsed.get("questions"), list)


def is_candidate_questions_payload(parsed: object) -> bool:
    if not isinstance(parsed, dict):
        return False
    return isinstance(parsed.get("question_candidates"), list) and isinstance(
        parsed.get("answer_candidates"), list
    )


__all__ = [
    "TEXT_FILE_DECODE_ENCODINGS",
    "TEXT_FILE_EXTENSIONS",
    "build_text_file_artifact",
    "decode_text_file_content",
    "is_candidate_questions_payload",
    "is_standard_questions_payload",
    "normalize_text_file_extension",
    "parse_json_text_or_none",
    "validate_text_file_upload",
]

# === quiz_generation_text_preview.py ===
def project_text_generation_preview_result(
    session: Session,
    *,
    palace: Any,
    palace_id: int,
    log_id: str,
    source_meta: dict[str, Any],
    classify_by_mini_palace: bool,
    drafts: list[dict[str, Any]],
    warnings: list[str],
    generation_stats: dict[str, Any],
    selected_chapter: Any = None,
    child_contexts: list[dict[str, Any]] | None = None,
    ai_options: AiRuntimeOptions | None = None,
    resolved_ai: dict[str, Any] | None = None,
    ocr_sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    finalize_generation_source_meta(source_meta, ai_call_log_id=log_id)
    grouped_questions = None
    if classify_by_mini_palace:
        grouped_questions = group_questions_for_preview_scope(
            session,
            palace=palace,
            drafts=drafts,
            selected_chapter=selected_chapter,
            child_contexts=child_contexts,
            feature="宫殿做题",
            child_chapter_operation="palace_quiz_group_by_child_chapter",
            mini_palace_operation="ai_prompt_palace_quiz_group_by_mini_palace",
            ai_options=ai_options,
        )
    return build_quiz_generation_preview_result(
        scope_key="palace_id",
        scope_id=palace_id,
        questions=drafts,
        source_meta=source_meta,
        log_id=log_id,
        warnings=warnings,
        generation_stats=generation_stats,
        grouped_questions=grouped_questions,
        resolved_ai=resolved_ai,
        extra_fields={"ocr_sources": ocr_sources or []},
    )


def build_text_generation_preview_result(
    session: Session,
    *,
    prepared_request: TextGenerationPreparedRequest,
    palace_id: int,
    response_text: str,
    log_id: str,
    classify_by_mini_palace: bool,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    drafts, warnings, generation_stats = normalize_generated_question_drafts(
        response_text,
        source_meta=prepared_request.source_meta,
    )
    selected_chapter = prepared_request.selected_chapter
    apply_source_chapter_to_drafts(
        drafts,
        chapter_id=selected_chapter.id if selected_chapter is not None else None,
    )
    return project_text_generation_preview_result(
        session,
        palace=prepared_request.palace,
        palace_id=palace_id,
        log_id=log_id,
        source_meta=prepared_request.source_meta,
        classify_by_mini_palace=classify_by_mini_palace,
        drafts=drafts,
        warnings=warnings,
        generation_stats=generation_stats,
        selected_chapter=selected_chapter,
        child_contexts=prepared_request.child_contexts,
        ai_options=ai_options,
        resolved_ai=prepared_request.resolved_ai,
        ocr_sources=build_text_file_ocr_sources(
            file_artifacts=prepared_request.file_artifacts,
            source_meta=prepared_request.source_meta,
        ),
    )


__all__ = [
    "build_text_generation_preview_result",
    "project_text_generation_preview_result",
]

# === quiz_generation_text_files.py ===
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

    ocr_sources = build_text_file_ocr_sources(
        file_artifacts=file_artifacts,
        source_meta=source_meta,
    )
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
        ocr_sources=ocr_sources,
    )


__all__ = ["generate_quiz_preview_from_text_files"]
