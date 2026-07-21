from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from memory_anki.core.concurrency_limits import concurrency_slot
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.english.application.ai_dependencies import EnglishAiDependencies
from memory_anki.modules.english.application.course_service import (
    check_sentence_input,
    delete_course,
    get_course_detail,
    get_course_media_file,
    get_course_progress,
    get_recent_unfinished_course_payload,
    repair_all_course_durations,
    update_course_progress,
)
from memory_anki.modules.english.application.pattern_service import (
    collect_sentence_into_pattern,
    create_topic_pattern,
    delete_prompt,
    delete_sentence,
    delete_topic_pattern,
    get_topic_pattern,
    list_due_sentences,
    list_topic_patterns,
    review_pattern_sentence,
    update_topic_pattern,
    upsert_prompt,
    upsert_sentence,
)
from memory_anki.modules.english.application.task_service import (
    clear_current_task,
    create_generation_task,
    get_course_generation_log,
    get_current_task_payload,
    get_task_generation_log,
    get_workspace_summary,
    retry_current_task,
    stream_task_events,
)
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog

router = APIRouter(tags=["english"])


class EnglishProgressUpdateRequest(BaseModel):
    currentSentenceIndex: int
    completedSentenceIndexes: list[int] = Field(default_factory=list)


class EnglishSentenceCheckRequest(BaseModel):
    sentenceIndex: int
    inputText: str = ""


class EnglishPatternCreateRequest(BaseModel):
    title: str
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    seedTemplate: bool = True


class EnglishPatternUpdateRequest(BaseModel):
    title: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    status: str | None = None


class EnglishPatternPromptUpsertRequest(BaseModel):
    promptId: int | None = None
    textEn: str = ""
    textZh: str = ""
    promptIndex: int | None = None


class EnglishPatternSentenceUpsertRequest(BaseModel):
    sentenceId: int | None = None
    textEn: str = ""
    textZh: str = ""
    note: str = ""
    slots: list[str] | None = None
    collocations: list[str] | None = None
    sentenceIndex: int | None = None
    source: str = "manual"


class EnglishPatternSentenceReviewRequest(BaseModel):
    result: str | None = None
    rating: int | str | None = None


class EnglishPatternCollectRequest(BaseModel):
    patternId: int | None = None
    patternTitle: str = ""
    promptId: int | None = None
    promptTextEn: str = ""
    promptTextZh: str = ""
    textEn: str
    textZh: str = ""
    note: str = ""
    source: str = "manual"
    sourceCourseId: int | None = None
    sourceSentenceId: int | None = None
    sourceMaterialId: int | None = None
    sourceVersionId: int | None = None


@router.get("/english")
def api_get_english_workspace(session: Session = Depends(session_dep)):
    return get_workspace_summary(session)


@router.get("/english/current-task")
def api_get_english_current_task(session: Session = Depends(session_dep)):
    return {"task": get_current_task_payload(session)}


