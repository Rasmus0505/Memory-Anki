from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.english.application.course_service import (
    check_sentence_input,
    delete_course,
    get_course_detail,
    get_course_media_file,
    get_course_progress,
    get_recent_unfinished_course_payload,
    update_course_progress,
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

router = APIRouter(tags=["english"])


class EnglishProgressUpdateRequest(BaseModel):
    currentSentenceIndex: int
    completedSentenceIndexes: list[int] = Field(default_factory=list)


class EnglishSentenceCheckRequest(BaseModel):
    sentenceIndex: int
    inputText: str = ""


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


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
    video_file: UploadFile = File(...),
    session: Session = Depends(session_dep),
):
    try:
        file_bytes = await video_file.read()
        task = create_generation_task(
            session,
            filename=str(video_file.filename or ""),
            content_type=str(video_file.content_type or "video/mp4"),
            file_bytes=file_bytes,
        )
        return {"task": task}
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await video_file.close()


@router.post("/english/current-task/retry")
def api_retry_english_current_task(session: Session = Depends(session_dep)):
    try:
        return {"task": retry_current_task(session)}
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
