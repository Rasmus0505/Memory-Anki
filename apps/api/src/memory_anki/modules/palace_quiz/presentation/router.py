from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
from memory_anki.modules.palace_quiz.application.ai_service import (
    PalaceQuizAiError,
    classify_existing_quiz_questions_to_mini_palaces,
    explain_question,
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_review_mindmap,
    generate_quiz_preview_from_text_files,
    generate_short_answer_feedback,
)
from memory_anki.modules.palace_quiz.application.service import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    batch_create_chapter_questions,
    batch_create_questions,
    batch_delete_questions,
    create_question,
    delete_question,
    dedupe_chapter_questions,
    dedupe_palace_questions,
    list_aggregated_questions,
    list_chapter_questions,
    list_palace_ocr_sources,
    list_questions,
    record_choice_attempt,
    reset_question_attempts,
    update_question,
    upsert_palace_ocr_sources,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    normalize_ai_runtime_options,
)

router = APIRouter(tags=["palace_quiz"])


def _quiz_sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, PalaceQuizNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, PalaceQuizValidationError | PalaceQuizAiError):
        raise HTTPException(status_code=400, detail=str(error)) from error
    raise error


def _normalize_ai_runtime_options_by_scenario(value: object) -> dict[str, AiRuntimeOptions] | None:
    if not isinstance(value, dict):
        return None
    normalized: dict[str, AiRuntimeOptions] = {}
    for raw_key, raw_options in value.items():
        scenario_key = str(raw_key or "").strip()
        if not scenario_key:
            continue
        normalized[scenario_key] = normalize_ai_runtime_options(raw_options)
    return normalized or None


@router.get("/palaces/{palace_id}/quiz-questions")
def api_list_palace_quiz_questions(palace_id: int, s: Session = Depends(session_dep)):
    try:
        return {"items": list_questions(s, palace_id)}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-questions/dedupe")
def api_dedupe_palace_quiz_questions(palace_id: int, s: Session = Depends(session_dep)):
    try:
        deduped_count = dedupe_palace_questions(s, palace_id)
        if deduped_count:
            maybe_create_rolling_backup("rolling-dedupe-palace-quiz-questions")
        return {"ok": True, "deduped_count": deduped_count}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.get("/palaces/{palace_id}/aggregated-quiz-questions")
def api_list_aggregated_palace_quiz_questions(palace_id: int, s: Session = Depends(session_dep)):
    try:
        return {"items": list_aggregated_questions(s, palace_id)}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.get("/palaces/{palace_id}/quiz-ocr-sources")
def api_list_palace_quiz_ocr_sources(palace_id: int, s: Session = Depends(session_dep)):
    try:
        return {"items": list_palace_ocr_sources(s, palace_id)}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.get("/chapters/{chapter_id}/quiz-questions")
def api_list_chapter_quiz_questions(chapter_id: int, s: Session = Depends(session_dep)):
    try:
        return {"items": list_chapter_questions(s, chapter_id)}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/chapters/{chapter_id}/quiz-questions/dedupe")
def api_dedupe_chapter_quiz_questions(chapter_id: int, s: Session = Depends(session_dep)):
    try:
        deduped_count = dedupe_chapter_questions(s, chapter_id)
        if deduped_count:
            maybe_create_rolling_backup("rolling-dedupe-chapter-quiz-questions")
        return {"ok": True, "deduped_count": deduped_count}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-questions")
