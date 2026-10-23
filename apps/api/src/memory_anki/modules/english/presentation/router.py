from __future__ import annotations

import json
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from memory_anki.core.concurrency_limits import concurrency_slot
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.english.application.ai_dependencies import EnglishAiDependencies
from memory_anki.modules.english.application.cloze_corpus import load_cloze_corpus
from memory_anki.modules.english.application.course_service import (
    check_sentence_input,
    delete_course,
    get_course_detail,
    get_course_media_file,
    get_course_progress,
    get_recent_unfinished_course_payload,
    repair_all_course_durations,
    serialize_course_summary,
    update_course_progress,
)
from memory_anki.modules.english.application.subtitle_import import (
    MAX_SUBTITLE_BYTES,
    SubtitleTrack,
    create_course_from_subtitles,
    decode_subtitle_bytes,
    parse_subtitle_text,
    safe_suffix,
)
from memory_anki.modules.english.application.task_service import (
    MAX_UPLOAD_BYTES,
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
from memory_anki.modules.english.infrastructure import paths as english_paths
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog

router = APIRouter(tags=["english"])


class EnglishProgressUpdateRequest(BaseModel):
    currentSentenceIndex: int
    completedSentenceIndexes: list[int] = Field(default_factory=list)


class EnglishSentenceCheckRequest(BaseModel):
    sentenceIndex: int
    inputText: str = ""


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
            task = create_generation_task(
                session,
                filename=str(video_file.filename or ""),
                content_type=str(video_file.content_type or "video/mp4"),
                file_bytes=file_bytes,
                asr_ai_options=request_ai.runtime.normalize_options(
                    json.loads(ai_options) if ai_options else None
                ),
                ai_dependencies=request_ai,
            )
        return {"task": task}
    except EnglishCourseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await video_file.close()


def _validate_uploaded_video(video_file: UploadFile) -> None:
    filename = str(video_file.filename or "").strip()
    content_type = str(video_file.content_type or "").strip().lower()
    if not filename:
        raise EnglishCourseError("请选择视频文件。")
    if content_type.startswith(("image/", "text/", "application/pdf")):
        raise EnglishCourseError("视频文件格式不受支持，请上传 MP4、MKV、MOV、WebM 等视频。")
    if content_type and not (
        content_type.startswith("video/")
        or content_type.startswith("audio/")
        or content_type == "application/octet-stream"
    ):
        raise EnglishCourseError("视频文件格式不受支持，请上传常见视频格式。")


async def _read_subtitle_upload(upload: UploadFile, label: str) -> bytes:
    raw = await upload.read(MAX_SUBTITLE_BYTES + 1)
    if len(raw) > MAX_SUBTITLE_BYTES:
        raise EnglishCourseError(f"{label}超过 {MAX_SUBTITLE_BYTES // (1024 * 1024)} MB 上限。")
    if not raw.strip():
        raise EnglishCourseError(f"{label}是空文件。")
    return raw


@router.post("/english/import")
async def api_import_english_course(
    video_file: UploadFile = File(...),
    english_subtitle: UploadFile = File(...),
    chinese_subtitle: UploadFile | None = File(default=None),
    title: str = Form(default=""),
    session: Session = Depends(session_dep),
):
    staging_dir: Path | None = None
    try:
        _validate_uploaded_video(video_file)
        english_bytes = await _read_subtitle_upload(english_subtitle, "英文字幕")
        chinese_bytes = (
            await _read_subtitle_upload(chinese_subtitle, "中文字幕")
            if chinese_subtitle is not None
            else None
        )

        english_text = decode_subtitle_bytes(english_bytes)
        english_cues, english_format = parse_subtitle_text(english_text)
        english_track = SubtitleTrack(
            cues=english_cues,
            filename=str(english_subtitle.filename or "english.srt"),
            format=english_format,
        )

        chinese_track: SubtitleTrack | None = None
        if chinese_bytes is not None and chinese_subtitle is not None:
            chinese_text = decode_subtitle_bytes(chinese_bytes)
            chinese_cues, chinese_format = parse_subtitle_text(
                chinese_text,
                allow_chinese_only=True,
            )
            if not any(cue.text_zh for cue in chinese_cues):
                raise EnglishCourseError("中文字幕文件中没有找到中文文本，请检查文件内容。")
            chinese_track = SubtitleTrack(
                cues=chinese_cues,
                filename=str(chinese_subtitle.filename or "chinese.srt"),
                format=chinese_format,
            )

        video_name = str(video_file.filename or "video.mp4")
        with concurrency_slot("heavy_upload"):
            import_root = english_paths.ENGLISH_TASKS_DIR / "imports"
            import_root.mkdir(parents=True, exist_ok=True)
            staging_dir = Path(tempfile.mkdtemp(prefix="import-", dir=import_root))
            source_path = staging_dir / f"source{safe_suffix(video_name, '.mp4')}"
            file_size = 0
            with source_path.open("wb") as target:
                while True:
                    chunk = await video_file.read(1024 * 1024)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_UPLOAD_BYTES:
                        raise EnglishCourseError(
                            f"视频文件超过 {MAX_UPLOAD_BYTES // (1024 * 1024 * 1024)} GB 上限。"
                        )
                    target.write(chunk)
            if file_size <= 0:
                raise EnglishCourseError("视频文件是空文件。")

            course, matched_translation_count = create_course_from_subtitles(
                session,
                source_path=source_path,
                video_filename=video_name,
                video_mime_type=str(video_file.content_type or ""),
                file_size=file_size,
                title=title,
                english_track=english_track,
                chinese_track=chinese_track,
                english_subtitle_bytes=english_bytes,
                chinese_subtitle_bytes=chinese_bytes,
            )
        return {
            "course": serialize_course_summary(course),
            "matchedTranslationCount": matched_translation_count,
        }
    except EnglishCourseError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException as exc:
        session.rollback()
        if exc.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="已有一次课程导入正在处理，请等待完成后再试。",
            ) from exc
        raise
    finally:
        await video_file.close()
        await english_subtitle.close()
        if chinese_subtitle is not None:
            await chinese_subtitle.close()
        if staging_dir is not None:
            shutil.rmtree(staging_dir, ignore_errors=True)


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