@router.get("/english/tasks/{task_id}/stream")
def api_stream_english_task(task_id: str):
    return StreamingResponse(
        stream_task_events(task_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/english/tasks/{task_id}/generation-log")
def api_get_english_task_generation_log(task_id: str, session: Session = Depends(session_dep)):
    try:
        return get_task_generation_log(session, task_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english/upload")
async def api_upload_english_video(
    ai_options: str = Form(default=""),
    video_file: UploadFile = File(...),
    session: Session = Depends(session_dep),
):
    try:
        with concurrency_slot("heavy_upload"):
            file_bytes = await video_file.read()
            request_ai = EnglishAiDependencies(
                SettingsAiRuntimeProvider(session),
                SettingsPromptCatalog(session),
            )
            worker_ai = EnglishAiDependencies(
                SettingsAiRuntimeProvider(None),
                SettingsPromptCatalog(None),
            )
            task = create_generation_task(
                session,
                filename=str(video_file.filename or ""),
                content_type=str(video_file.content_type or "video/mp4"),
                file_bytes=file_bytes,
                asr_ai_options=request_ai.runtime.normalize_options(
                    json.loads(ai_options) if ai_options else None
                ),
                ai_dependencies=request_ai,
                worker_ai_dependencies=worker_ai,
            )
        return {"task": task}
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await video_file.close()


@router.post("/english/current-task/retry")
def api_retry_english_current_task(session: Session = Depends(session_dep)):
    try:
        return {
            "task": retry_current_task(
                session,
                worker_ai_dependencies=EnglishAiDependencies(
                    SettingsAiRuntimeProvider(None),
                    SettingsPromptCatalog(None),
                ),
            )
        }
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/english/current-task")
def api_clear_english_current_task(session: Session = Depends(session_dep)):
    try:
        clear_current_task(session)
        return {"ok": True}
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/english/continue")
def api_get_english_continue(session: Session = Depends(session_dep)):
    return {"course": get_recent_unfinished_course_payload(session)}


@router.get("/english/courses")
def api_list_english_courses(session: Session = Depends(session_dep)):
    return {
        "recentCourses": get_workspace_summary(session)["recentCourses"],
    }


@router.post("/english/courses/repair-durations")
def api_repair_english_course_durations(session: Session = Depends(session_dep)):
    return {"ok": True, **repair_all_course_durations(session)}


@router.get("/english/courses/{course_id}")
def api_get_english_course(course_id: int, session: Session = Depends(session_dep)):
    try:
        return get_course_detail(session, course_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/english/courses/{course_id}/generation-log")
def api_get_english_course_generation_log(course_id: int, session: Session = Depends(session_dep)):
    try:
        return get_course_generation_log(session, course_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/english/courses/{course_id}/progress")
def api_get_english_course_progress(course_id: int, session: Session = Depends(session_dep)):
    try:
        return get_course_progress(session, course_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/english/courses/{course_id}/progress")
def api_update_english_course_progress(
    course_id: int,
    data: EnglishProgressUpdateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return update_course_progress(
            session,
            course_id=course_id,
            current_sentence_index=data.currentSentenceIndex,
            completed_sentence_indexes=data.completedSentenceIndexes,
        )
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/english/courses/{course_id}/check")
def api_check_english_course_sentence(
    course_id: int,
    data: EnglishSentenceCheckRequest,
    session: Session = Depends(session_dep),
):
    try:
        return check_sentence_input(
            session,
            course_id=course_id,
            sentence_index=data.sentenceIndex,
            input_text=data.inputText,
        )
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/english/courses/{course_id}/media")
def api_get_english_course_media(course_id: int, session: Session = Depends(session_dep)):
    try:
        media_file = get_course_media_file(session, course_id)
        return FileResponse(
            media_file["path"],
            media_type=media_file["media_type"],
            filename=media_file["filename"],
        )
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/english/courses/{course_id}")
def api_delete_english_course(course_id: int, session: Session = Depends(session_dep)):
    delete_course(session, course_id)
    return {"ok": True}


@router.get("/english/patterns")
def api_list_english_patterns(
    includeArchived: bool = False,
    limit: int = 100,
    session: Session = Depends(session_dep),
):
    return list_topic_patterns(
        session,
        include_archived=includeArchived,
        limit=limit,
    )


@router.post("/english/patterns")
def api_create_english_pattern(
    data: EnglishPatternCreateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return create_topic_pattern(
            session,
            title=data.title,
            tags=data.tags,
            notes=data.notes,
            seed_template=data.seedTemplate,
        )
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/english/patterns/sentences/due")
def api_list_english_pattern_due_sentences(
    patternId: int | None = None,
    limit: int = 50,
    session: Session = Depends(session_dep),
):
    return list_due_sentences(session, pattern_id=patternId, limit=limit)


@router.post("/english/patterns/collect")
def api_collect_english_pattern_sentence(
    data: EnglishPatternCollectRequest,
    session: Session = Depends(session_dep),
):
    try:
        return collect_sentence_into_pattern(
            session,
            pattern_id=data.patternId,
            pattern_title=data.patternTitle,
            prompt_id=data.promptId,
            prompt_text_en=data.promptTextEn,
            prompt_text_zh=data.promptTextZh,
            text_en=data.textEn,
            text_zh=data.textZh,
            note=data.note,
            source=data.source,
            source_course_id=data.sourceCourseId,
            source_sentence_id=data.sourceSentenceId,
            source_material_id=data.sourceMaterialId,
            source_version_id=data.sourceVersionId,
        )
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/english/patterns/{pattern_id}")
def api_get_english_pattern(pattern_id: int, session: Session = Depends(session_dep)):
    try:
        return get_topic_pattern(session, pattern_id=pattern_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/english/patterns/{pattern_id}")
def api_update_english_pattern(
    pattern_id: int,
    data: EnglishPatternUpdateRequest,
    session: Session = Depends(session_dep),
):
    try:
        return update_topic_pattern(
            session,
            pattern_id=pattern_id,
            title=data.title,
            tags=data.tags,
            notes=data.notes,
            status=data.status,
        )
    except EnglishCourseError as exc:
        status_code = 404 if "不存在" in str(exc) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/english/patterns/{pattern_id}")
def api_delete_english_pattern(pattern_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_topic_pattern(session, pattern_id=pattern_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english/patterns/{pattern_id}/prompts")
def api_upsert_english_pattern_prompt(
    pattern_id: int,
    data: EnglishPatternPromptUpsertRequest,
    session: Session = Depends(session_dep),
):
    try:
        return upsert_prompt(
            session,
            pattern_id=pattern_id,
            prompt_id=data.promptId,
            text_en=data.textEn,
            text_zh=data.textZh,
            prompt_index=data.promptIndex,
        )
    except EnglishCourseError as exc:
        status_code = 404 if "不存在" in str(exc) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/english/patterns/prompts/{prompt_id}")
def api_delete_english_pattern_prompt(prompt_id: int, session: Session = Depends(session_dep)):
    try:
        return delete_prompt(session, prompt_id=prompt_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english/patterns/prompts/{prompt_id}/sentences")
def api_upsert_english_pattern_sentence(
    prompt_id: int,
    data: EnglishPatternSentenceUpsertRequest,
    session: Session = Depends(session_dep),
):
    try:
        return upsert_sentence(
            session,
            prompt_id=prompt_id,
            sentence_id=data.sentenceId,
            text_en=data.textEn,
            text_zh=data.textZh,
            note=data.note,
            slots=data.slots,
            collocations=data.collocations,
            sentence_index=data.sentenceIndex,
            source=data.source,
        )
    except EnglishCourseError as exc:
        status_code = 404 if "不存在" in str(exc) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/english/patterns/sentences/{sentence_id}")
def api_delete_english_pattern_sentence(
    sentence_id: int,
    session: Session = Depends(session_dep),
):
    try:
        return delete_sentence(session, sentence_id=sentence_id)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/english/patterns/sentences/{sentence_id}/review")
def api_review_english_pattern_sentence(
    sentence_id: int,
    data: EnglishPatternSentenceReviewRequest,
    session: Session = Depends(session_dep),
):
    try:
        return review_pattern_sentence(
            session,
            sentence_id=sentence_id,
            result=data.result,
            rating=data.rating,
        )
    except EnglishCourseError as exc:
        status_code = 404 if "不存在" in str(exc) else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
