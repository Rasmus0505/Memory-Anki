from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
from memory_anki.modules.palace_quiz.application.ai_service import (
    PalaceQuizAiError,
    classify_existing_quiz_questions_to_mini_palaces,
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_pdf,
    generate_short_answer_feedback,
)
from memory_anki.modules.palace_quiz.application.service import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    batch_create_questions,
    create_question,
    delete_question,
    list_questions,
    record_choice_attempt,
    update_question,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter(tags=["palace_quiz"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, PalaceQuizNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, (PalaceQuizValidationError, PalaceQuizAiError)):
        raise HTTPException(status_code=400, detail=str(error)) from error
    raise error


@router.get("/palaces/{palace_id}/quiz-questions")
def api_list_palace_quiz_questions(palace_id: int, s: Session = Depends(session_dep)):
    try:
        return {"items": list_questions(s, palace_id)}
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
        maybe_create_rolling_backup("rolling-batch-create-palace-quiz-questions")
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


@router.post("/palaces/{palace_id}/quiz-generation/images")
async def api_generate_palace_quiz_from_images(
    palace_id: int,
    files: list[UploadFile] = File(...),
    extra_prompt: str = Form(default=""),
    classify_by_mini_palace: str = Form(default="false"),
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
            ai_options=normalize_ai_runtime_options(
                json.loads(ai_options) if ai_options else None
            ),
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-generation/pdf")
def api_generate_palace_quiz_from_pdf(
    palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        page_selection = data.get("page_selection")
        return generate_quiz_preview_from_pdf(
            s,
            palace_id=palace_id,
            subject_document_id=int(data.get("subject_document_id") or 0),
            page_selection=list(page_selection or []),
            extra_prompt=str(data.get("extra_prompt") or ""),
            classify_by_mini_palace=bool(data.get("classify_by_mini_palace", False)),
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