_RANGE_HEADER_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_MEDIA_CHUNK_BYTES = 1024 * 1024


def _media_headers(media_file: dict) -> dict[str, str]:
    return {
        "accept-ranges": "bytes",
        "content-type": media_file["media_type"],
        "content-disposition": f"inline; filename*=UTF-8''{quote(str(media_file['filename'] or 'media'))}",
        "cache-control": "private, max-age=3600",
    }


def _iter_file_range(path: Path, start: int, end: int):
    remaining = max(0, end - start + 1)
    with path.open("rb") as source:
        source.seek(start)
        while remaining > 0:
            chunk = source.read(min(_MEDIA_CHUNK_BYTES, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _media_response(media_file: dict, request: Request):
    path = media_file["path"]
    file_size = int(path.stat().st_size)
    headers = _media_headers(media_file)
    if file_size <= 0:
        return Response(status_code=404, headers=headers)
    headers["content-length"] = str(file_size)
    range_header = str(request.headers.get("range") or "").strip()
    if not range_header:
        return StreamingResponse(_iter_file_range(path, 0, file_size - 1), headers=headers, status_code=200)

    match = _RANGE_HEADER_RE.match(range_header)
    if not match:
        headers.pop("content-length", None)
        headers["content-range"] = f"bytes */{file_size}"
        return Response(status_code=416, headers=headers)
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        headers.pop("content-length", None)
        headers["content-range"] = f"bytes */{file_size}"
        return Response(status_code=416, headers=headers)
    if not start_text:
        suffix_length = int(end_text or 0)
        if suffix_length <= 0:
            headers.pop("content-length", None)
            headers["content-range"] = f"bytes */{file_size}"
            return Response(status_code=416, headers=headers)
        start = max(0, file_size - suffix_length)
        end = file_size - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
        end = min(end, file_size - 1)
    if start >= file_size or start > end:
        headers.pop("content-length", None)
        headers["content-range"] = f"bytes */{file_size}"
        return Response(status_code=416, headers=headers)
    headers["content-range"] = f"bytes {start}-{end}/{file_size}"
    headers["content-length"] = str(end - start + 1)
    return StreamingResponse(
        _iter_file_range(path, start, end),
        headers=headers,
        status_code=206,
    )


@router.get("/english/courses/{course_id}/media")
def api_get_english_course_media(
    course_id: int,
    request: Request,
    session: Session = Depends(session_dep),
):
    try:
        return _media_response(get_course_media_file(session, course_id), request)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.head("/english/courses/{course_id}/media")
def api_head_english_course_media(
    course_id: int,
    session: Session = Depends(session_dep),
):
    try:
        media_file = get_course_media_file(session, course_id)
        file_size = int(media_file["path"].stat().st_size)
        headers = _media_headers(media_file)
        headers["content-length"] = str(max(0, file_size))
        return Response(status_code=200, headers=headers)
    except EnglishCourseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/english/cloze")
def api_get_english_cloze():
    return load_cloze_corpus()


@router.delete("/english/courses/{course_id}")
def api_delete_english_course(course_id: int, session: Session = Depends(session_dep)):
    delete_course(session, course_id)
    return {"ok": True}
