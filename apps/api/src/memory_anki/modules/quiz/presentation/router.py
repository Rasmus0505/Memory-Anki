from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy.orm import Session

from memory_anki.core.concurrency_limits import concurrency_slot
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.api import maybe_create_rolling_backup
from memory_anki.modules.quiz.application.ai_dependencies import (
    PalaceQuizAiDependencies,
)
from memory_anki.modules.quiz.application.ai_service import (
    PalaceQuizAiError,
    classify_existing_quiz_questions_to_mini_palaces,
    explain_question,
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_review_mindmap,
    generate_quiz_preview_from_text_files,
    generate_short_answer_feedback,
)
from memory_anki.modules.quiz.application.generation.shared import (
    recover_quiz_preview_from_log,
)
from memory_anki.modules.quiz.application.learning_loop import (
    build_mastery_profile,
    list_review_queue,
    record_attempt_event,
    review_and_store_question_quality,
    transition_question,
)
from memory_anki.modules.quiz.application.node_binding import (
    apply_quiz_node_binding_preview,
    list_palace_node_bindings,
    mutate_quiz_node_bindings,
    preview_quiz_node_binding,
)
from memory_anki.modules.quiz.application.question_mutation_commands import (
    batch_create_chapter_questions_command,
    batch_create_palace_questions_command,
    create_question_command,
    record_choice_attempt_command,
)
from memory_anki.modules.quiz.application.service import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
    batch_delete_questions,
    dedupe_chapter_questions,
    dedupe_palace_questions,
    delete_question,
    list_aggregated_questions,
    list_chapter_questions,
    list_palace_ocr_sources,
    list_questions,
    reset_question_attempts,
    restore_question,
    update_question,
)
from memory_anki.modules.quiz.application.wrong_questions_service import (
    get_wrong_questions,
)
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog
from memory_anki.platform.application import (
    AiRuntimeOptions,
    mutation_identity_from_headers,
)
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["palace_quiz"])


def _quiz_sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, PalaceQuizNotFoundError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    if isinstance(error, PalaceQuizValidationError | PalaceQuizAiError):
        raise HTTPException(status_code=400, detail=str(error)) from error
    raise error


def _ai_dependencies(session: Session) -> PalaceQuizAiDependencies:
    return PalaceQuizAiDependencies(
        runtime=SettingsAiRuntimeProvider(session),
        prompts=SettingsPromptCatalog(session),
    )


def _normalize_ai_runtime_options_by_scenario(
    ai_dependencies: PalaceQuizAiDependencies,
    value: object,
) -> dict[str, AiRuntimeOptions] | None:
    if not isinstance(value, dict):
        return None
    normalized: dict[str, AiRuntimeOptions] = {}
    for raw_key, raw_options in value.items():
        scenario_key = str(raw_key or "").strip()
        if not scenario_key:
            continue
        normalized[scenario_key] = ai_dependencies.runtime.normalize_options(raw_options)
    return normalized or None