def api_create_palace_quiz_question(
    palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        item = create_question(s, palace_id, data)
        maybe_create_rolling_backup("rolling-create-palace-quiz-question")
        return {"item": item}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-questions/batch")
def api_batch_create_palace_quiz_questions(
    palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        payloads = data.get("questions") if isinstance(data, dict) else None
        items = batch_create_questions(s, palace_id, payloads if isinstance(payloads, list) else [])
        ocr_sources = data.get("ocr_sources") if isinstance(data, dict) else None
        if isinstance(ocr_sources, list) and ocr_sources:
            upsert_palace_ocr_sources(s, palace_id=palace_id, payloads=ocr_sources)
        maybe_create_rolling_backup("rolling-batch-create-palace-quiz-questions")
        return {"items": items}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/chapters/{chapter_id}/quiz-questions/batch")
def api_batch_create_chapter_quiz_questions(
    chapter_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        payloads = data.get("questions") if isinstance(data, dict) else None
        items = batch_create_chapter_questions(
            s,
            chapter_id,
            payloads if isinstance(payloads, list) else [],
            save_mode=str(data.get("save_mode") or "append") if isinstance(data, dict) else "append",
        )
        palace_id = data.get("palace_id") if isinstance(data, dict) else None
        ocr_sources = data.get("ocr_sources") if isinstance(data, dict) else None
        if palace_id and isinstance(ocr_sources, list) and ocr_sources:
            upsert_palace_ocr_sources(s, palace_id=int(palace_id), payloads=ocr_sources)
        maybe_create_rolling_backup("rolling-batch-create-chapter-quiz-questions")
        return {"items": items}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.put("/palace-quiz-questions/{question_id}")
def api_update_palace_quiz_question(
    question_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        item = update_question(s, question_id, data)
        maybe_create_rolling_backup("rolling-update-palace-quiz-question")
        return {"item": item}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.delete("/palace-quiz-questions/{question_id}")
def api_delete_palace_quiz_question(question_id: int, s: Session = Depends(session_dep)):
    try:
        delete_question(s, question_id)
        maybe_create_rolling_backup("rolling-delete-palace-quiz-question")
        return {"ok": True}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palace-quiz-questions/batch-delete")
def api_batch_delete_palace_quiz_questions(data: dict, s: Session = Depends(session_dep)):
    try:
        question_ids = data.get("question_ids") if isinstance(data, dict) else None
        deleted_count = batch_delete_questions(
            s,
            question_ids if isinstance(question_ids, list) else [],
        )
        maybe_create_rolling_backup("rolling-batch-delete-palace-quiz-questions")
        return {"ok": True, "deleted_count": deleted_count}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palace-quiz-questions/reset-attempts")
def api_reset_palace_quiz_question_attempts(data: dict, s: Session = Depends(session_dep)):
    try:
        question_ids = data.get("question_ids") if isinstance(data, dict) else None
        reset_count = reset_question_attempts(
            s,
            question_ids if isinstance(question_ids, list) else [],
        )
        maybe_create_rolling_backup("rolling-reset-palace-quiz-question-attempts")
        return {"ok": True, "reset_count": reset_count}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palace-quiz-questions/{question_id}/choice-attempts")
def api_record_choice_attempt(
    question_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return record_choice_attempt(
            s,
            question_id,
            str(data.get("selected_option_id") or ""),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palace-quiz-questions/{question_id}/short-answer-feedback")
def api_short_answer_feedback(
    question_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return generate_short_answer_feedback(
            s,
            question_id=question_id,
            user_answer=str(data.get("user_answer") or ""),
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palace-quiz-questions/{question_id}/explain")
def api_explain_question(
    question_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return explain_question(
            s,
            question_id=question_id,
            user_question=str(data.get("user_question") or ""),
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-generation/images")
async def api_generate_palace_quiz_from_images(
    palace_id: int,
    files: list[UploadFile] = File(...),
    extra_prompt: str = Form(default=""),
    classify_by_mini_palace: str = Form(default="false"),
    selected_chapter_id: str = Form(default=""),
    ai_options: str = Form(default=""),
    s: Session = Depends(session_dep),
):
    try:
        image_items: list[tuple[bytes, str | None]] = []
        for item in files:
            image_items.append((await item.read(), item.filename))
        return generate_quiz_preview_from_images(
            s,
            palace_id=palace_id,
            image_items=image_items,
            extra_prompt=extra_prompt,
            classify_by_mini_palace=str(classify_by_mini_palace).lower() == "true",
            selected_chapter_id=(
                int(selected_chapter_id)
                if str(selected_chapter_id or "").strip()
                else None
            ),
            ai_options=normalize_ai_runtime_options(
                json.loads(ai_options) if ai_options else None
            ),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-generation/text-files")
async def api_generate_palace_quiz_from_text_files(
    palace_id: int,
    files: list[UploadFile] = File(...),
    extra_prompt: str = Form(default=""),
    classify_by_mini_palace: str = Form(default="false"),
    selected_chapter_id: str = Form(default=""),
    ai_options: str = Form(default=""),
    s: Session = Depends(session_dep),
):
    try:
        file_items: list[tuple[bytes, str | None, str | None]] = []
        for item in files:
            file_items.append((await item.read(), item.filename, item.content_type))
        return generate_quiz_preview_from_text_files(
            s,
            palace_id=palace_id,
            file_items=file_items,
            extra_prompt=extra_prompt,
            classify_by_mini_palace=str(classify_by_mini_palace).lower() == "true",
            selected_chapter_id=(
                int(selected_chapter_id)
                if str(selected_chapter_id or "").strip()
                else None
            ),
            ai_options=normalize_ai_runtime_options(
                json.loads(ai_options) if ai_options else None
            ),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-generation/review-mindmap")
def api_generate_palace_quiz_from_review_mindmap(
    palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return generate_quiz_preview_from_review_mindmap(
            s,
            palace_id=palace_id,
            mode=str(data.get("mode") or "chapter"),
            question_types=list(data.get("question_types") or []),
            question_count=int(data.get("question_count") or 5),
            review_editor_doc=data.get("review_editor_doc"),
            related_palace_ids=list(data.get("related_palace_ids") or []),
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/chapters/{chapter_id}/quiz-generation/outline")
def api_generate_chapter_quiz_from_outline(
    chapter_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return generate_quiz_preview_from_chapter_outline(
            s,
            chapter_id=chapter_id,
            question_types=list(data.get("question_types") or []),
            question_count=int(data.get("question_count") or 5),
            extra_prompt=str(data.get("extra_prompt") or ""),
            classify_by_child_chapter=bool(data.get("classify_by_child_chapter", False)),
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-classification/mini-palaces")
def api_classify_existing_quiz_questions_to_mini_palaces(
    palace_id: int,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    try:
        return classify_existing_quiz_questions_to_mini_palaces(
            s,
            palace_id=palace_id,
            ai_options=normalize_ai_runtime_options((data or {}).get("ai_options")),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)
