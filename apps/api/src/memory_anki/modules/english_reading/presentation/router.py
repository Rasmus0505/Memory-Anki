from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.english_reading.application.ai_dependencies import (
    EnglishReadingAiDependencies,
)
from memory_anki.modules.english_reading.application.article_service import (
    create_article,
    create_target,
    delete_article,
    delete_explanation,
    delete_target,
    explain_target,
    generate_article,
    get_article,
    list_articles,
    rename_article,
    update_target_priority,
)
from memory_anki.modules.english_reading.application.service import (
    complete_material,
    create_material,
    create_vocabulary_note,
    delete_material,
    generate_material_version,
    generate_material_version_events,
    get_dictionary_entry,
    get_material,
    get_material_version,
    get_profile,
    get_workspace,
    list_vocabulary_notes,
    review_vocabulary_note,
    translate_sentence_text,
    update_material,
    update_profile,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog

router = APIRouter(tags=["english-reading"])


def _ai_dependencies(session: Session) -> EnglishReadingAiDependencies:
    return EnglishReadingAiDependencies(
        runtime=SettingsAiRuntimeProvider(session),
        prompts=SettingsPromptCatalog(session),
    )


def _reading_sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


class ReadingProfileUpdateRequest(BaseModel):
    declaredCefr: str


class ReadingGenerateRequest(BaseModel):
    mode: str = "initial"
    difficultyDirection: str | None = None
    difficultyDelta: float | None = None
    ai_options: dict | None = None


class ReadingMaterialUpdateRequest(BaseModel):
    title: str


class ReadingCompleteRequest(BaseModel):
    versionId: int | None = None
    feedback: str
    durationSeconds: int
    hoverCount: int = 0
    expandCount: int = 0


class ReadingSentenceTranslationRequest(BaseModel):
    text: str
    ai_options: dict | None = None


class ReadingVocabularyNoteCreateRequest(BaseModel):
    word: str
    note: str = ""
    definitionZh: str = ""
    context: str = ""
    materialId: int | None = None
    versionId: int | None = None
    spanAnnotationId: str = ""
    cefr: str | None = None


class ReadingVocabularyReviewRequest(BaseModel):
    result: str | None = None
    rating: int | str | None = None


class ReadingArticleUpdateRequest(BaseModel):
    title: str


class ReadingTargetCreateRequest(BaseModel):
    type: str
    startOffset: int
    endOffset: int
    quote: str
    priority: int = 1


class ReadingTargetPriorityRequest(BaseModel):
    priority: int


class ReadingExplainRequest(BaseModel):
    operationId: str
    cefr: str = "B1"
    ai_options: dict | None = None


class ReadingArticleGenerationRequest(BaseModel):
    operationId: str
    targetIds: list[int]
    config: dict
    ai_options: dict | None = None


@router.get("/english-reading/profile")
def api_get_english_reading_profile(session: Session = Depends(session_dep)):
    return get_profile(session)


@router.get("/english-reading")
def api_get_english_reading_workspace(session: Session = Depends(session_dep)):
    return get_workspace(session)


@router.put("/english-reading/profile")
def api_update_english_reading_profile(
    data: ReadingProfileUpdateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return update_profile(session, declared_cefr=data.declaredCefr)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/english-reading/articles")
def api_list_english_reading_articles(session: Session = Depends(session_dep)):
    return list_articles(session)


@router.post("/english-reading/articles")
async def api_create_english_reading_article(
    text: str = Form(""),
    reading_file: UploadFile | None = File(None),
    session: Session = Depends(session_dep),
):
    file_bytes = await reading_file.read() if reading_file is not None else None
    original_filename = str(reading_file.filename or "") if reading_file is not None else ""
    try:
        return create_article(
            session,
            pasted_text=text,
            file_bytes=file_bytes,
            original_filename=original_filename,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if reading_file is not None:
            await reading_file.close()


@router.get("/english-reading/articles/{article_id}")
def api_get_english_reading_article(article_id: int, session: Session = Depends(session_dep)):
    try:
        return get_article(session, article_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/english-reading/articles/{article_id}")
def api_rename_english_reading_article(
    article_id: int,
    data: ReadingArticleUpdateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return rename_article(session, article_id=article_id, title=data.title)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/english-reading/articles/{article_id}")
def api_delete_english_reading_article(article_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_article(session, article_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english-reading/articles/{article_id}/targets")
def api_create_english_reading_target(
    article_id: int,
    data: ReadingTargetCreateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return create_target(
            session,
            article_id=article_id,
            target_type=data.type,
            start_offset=data.startOffset,
            end_offset=data.endOffset,
            quote=data.quote,
            priority=data.priority,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/english-reading/targets/{target_id}")
def api_update_english_reading_target(
    target_id: int,
    data: ReadingTargetPriorityRequest,
    session: Session = Depends(session_dep),
):
    try:
        return update_target_priority(session, target_id=target_id, priority=data.priority)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/english-reading/targets/{target_id}")
def api_delete_english_reading_target(target_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_target(session, target_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english-reading/targets/{target_id}/explanations")
def api_explain_english_reading_target(
    target_id: int,
    data: ReadingExplainRequest,
    session: Session = Depends(session_dep),
):
    try:
        return explain_target(
            session,
            target_id=target_id,
            operation_id=data.operationId,
            cefr=data.cefr,
            ai_dependencies=_ai_dependencies(session),
            ai_options=_ai_dependencies(session).runtime.normalize_options(data.ai_options),
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/english-reading/explanations/{explanation_id}")
def api_delete_english_reading_explanation(explanation_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_explanation(session, explanation_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english-reading/articles/{article_id}/generate")
def api_generate_english_reading_article(
    article_id: int,
    data: ReadingArticleGenerationRequest,
    session: Session = Depends(session_dep),
):
    try:
        dependencies = _ai_dependencies(session)
        return generate_article(
            session,
            owner_article_id=article_id,
            operation_id=data.operationId,
            target_ids=data.targetIds,
            config=data.config,
            ai_dependencies=dependencies,
            ai_options=dependencies.runtime.normalize_options(data.ai_options),
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/english-reading/materials")
async def api_create_english_reading_material(
    text: str = Form(""),
    reading_file: UploadFile | None = File(None),
    session: Session = Depends(session_dep),
):
    file_bytes: bytes | None = None
    original_filename = ""
    if reading_file is not None:
        file_bytes = await reading_file.read()
        original_filename = str(reading_file.filename or "")
    try:
        return create_material(
            session,
            pasted_text=text,
            file_bytes=file_bytes,
            original_filename=original_filename,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if reading_file is not None:
            await reading_file.close()


@router.post("/english-reading/materials/{material_id}/generate")
def api_generate_english_reading_material(
    material_id: int,
    data: ReadingGenerateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return generate_material_version(
            session,
            ai_dependencies=_ai_dependencies(session),
            material_id=material_id,
            mode=data.mode,
            difficulty_direction=data.difficultyDirection,
            difficulty_delta=data.difficultyDelta,
            ai_options=_ai_dependencies(session).runtime.normalize_options(data.ai_options),
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/english-reading/materials/{material_id}/generate/stream")
def api_stream_generate_english_reading_material(
    material_id: int,
    data: ReadingGenerateRequest,
    session: Session = Depends(session_dep),
):
    def event_stream():
        try:
            generator = generate_material_version_events(
                session,
            ai_dependencies=_ai_dependencies(session),
                material_id=material_id,
                mode=data.mode,
                difficulty_direction=data.difficultyDirection,
                difficulty_delta=data.difficultyDelta,
                ai_options=_ai_dependencies(session).runtime.normalize_options(data.ai_options),
            )
            while True:
                try:
                    event_name, payload = next(generator)
                except StopIteration as exc:
                    yield _reading_sse("result", {"version": exc.value})
                    break
                yield _reading_sse(event_name, payload)
        except EnglishReadingError as exc:
            yield _reading_sse("error", {"detail": str(exc)})
        except Exception as exc:
            yield _reading_sse("error", {"detail": str(exc) or "生成阅读材料失败。"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/english-reading/materials/{material_id}")
def api_get_english_reading_material(material_id: int, session: Session = Depends(session_dep)):
    try:
        return get_material(session, material_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/english-reading/materials/{material_id}")
def api_update_english_reading_material(
    material_id: int,
    data: ReadingMaterialUpdateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return update_material(session, material_id=material_id, title=data.title)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/english-reading/materials/{material_id}")
def api_delete_english_reading_material(material_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_material(session, material_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/english-reading/materials/{material_id}/version")
def api_get_english_reading_version(material_id: int, session: Session = Depends(session_dep)):
    try:
        return get_material_version(session, material_id)
    except EnglishReadingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/english-reading/dictionary")
def api_get_english_reading_dictionary(
    word: str,
    session: Session = Depends(session_dep),
):
    try:
        return get_dictionary_entry(session, word=word)
    except EnglishReadingError as exc:
        message = str(exc)
        status_code = 400
        if "未找到单词" in message:
            status_code = 404
        elif "词典服务暂时不可用" in message:
            status_code = 502
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.post("/english-reading/sentence-translation")
def api_translate_english_reading_sentence(
    data: ReadingSentenceTranslationRequest,
    session: Session = Depends(session_dep),
):
    try:
        return translate_sentence_text(
            session,
            ai_dependencies=_ai_dependencies(session),
            text=data.text,
            ai_options=_ai_dependencies(session).runtime.normalize_options(data.ai_options),
        )
    except EnglishReadingError as exc:
        message = str(exc)
        status_code = 400
        if "翻译失败" in message:
            status_code = 502
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get("/english-reading/vocabulary-notes")
def api_list_english_reading_vocabulary_notes(
    dueOnly: bool = False,
    limit: int = 50,
    session: Session = Depends(session_dep),
):
    return list_vocabulary_notes(session, due_only=dueOnly, limit=limit)


@router.post("/english-reading/vocabulary-notes")
def api_create_english_reading_vocabulary_note(
    data: ReadingVocabularyNoteCreateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return create_vocabulary_note(
            session,
            word=data.word,
            note=data.note,
            definition_zh=data.definitionZh,
            context=data.context,
            material_id=data.materialId,
            version_id=data.versionId,
            span_annotation_id=data.spanAnnotationId,
            cefr=data.cefr,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/english-reading/vocabulary-notes/{note_id}/review")
def api_review_english_reading_vocabulary_note(
    note_id: int,
    data: ReadingVocabularyReviewRequest,
    session: Session = Depends(session_dep),
):
    try:
        return review_vocabulary_note(
            session,
            note_id=note_id,
            result=data.result,
            rating=data.rating,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/english-reading/materials/{material_id}/complete")
def api_complete_english_reading_material(
    material_id: int,
    data: ReadingCompleteRequest,
    session: Session = Depends(session_dep),
):
    try:
        return complete_material(
            session,
            material_id=material_id,
            version_id=data.versionId,
            feedback=data.feedback,
            duration_seconds=data.durationSeconds,
            hover_count=data.hoverCount,
            expand_count=data.expandCount,
        )
    except EnglishReadingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