@router.get("/palaces/{palace_id}/quiz-questions")
def api_list_palace_quiz_questions(
    palace_id: int,
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: Session = Depends(session_dep),
):
    try:
        items = list_questions(s, palace_id)
        if limit is None:
            return {"items": items}
        return {
            "items": items[offset : offset + limit],
            "total": len(items),
            "limit": limit,
            "offset": offset,
        }
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
def api_list_aggregated_palace_quiz_questions(
    palace_id: int,
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: Session = Depends(session_dep),
):
    try:
        items = list_aggregated_questions(s, palace_id)
        if limit is None:
            return {"items": items}
        return {
            "items": items[offset : offset + limit],
            "total": len(items),
            "limit": limit,
            "offset": offset,
        }
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
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        response = create_question_command(
            s,
            palace_id,
            data,
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
        )
        maybe_create_rolling_backup("rolling-create-palace-quiz-question")
        return response
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-questions/batch")
def api_batch_create_palace_quiz_questions(
    palace_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        response = batch_create_palace_questions_command(
            s,
            palace_id,
            data,
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
        )
        maybe_create_rolling_backup("rolling-batch-create-palace-quiz-questions")
        return response
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/chapters/{chapter_id}/quiz-questions/batch")
def api_batch_create_chapter_quiz_questions(
    chapter_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        response = batch_create_chapter_questions_command(
            s,
            chapter_id,
            data,
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
        )
        maybe_create_rolling_backup("rolling-batch-create-chapter-quiz-questions")
        return response
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


@router.post("/palace-quiz-questions/{question_id}/restore")
def api_restore_palace_quiz_question(question_id: int, s: Session = Depends(session_dep)):
    try:
        item = restore_question(s, question_id)
        maybe_create_rolling_backup("rolling-restore-palace-quiz-question")
        return {"item": item}
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


@router.get("/palace-quiz-questions/wrong")
def api_wrong_questions(
    limit: int = Query(default=200, ge=1, le=500),
    s: Session = Depends(session_dep),
):
    return get_wrong_questions(s, limit)


@router.get("/palace-quiz-questions/review-queue")
def api_quiz_review_queue(
    palace_id: int | None = None,
    limit: int = 100,
    s: Session = Depends(session_dep),
):
    return {"items": list_review_queue(s, palace_id=palace_id, limit=limit)}


@router.post("/palace-quiz-questions/{question_id}/quality-review")
def api_review_quiz_question_quality(question_id: int, s: Session = Depends(session_dep)):
    try:
        return review_and_store_question_quality(s, question_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/palace-quiz-questions/{question_id}/lifecycle")
def api_transition_quiz_question(question_id: int, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": transition_question(s, question_id, str(data.get("status") or ""))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/palace-quiz-attempt-events")
def api_record_quiz_attempt_event(data: dict, s: Session = Depends(session_dep)):
    return {"item": record_attempt_event(s, data)}


@router.get("/palace-quiz-mastery")
def api_quiz_mastery_profile(
    palace_id: int | None = None,
    limit: int = 100,
    s: Session = Depends(session_dep),
):
    return {"items": build_mastery_profile(s, palace_id=palace_id, limit=limit)}


@router.post("/palace-quiz-questions/{question_id}/choice-attempts")
def api_record_choice_attempt(
    question_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        return record_choice_attempt_command(
            s,
            question_id,
            str(data.get("selected_option_id") or ""),
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=lambda response: mutation_store.save(mutation_identity, response),
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return generate_short_answer_feedback(
                s,
                ai_dependencies=_ai_dependencies(s),
                question_id=question_id,
                user_answer=str(data.get("user_answer") or ""),
                ai_options=_ai_dependencies(s).runtime.normalize_options(data.get("ai_options")),
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return explain_question(
                s,
                ai_dependencies=_ai_dependencies(s),
                question_id=question_id,
                user_question=str(data.get("user_question") or ""),
                ai_options=_ai_dependencies(s).runtime.normalize_options(data.get("ai_options")),
            )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-generation/recover-from-log")
def api_recover_palace_quiz_preview_from_log(
    palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return recover_quiz_preview_from_log(
            s,
            palace_id=palace_id,
            log_id=str(data.get("log_id") or ""),
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return generate_quiz_preview_from_images(
                s,
                ai_dependencies=_ai_dependencies(s),
                palace_id=palace_id,
                image_items=image_items,
                extra_prompt=extra_prompt,
                classify_by_mini_palace=str(classify_by_mini_palace).lower() == "true",
                selected_chapter_id=(
                    int(selected_chapter_id) if str(selected_chapter_id or "").strip() else None
                ),
                ai_options=_ai_dependencies(s).runtime.normalize_options(
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return generate_quiz_preview_from_text_files(
                s,
                ai_dependencies=_ai_dependencies(s),
                palace_id=palace_id,
                file_items=file_items,
                extra_prompt=extra_prompt,
                classify_by_mini_palace=str(classify_by_mini_palace).lower() == "true",
                selected_chapter_id=(
                    int(selected_chapter_id) if str(selected_chapter_id or "").strip() else None
                ),
                ai_options=_ai_dependencies(s).runtime.normalize_options(
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return generate_quiz_preview_from_review_mindmap(
                s,
                ai_dependencies=_ai_dependencies(s),
                palace_id=palace_id,
                mode=str(data.get("mode") or "chapter"),
                question_types=list(data.get("question_types") or []),
                question_count=int(data.get("question_count") or 5),
                review_editor_doc=data.get("review_editor_doc"),
                related_palace_ids=list(data.get("related_palace_ids") or []),
                ai_options=_ai_dependencies(s).runtime.normalize_options(data.get("ai_options")),
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
        with concurrency_slot("ai_generation", rate_limited=True):
            return generate_quiz_preview_from_chapter_outline(
                s,
                ai_dependencies=_ai_dependencies(s),
                chapter_id=chapter_id,
                question_types=list(data.get("question_types") or []),
                question_count=int(data.get("question_count") or 5),
                extra_prompt=str(data.get("extra_prompt") or ""),
                classify_by_child_chapter=bool(data.get("classify_by_child_chapter", False)),
                ai_options=_ai_dependencies(s).runtime.normalize_options(data.get("ai_options")),
            )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-classification/segments")
def api_classify_existing_quiz_questions_to_mini_palaces(
    palace_id: int,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    try:
        with concurrency_slot("ai_generation", rate_limited=True):
            return classify_existing_quiz_questions_to_mini_palaces(
                s,
                ai_dependencies=_ai_dependencies(s),
                palace_id=palace_id,
                ai_options=_ai_dependencies(s).runtime.normalize_options(
                    (data or {}).get("ai_options")
                ),
            )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.get("/palaces/{palace_id}/quiz-node-bindings")
def api_list_palace_quiz_node_bindings(
    palace_id: int,
    s: Session = Depends(session_dep),
):
    try:
        items = list_palace_node_bindings(s, palace_id)
        return {"items": items, "item_count": len(items)}
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-node-bindings/preview")
def api_preview_palace_quiz_node_bindings(
    palace_id: int,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    payload = data or {}
    merge_mode = str(payload.get("merge_mode") or "replace_all").strip()
    if merge_mode not in {"replace_all", "fill_unbound"}:
        raise HTTPException(status_code=400, detail="merge_mode 仅支持 replace_all 或 fill_unbound。")
    try:
        with concurrency_slot("ai_generation", rate_limited=True):
            return preview_quiz_node_binding(
                s,
                ai_dependencies=_ai_dependencies(s),
                palace_id=palace_id,
                merge_mode=merge_mode,  # type: ignore[arg-type]
                batch_size=int(payload.get("batch_size") or 30),
                ai_options=_ai_dependencies(s).runtime.normalize_options(payload.get("ai_options")),
                operation_id=str(payload.get("operation_id") or "") or None,
            )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-node-bindings/apply")
def api_apply_palace_quiz_node_bindings(
    palace_id: int,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    payload = data or {}
    merge_mode = str(payload.get("merge_mode") or "replace_all").strip()
    if merge_mode not in {"replace_all", "fill_unbound"}:
        raise HTTPException(status_code=400, detail="merge_mode 仅支持 replace_all 或 fill_unbound。")
    bindings = payload.get("bindings")
    if not isinstance(bindings, list):
        raise HTTPException(status_code=400, detail="bindings 必须是列表。")
    accepted = payload.get("accepted_edges")
    if accepted is not None and not isinstance(accepted, list):
        raise HTTPException(status_code=400, detail="accepted_edges 必须是列表。")
    try:
        return apply_quiz_node_binding_preview(
            s,
            palace_id=palace_id,
            merge_mode=merge_mode,  # type: ignore[arg-type]
            bindings=bindings,
            operation_id=str(payload.get("operation_id") or "") or None,
            accepted_edges=accepted if isinstance(accepted, list) else None,
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)


@router.post("/palaces/{palace_id}/quiz-node-bindings/mutate")
def api_mutate_palace_quiz_node_bindings(
    palace_id: int,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    """Manually add/remove question↔node bindings without AI."""
    payload = data or {}
    add = payload.get("add") or []
    remove = payload.get("remove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        raise HTTPException(status_code=400, detail="add / remove 必须是列表。")
    if not add and not remove:
        raise HTTPException(status_code=400, detail="至少需要一条 add 或 remove。")
    try:
        return mutate_quiz_node_bindings(
            s,
            palace_id=palace_id,
            add=add,
            remove=remove,
        )
    except Exception as exc:  # pragma: no cover - centralized HTTP mapping
        _raise_http_error(exc)
