from __future__ import annotations

import json
import logging
import mimetypes
import re
import shutil
import threading
import traceback
import uuid
import wave
from dataclasses import dataclass
from pathlib import Path
from time import monotonic, sleep
from typing import Any, Generator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import av
import dashscope
import requests
from dashscope.audio.qwen_asr import QwenTranscription
from dashscope.files import Files
from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_ASR_MODEL,
    DASHSCOPE_BASE_URL,
    ENGLISH_MEDIA_DIR,
    ENGLISH_TASKS_DIR,
    ENGLISH_TRANSLATION_MODEL,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Base,
    EnglishCourse,
    EnglishCourseProgress,
    EnglishGenerationTask,
    EnglishSentence,
    TimeRecord,
    engine,
    get_session,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
    get_external_ai_call_log,
    list_external_ai_call_logs,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    call_chat_completion_text,
)
from memory_anki.modules.time_records.application.time_records_service import (
    get_english_course_stats,
)

logger = logging.getLogger(__name__)

VISIBLE_TASK_STATUSES = {"queued", "running", "failed"}
ACTIVE_TASK_STATUSES = {"queued", "running"}
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
ASR_POLL_SECONDS = 2
TRANSLATION_BATCH_SIZE = 40
GENERATION_LOG_FILENAME = "generation-log.jsonl"
GENERATION_LOG_POLL_SECONDS = 0.4
TERMINAL_TASK_STATUSES = {"completed", "failed", "retried", "cleared"}
MAX_REASONABLE_MEDIA_DURATION_SECONDS = 60 * 60 * 24 * 30

_PUNCT_EDGE_RE = re.compile(r"^[\s\.,!?;:\"'`~\-\(\)\[\]\{\}]+|[\s\.,!?;:\"'`~\-\(\)\[\]\{\}]+$")
_USD_AMOUNT_RE = re.compile(r"(?<![A-Za-z0-9])\$(\d[\d,]*)(?:\.(\d{1,2}))?(?![A-Za-z0-9])")
_TRANSLATION_LINE_RE = re.compile(r"^\[S(?P<index>\d+)\]\s*(?P<text>.*)$")

_NUMBER_WORDS_LT_20 = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
]
_NUMBER_WORDS_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_NUMBER_WORDS_SCALES = [
    (1_000_000_000_000, "trillion"),
    (1_000_000_000, "billion"),
    (1_000_000, "million"),
    (1_000, "thousand"),
]


class EnglishCourseError(RuntimeError):
    pass


class EnglishTranslationBatchMismatchError(EnglishCourseError):
    pass


@dataclass(frozen=True, slots=True)
class EnglishSentenceCheckResult:
    passed: bool
    token_results: list[dict[str, Any]]
    normalized_input: list[str]
    normalized_expected: list[str]


def ensure_english_schema() -> None:
    Base.metadata.create_all(
        engine,
        tables=[
            EnglishCourse.__table__,
            EnglishSentence.__table__,
            EnglishCourseProgress.__table__,
            EnglishGenerationTask.__table__,
        ],
    )
    with engine.begin() as connection:
        existing_columns = {
            str(row[1])
            for row in connection.exec_driver_sql("PRAGMA table_info(time_records)").fetchall()
        }
        if "source_kind" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE time_records ADD COLUMN source_kind VARCHAR(32)")
        if "english_course_id" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE time_records ADD COLUMN english_course_id INTEGER")
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_source_kind_started "
            "ON time_records (source_kind, started_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_english_course_started "
            "ON time_records (english_course_id, started_at)"
        )


def get_workspace_summary(session: Session) -> dict[str, Any]:
    return {
        "currentTask": get_current_task_payload(session),
        "continueCourse": get_recent_unfinished_course_payload(session),
        "recentCourses": list_recent_courses(session),
        "stats": get_english_course_stats(session),
    }


def get_current_task_payload(session: Session) -> dict[str, Any] | None:
    task = _get_current_task(session)
    return _serialize_task(task) if task else None


def create_generation_task(
    session: Session,
    *,
    filename: str,
    content_type: str,
    file_bytes: bytes,
) -> dict[str, Any]:
    current_task = _get_current_task(session)
    if current_task is not None:
        if current_task.status == "failed":
            raise EnglishCourseError("当前有失败的生成任务，请先重试或清除。")
        raise EnglishCourseError("当前已有正在处理的英语生成任务，请等待完成后再上传。")
    if not filename.strip():
        raise EnglishCourseError("上传文件名不能为空。")
    if not file_bytes:
        raise EnglishCourseError("上传内容为空。")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise EnglishCourseError("视频文件过大，请控制在 1GB 以内。")

    task = _create_task_row(
        session,
        filename=filename,
        content_type=content_type,
        file_bytes=file_bytes,
    )
    launch_generation_task(task["id"])
    return task


def retry_current_task(session: Session) -> dict[str, Any]:
    task = _get_current_task(session)
    if task is None or task.status != "failed":
        raise EnglishCourseError("当前没有可重试的失败任务。")
    source_path = Path(task.source_media_path or "")
    if not source_path.exists():
        raise EnglishCourseError("原始视频已丢失，无法重试，请重新上传。")
    retry_task = _create_task_row(
        session,
        filename=task.source_filename,
        content_type=task.source_mime_type or _guess_media_type(task.source_filename),
        file_bytes=source_path.read_bytes(),
    )
    task.status = "retried"
    task.stage = "retried"
    task.message = "已重试，历史日志保留。"
    task.updated_at = utc_now_naive()
    session.commit()
    launch_generation_task(retry_task["id"])
    return retry_task


def clear_current_task(session: Session) -> None:
    task = _get_current_task(session)
    if task is None:
        return
    if task.status not in {"failed", "queued"}:
        raise EnglishCourseError("当前任务正在处理中，暂不支持清除。")
    task_dir = _task_dir(task.id)
    task.status = "cleared"
    task.stage = "cleared"
    task.message = "任务已清除。"
    task.updated_at = utc_now_naive()
    session.commit()
    shutil.rmtree(task_dir, ignore_errors=True)


def launch_generation_task(task_id: str) -> None:
    thread = threading.Thread(
        target=_run_generation_task,
        args=(task_id,),
        name=f"memory-anki-english-{task_id[:8]}",
        daemon=True,
    )
    thread.start()


def list_recent_courses(session: Session, limit: int = 12) -> list[dict[str, Any]]:
    courses = (
        session.query(EnglishCourse)
        .order_by(EnglishCourse.updated_at.desc(), EnglishCourse.id.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [_serialize_course_summary(_repair_course_duration_if_needed(session, course)) for course in courses]


def get_recent_unfinished_course_payload(session: Session) -> dict[str, Any] | None:
    progress = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(False))
        .order_by(EnglishCourseProgress.updated_at.desc(), EnglishCourseProgress.id.desc())
        .first()
    )
    if progress is None or progress.course is None:
        return None
    return _serialize_course_summary(_repair_course_duration_if_needed(session, progress.course))


def get_course_detail(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    course = _repair_course_duration_if_needed(session, course)
    progress = course.progress or _ensure_progress_row(session, course)
    return {
        **_serialize_course_summary(course),
        "mediaUrl": f"/api/v1/english/courses/{course.id}/media",
        "sentences": [_serialize_sentence(sentence) for sentence in course.sentences],
        "progress": _serialize_progress(progress, sentence_count=course.sentence_count),
    }


def get_course_progress(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    progress = course.progress or _ensure_progress_row(session, course)
    return _serialize_progress(progress, sentence_count=course.sentence_count)


def update_course_progress(
    session: Session,
    *,
    course_id: int,
    current_sentence_index: int,
    completed_sentence_indexes: list[int] | None,
) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    progress = course.progress or _ensure_progress_row(session, course)
    normalized_indexes = _normalize_completed_indexes(
        completed_sentence_indexes or [],
        sentence_count=course.sentence_count,
    )
    safe_index = max(0, min(int(current_sentence_index), max(course.sentence_count, 0)))
    progress.current_sentence_index = safe_index
    progress.completed_sentence_indexes_json = json.dumps(normalized_indexes, ensure_ascii=False)
    progress.is_completed = bool(course.sentence_count > 0 and safe_index >= course.sentence_count)
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _serialize_progress(progress, sentence_count=course.sentence_count)


def check_sentence_input(
    session: Session,
    *,
    course_id: int,
    sentence_index: int,
    input_text: str,
) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    sentence = next((item for item in course.sentences if item.sentence_index == sentence_index), None)
    if sentence is None:
        raise EnglishCourseError("句子不存在。")
    result = _check_sentence_tokens(
        expected_tokens=json.loads(sentence.tokens_json or "[]"),
        input_text=input_text,
    )
    return {
        "passed": result.passed,
        "tokenResults": result.token_results,
        "normalizedInput": result.normalized_input,
        "tokenCount": len(result.normalized_expected),
    }


def delete_course(session: Session, course_id: int) -> None:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        return
    media_path = resolve_course_media_path(course)
    course_dir = media_path.parent if media_path else None
    session.query(TimeRecord).filter(TimeRecord.english_course_id == course_id).update(
        {
            "english_course_id": None,
            "source_kind": "english",
        },
        synchronize_session=False,
    )
    session.delete(course)
    session.commit()
    if course_dir is not None:
        shutil.rmtree(course_dir, ignore_errors=True)


def resolve_course_media_path(course: EnglishCourse) -> Path:
    relative_path = str(course.media_relative_path or "").strip()
    if not relative_path:
        raise EnglishCourseError("课程媒体路径缺失。")
    candidate = ENGLISH_MEDIA_DIR / Path(relative_path)
    resolved = candidate.resolve()
    if not str(resolved).startswith(str(ENGLISH_MEDIA_DIR.resolve())):
        raise EnglishCourseError("课程媒体路径无效。")
    if not resolved.exists():
        raise EnglishCourseError("课程媒体文件不存在。")
    return resolved


def get_task_generation_log(session: Session, task_id: str) -> dict[str, Any]:
    task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
    if task is None:
        raise EnglishCourseError("英语生成任务不存在。")
    ai_logs = _load_ai_logs_for_task(session, task.id)
    return {
        "task": _serialize_task(task),
        "events": _read_generation_log_events(task=task),
        "aiLogs": ai_logs,
    }


def get_course_generation_log(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    task = (
        session.query(EnglishGenerationTask)
        .filter(EnglishGenerationTask.course_id == course_id)
        .order_by(EnglishGenerationTask.created_at.desc(), EnglishGenerationTask.id.desc())
        .first()
    )
    ai_logs = _load_ai_logs_for_task(session, task.id if task else None)
    return {
        "task": _serialize_task(task) if task else None,
        "events": _read_generation_log_events(task=task, course=course),
        "aiLogs": ai_logs,
    }


def stream_task_events(task_id: str) -> Generator[str, None, None]:
    def _encode(event_name: str, payload: dict[str, Any]) -> str:
        return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    with get_session() as session:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            yield _encode("error", {"error": "英语生成任务不存在。"})
            return

    sent_event_ids: set[str] = set()
    last_status_signature: tuple[Any, ...] | None = None

    while True:
        with get_session() as session:
            task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
            if task is None:
                yield _encode("error", {"error": "英语生成任务不存在。"})
                return
            task_payload = _serialize_task(task)

        status_signature = (
            task_payload["status"],
            task_payload["stage"],
            task_payload["progressPercent"],
            task_payload["message"],
            task_payload["errorMessage"],
            task_payload["courseId"],
            task_payload["updatedAt"],
        )
        if status_signature != last_status_signature:
            last_status_signature = status_signature
            yield _encode("status", {"task": task_payload})

        for event in _read_generation_log_events(task=task):
            event_id = str(event.get("id") or "")
            if not event_id or event_id in sent_event_ids:
                continue
            sent_event_ids.add(event_id)
            yield _encode("log", {"event": event})

        if task.status == "completed":
            yield _encode("done", {"task": task_payload})
            return
        if task.status == "failed":
            yield _encode(
                "error",
                {
                    "task": task_payload,
                    "error": task_payload["errorMessage"] or "英语生成失败。",
                },
            )
            return
        if task.status in {"retried", "cleared"}:
            yield _encode("done", {"task": task_payload})
            return

        sleep(GENERATION_LOG_POLL_SECONDS)


def _create_task_row(
    session: Session,
    *,
    filename: str,
    content_type: str,
    file_bytes: bytes,
) -> dict[str, Any]:
    suffix = Path(filename).suffix or ".mp4"
    task_id = uuid.uuid4().hex
    task_dir = _task_dir(task_id)
    task_dir.mkdir(parents=True, exist_ok=True)
    source_path = task_dir / f"source{suffix}"
    source_path.write_bytes(file_bytes)

    task = EnglishGenerationTask(
        id=task_id,
        status="queued",
        stage="queued",
        progress_percent=5,
        message="等待开始生成",
        source_filename=filename,
        source_media_path=str(source_path),
        source_mime_type=content_type or _guess_media_type(filename),
        file_size=len(file_bytes),
        error_message="",
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    _append_generation_log_event(
        task_id=task.id,
        stage="queued",
        kind="info",
        message="已创建英语生成任务。",
        data={
            "source_filename": filename,
            "content_type": content_type or _guess_media_type(filename),
            "file_size": len(file_bytes),
        },
    )
    return _serialize_task(task)


def _run_generation_task(task_id: str) -> None:
    session = get_session()
    try:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            return
        _update_task_fields(
            session,
            task_id,
            status="running",
            stage="extract_audio",
            progress_percent=15,
            message="正在提取音轨",
            started_at=utc_now_naive(),
            error_message="",
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="extract_audio",
            kind="status",
            message="开始提取音轨。",
            data={"source_media_path": task.source_media_path},
        )
        source_path = Path(task.source_media_path)
        if not source_path.exists():
            raise EnglishCourseError("上传视频已丢失，请重新上传。")
        audio_path = source_path.parent / "audio.wav"
        _extract_audio_track_to_wav(source_path, audio_path)
        duration_seconds = _probe_media_duration_seconds(source_path)
        _append_generation_log_event(
            task_id=task_id,
            stage="extract_audio",
            kind="result",
            message="音轨提取完成。",
            data={
                "audio_path": str(audio_path),
                "duration_seconds": duration_seconds,
            },
        )

        def asr_progress(payload: dict[str, Any]) -> None:
            status = str(payload.get("task_status") or "RUNNING")
            elapsed = int(payload.get("elapsed_seconds") or 0)
            _update_task_fields(
                None,
                task_id,
                status="running",
                stage="transcribe",
                progress_percent=45,
                message=f"正在识别字幕（{status}，已等待 {elapsed} 秒）",
            )

        _update_task_fields(
            None,
            task_id,
            status="running",
            stage="transcribe",
            progress_percent=35,
            message="正在识别字幕",
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="status",
            message="开始调用 ASR 转写。",
        )
        asr_payload = _transcribe_audio_with_dashscope(
            audio_path,
            task_id=task_id,
            progress_callback=asr_progress,
        )

        _update_task_fields(
            None,
            task_id,
            status="running",
            stage="prepare_sentences",
            progress_percent=60,
            message="正在整理 ASR 句子结果",
        )
        prepared_sentences = _prepare_sentences_from_asr(asr_payload, task_id=task_id)
        if not prepared_sentences:
            raise EnglishCourseError("没有识别出可学习的英语句子，请更换素材后重试。")

        _update_task_fields(
            None,
            task_id,
            status="running",
            stage="translate",
            progress_percent=70,
            message=f"正在翻译句子 0/{len(prepared_sentences)}",
        )
        translated_sentences = _translate_sentences(prepared_sentences, task_id=task_id)

        _update_task_fields(
            None,
            task_id,
            status="running",
            stage="finalize",
            progress_percent=95,
            message="正在保存课程",
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="finalize",
            kind="status",
            message="开始保存课程。",
            data={"sentence_count": len(translated_sentences)},
        )
        _finalize_course_from_task(
            task_id=task_id,
            source_path=source_path,
            source_mime_type=task.source_mime_type or _guess_media_type(task.source_filename),
            file_size=int(task.file_size or source_path.stat().st_size),
            duration_seconds=duration_seconds,
            sentences=translated_sentences,
        )
    except Exception as exc:
        logger.exception("english generation task failed: %s", task_id)
        _append_generation_log_event(
            task_id=task_id,
            stage="failed",
            kind="error",
            message="英语生成失败。",
            data={
                "error": str(exc),
                "traceback": traceback.format_exc(limit=20),
            },
        )
        _update_task_fields(
            None,
            task_id,
            status="failed",
            stage="failed",
            progress_percent=100,
            message="生成失败",
            error_message=str(exc),
            completed_at=utc_now_naive(),
        )
    finally:
        session.close()


def _finalize_course_from_task(
    *,
    task_id: str,
    source_path: Path,
    source_mime_type: str,
    file_size: int,
    duration_seconds: int,
    sentences: list[dict[str, Any]],
) -> None:
    session = get_session()
    try:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            return
        title = _derive_course_title(task.source_filename)
        course = EnglishCourse(
            title=title,
            original_filename=task.source_filename or source_path.name,
            media_filename="",
            media_relative_path="",
            media_mime_type=source_mime_type or _guess_media_type(task.source_filename),
            file_size=max(0, int(file_size)),
            duration_seconds=max(0, int(duration_seconds)),
            sentence_count=len(sentences),
        )
        session.add(course)
        session.flush()

        course_dir = _course_dir(course.id)
        course_dir.mkdir(parents=True, exist_ok=True)
        media_filename = f"source{source_path.suffix or '.mp4'}"
        target_media_path = course_dir / media_filename
        shutil.move(str(source_path), str(target_media_path))
        course.media_filename = media_filename
        course.media_relative_path = f"{course_dir.name}/{media_filename}"

        for index, sentence in enumerate(sentences):
            course.sentences.append(
                EnglishSentence(
                    sentence_index=index,
                    text_en=str(sentence.get("text_en") or ""),
                    text_zh=str(sentence.get("text_zh") or ""),
                    start_ms=max(0, int(sentence.get("start_ms") or 0)),
                    end_ms=max(0, int(sentence.get("end_ms") or 0)),
                    tokens_json=json.dumps(sentence.get("tokens") or [], ensure_ascii=False),
                    vocabulary_json="[]",
                )
            )
        progress = EnglishCourseProgress(
            course=course,
            current_sentence_index=0,
            completed_sentence_indexes_json="[]",
            is_completed=False,
        )
        session.add(progress)
        task.course_id = course.id
        task.status = "completed"
        task.stage = "completed"
        task.progress_percent = 100
        task.message = "课程已生成"
        task.error_message = ""
        task.completed_at = utc_now_naive()
        task.updated_at = utc_now_naive()
        session.commit()
        _append_generation_log_event(
            task_id=task_id,
            stage="finalize",
            kind="result",
            message="课程保存完成。",
            data={
                "course_id": course.id,
                "course_title": course.title,
                "sentence_count": len(sentences),
            },
        )
        _move_generation_log_to_course(task_id=task_id, course_id=course.id)
        shutil.rmtree(_task_dir(task_id), ignore_errors=True)
    finally:
        session.close()


def _get_current_task(session: Session) -> EnglishGenerationTask | None:
    return (
        session.query(EnglishGenerationTask)
        .filter(EnglishGenerationTask.status.in_(tuple(VISIBLE_TASK_STATUSES)))
        .order_by(EnglishGenerationTask.created_at.desc(), EnglishGenerationTask.id.desc())
        .first()
    )


def _update_task_fields(
    session: Session | None,
    task_id: str,
    **fields: Any,
) -> None:
    owns_session = session is None
    session = session or get_session()
    try:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            return
        for key, value in fields.items():
            setattr(task, key, value)
        task.updated_at = utc_now_naive()
        session.commit()
    finally:
        if owns_session:
            session.close()


def _serialize_task(task: EnglishGenerationTask | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "id": task.id,
        "status": task.status,
        "stage": task.stage,
        "progressPercent": int(task.progress_percent or 0),
        "message": task.message or "",
        "sourceFilename": task.source_filename or "",
        "fileSize": int(task.file_size or 0),
        "errorMessage": task.error_message or "",
        "courseId": task.course_id,
        "createdAt": task.created_at.isoformat() if task.created_at else None,
        "updatedAt": task.updated_at.isoformat() if task.updated_at else None,
        "startedAt": task.started_at.isoformat() if task.started_at else None,
        "completedAt": task.completed_at.isoformat() if task.completed_at else None,
    }


def _serialize_course_summary(course: EnglishCourse) -> dict[str, Any]:
    progress = course.progress
    status = "completed" if progress and progress.is_completed else "unfinished"
    current_sentence_index = int(progress.current_sentence_index or 0) if progress else 0
    return {
        "id": course.id,
        "title": course.title,
        "originalFilename": course.original_filename,
        "sentenceCount": int(course.sentence_count or 0),
        "durationSeconds": int(course.duration_seconds or 0),
        "status": status,
        "currentSentenceIndex": current_sentence_index,
        "updatedAt": course.updated_at.isoformat() if course.updated_at else None,
        "createdAt": course.created_at.isoformat() if course.created_at else None,
    }


def _serialize_progress(progress: EnglishCourseProgress, *, sentence_count: int) -> dict[str, Any]:
    completed_indexes = _normalize_completed_indexes(
        json.loads(progress.completed_sentence_indexes_json or "[]"),
        sentence_count=sentence_count,
    )
    return {
        "currentSentenceIndex": int(progress.current_sentence_index or 0),
        "completedSentenceIndexes": completed_indexes,
        "completed": bool(progress.is_completed),
        "updatedAt": progress.updated_at.isoformat() if progress.updated_at else None,
    }


def _serialize_sentence(sentence: EnglishSentence) -> dict[str, Any]:
    return {
        "id": sentence.id,
        "index": int(sentence.sentence_index or 0),
        "textEn": sentence.text_en or "",
        "textZh": sentence.text_zh or "",
        "startMs": int(sentence.start_ms or 0),
        "endMs": int(sentence.end_ms or 0),
        "tokens": json.loads(sentence.tokens_json or "[]"),
    }


def _repair_course_duration_if_needed(session: Session, course: EnglishCourse) -> EnglishCourse:
    duration_seconds = int(course.duration_seconds or 0)
    if 0 < duration_seconds <= MAX_REASONABLE_MEDIA_DURATION_SECONDS:
        return course

    try:
        media_path = resolve_course_media_path(course)
    except EnglishCourseError:
        return course

    repaired_duration_seconds = _probe_media_duration_seconds(media_path)
    if repaired_duration_seconds <= 0 or repaired_duration_seconds == duration_seconds:
        return course

    logger.info(
        "repairing english course duration",
        extra={
            "course_id": course.id,
            "previous_duration_seconds": duration_seconds,
            "repaired_duration_seconds": repaired_duration_seconds,
        },
    )
    course.duration_seconds = repaired_duration_seconds
    session.commit()
    return course


def _ensure_progress_row(session: Session, course: EnglishCourse) -> EnglishCourseProgress:
    progress = course.progress
    if progress is not None:
        return progress
    progress = EnglishCourseProgress(
        course=course,
        current_sentence_index=0,
        completed_sentence_indexes_json="[]",
        is_completed=False,
    )
    session.add(progress)
    session.commit()
    session.refresh(progress)
    return progress


def _normalize_completed_indexes(values: list[Any], *, sentence_count: int) -> list[int]:
    result: set[int] = set()
    max_index = max(0, sentence_count - 1)
    for item in values:
        try:
            index = int(item)
        except Exception:
            continue
        if 0 <= index <= max_index:
            result.add(index)
    return sorted(result)


def _derive_course_title(filename: str) -> str:
    stem = Path(filename or "").stem.strip()
    if not stem:
        return "未命名英语课程"
    return stem.replace("_", " ").strip() or "未命名英语课程"


def _guess_media_type(filename: str) -> str:
    guessed = mimetypes.guess_type(filename or "")[0]
    return guessed or "video/mp4"


def _extract_audio_track_to_wav(video_path: Path, output_path: Path) -> None:
    try:
        container = av.open(str(video_path))
    except Exception as exc:
        raise EnglishCourseError("无法读取上传的视频文件。") from exc
    try:
        audio_stream = next((stream for stream in container.streams if stream.type == "audio"), None)
        if audio_stream is None:
            raise EnglishCourseError("视频中没有可识别的音轨。")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        with wave.open(str(output_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            for frame in container.decode(audio_stream):
                converted = resampler.resample(frame)
                frames = converted if isinstance(converted, list) else [converted]
                for item in frames:
                    if item is None:
                        continue
                    wav_file.writeframes(item.to_ndarray().tobytes())
            flushed = resampler.resample(None)
            frames = flushed if isinstance(flushed, list) else [flushed]
            for item in frames:
                if item is None:
                    continue
                wav_file.writeframes(item.to_ndarray().tobytes())
    finally:
        container.close()


def _probe_media_duration_seconds(video_path: Path) -> int:
    try:
        container = av.open(str(video_path))
    except Exception:
        return 0
    try:
        if container.duration:
            return max(0, int(round(float(container.duration) / float(av.time_base))))
        video_stream = next((stream for stream in container.streams if stream.type == "video"), None)
        if video_stream is not None and video_stream.duration is not None and video_stream.time_base is not None:
            return max(0, int(round(float(video_stream.duration * video_stream.time_base))))
        return 0
    finally:
        container.close()


def _transcribe_audio_with_dashscope(
    audio_path: Path,
    *,
    task_id: str,
    progress_callback: Any | None = None,
) -> dict[str, Any]:
    api_key = str(DASHSCOPE_API_KEY or "").strip()
    if not api_key:
        raise EnglishCourseError("未配置 DASHSCOPE_API_KEY，无法生成英语课程。")
    dashscope.api_key = api_key
    dashscope.base_http_api_url = _resolve_dashscope_sdk_base_url(DASHSCOPE_BASE_URL)
    try:
        upload_response = Files.upload(file_path=str(audio_path), purpose="inference")
    except Exception as exc:
        raise EnglishCourseError(f"上传音频到转写服务失败：{exc}") from exc
    upload_output = _to_dict(getattr(upload_response, "output", None))
    file_id = _resolve_file_id(upload_output)
    if not file_id:
        raise EnglishCourseError("音频上传成功，但未拿到 file_id。")
    _append_generation_log_event(
        task_id=task_id,
        stage="transcribe",
        kind="request",
        message="ASR 音频上传完成。",
        data={
            "file_id": file_id,
            "upload_output": upload_output,
        },
    )
    try:
        file_meta = Files.get(file_id=file_id)
    except Exception as exc:
        raise EnglishCourseError(f"查询转写文件失败：{exc}") from exc
    meta_output = _to_dict(getattr(file_meta, "output", None))
    signed_url = _resolve_signed_url(meta_output)
    if not signed_url:
        raise EnglishCourseError("转写文件签名地址为空。")
    _append_generation_log_event(
        task_id=task_id,
        stage="transcribe",
        kind="request",
        message="已获取 ASR 文件签名地址。",
        data={
            "file_meta": meta_output,
            "signed_url": _sanitize_url(signed_url),
        },
    )
    try:
        task_response = QwenTranscription.async_call(
            model=DASHSCOPE_ASR_MODEL,
            file_url=signed_url,
            enable_words=True,
            enable_itn=False,
        )
    except Exception as exc:
        raise EnglishCourseError(f"创建字幕转写任务失败：{exc}") from exc
    task_output = _to_dict(getattr(task_response, "output", None))
    remote_task_id = str(task_output.get("task_id") or "").strip()
    if not remote_task_id:
        raise EnglishCourseError("转写任务创建成功，但 task_id 为空。")
    _append_generation_log_event(
        task_id=task_id,
        stage="transcribe",
        kind="request",
        message="已创建 ASR 任务。",
        data={
            "model": DASHSCOPE_ASR_MODEL,
            "remote_task_id": remote_task_id,
            "task_output": task_output,
        },
    )

    started = monotonic()
    final_fetch_output: dict[str, Any] = {}
    while True:
        try:
            fetch_response = QwenTranscription.fetch(task=remote_task_id)
        except Exception as exc:
            raise EnglishCourseError(f"轮询字幕转写任务失败：{exc}") from exc
        fetch_output = _to_dict(getattr(fetch_response, "output", None))
        final_fetch_output = fetch_output
        task_status = str(fetch_output.get("task_status") or "").strip().upper()
        elapsed_seconds = int(monotonic() - started)
        if progress_callback:
            try:
                progress_callback(
                    {
                        "task_status": task_status or "RUNNING",
                        "elapsed_seconds": elapsed_seconds,
                    }
                )
            except Exception:
                logger.debug("english asr progress callback failed", exc_info=True)
        _append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="progress",
            message=f"ASR 轮询状态：{task_status or 'RUNNING'}。",
            data={
                "remote_task_id": remote_task_id,
                "elapsed_seconds": elapsed_seconds,
                "fetch_output": fetch_output,
            },
        )
        if task_status == "SUCCEEDED":
            break
        if task_status in {"FAILED", "CANCELED", "CANCELLED"}:
            raise EnglishCourseError("字幕转写任务失败，请稍后重试。")
        threading.Event().wait(ASR_POLL_SECONDS)

    transcription_url = _extract_transcription_url(final_fetch_output)
    if not transcription_url:
        raise EnglishCourseError("字幕转写成功，但结果地址为空。")
    try:
        response = requests.get(transcription_url, timeout=60)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise EnglishCourseError(f"下载字幕转写结果失败：{exc}") from exc
    normalized_payload = payload if isinstance(payload, dict) else {}
    _append_generation_log_event(
        task_id=task_id,
        stage="transcribe",
        kind="response",
        message="已下载 ASR 结果。",
        data={
            "transcription_url": _sanitize_url(transcription_url),
            "transcript_count": len(normalized_payload.get("transcripts") or []),
            "payload": normalized_payload,
        },
    )
    return normalized_payload


def _translate_sentences(sentences: list[dict[str, Any]], *, task_id: str) -> list[dict[str, Any]]:
    if not str(DASHSCOPE_API_KEY or "").strip():
        raise EnglishCourseError("未配置 DASHSCOPE_API_KEY，无法生成中文译文。")
    config = OpenAICompatibleChatConfig(
        api_key=str(DASHSCOPE_API_KEY or "").strip(),
        base_url=str(DASHSCOPE_BASE_URL or "").strip(),
        model=str(ENGLISH_TRANSLATION_MODEL or "").strip() or "qwen-mt-flash",
        temperature=0.0,
        timeout_seconds=120,
    )
    translated_by_index: dict[int, str] = {}
    total = len(sentences)
    for start in range(0, total, TRANSLATION_BATCH_SIZE):
        batch = sentences[start : start + TRANSLATION_BATCH_SIZE]
        translated_by_index.update(
            _translate_sentence_batch_with_fallback(
                config=config,
                batch=batch,
                task_id=task_id,
            )
        )
        translated_count = len(translated_by_index)
        _update_task_fields(
            None,
            task_id,
            status="running",
            stage="translate",
            progress_percent=70 + int((translated_count / max(total, 1)) * 22),
            message=f"正在翻译句子 {translated_count}/{total}",
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="progress",
            message=f"翻译进度 {translated_count}/{total}。",
            data={
                "translated_count": translated_count,
                "total": total,
            },
        )
    result: list[dict[str, Any]] = []
    for sentence in sentences:
        index = int(sentence["index"])
        result.append(
            {
                **sentence,
                "text_zh": str(translated_by_index.get(index) or "").strip(),
            }
        )
    return result


def _translate_sentence_batch_with_fallback(
    *,
    config: OpenAICompatibleChatConfig,
    batch: list[dict[str, Any]],
    task_id: str,
) -> dict[int, str]:
    if not batch:
        return {}
    if len(batch) == 1:
        item = batch[0]
        return {
            int(item["index"]): _translate_single_sentence(
                config=config,
                sentence=item,
                task_id=task_id,
            )
        }
    try:
        return _translate_sentence_batch(config=config, batch=batch, task_id=task_id)
    except EnglishTranslationBatchMismatchError as exc:
        _append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="warning",
            message="批量翻译结果与输入不匹配，自动拆小重试。",
            data={
                "indexes": [int(item["index"]) for item in batch],
                "batch_size": len(batch),
                "error": str(exc),
            },
        )
        midpoint = max(1, len(batch) // 2)
        left = _translate_sentence_batch_with_fallback(
            config=config,
            batch=batch[:midpoint],
            task_id=task_id,
        )
        right = _translate_sentence_batch_with_fallback(
            config=config,
            batch=batch[midpoint:],
            task_id=task_id,
        )
        return {**left, **right}


def _translate_sentence_batch(
    *,
    config: OpenAICompatibleChatConfig,
    batch: list[dict[str, Any]],
    task_id: str,
) -> dict[int, str]:
    source_text = "\n".join(
        f"[S{int(item['index']):04d}] {str(item['text_en'] or '').strip()}"
        for item in batch
    )
    translation_options = {
        "source_lang": "English",
        "target_lang": "Chinese",
    }
    request_payload = {
        "sentence_indexes": [int(item["index"]) for item in batch],
        "source_text": source_text,
        "translation_options": translation_options,
    }
    log_id = begin_external_ai_call_log(
        feature="英语课程生成",
        operation="english_sentence_translation_batch",
        provider="dashscope",
        base_url=config.base_url,
        model=config.model,
        job_id=task_id,
        request_payload=request_payload,
    )
    _append_generation_log_event(
        task_id=task_id,
        stage="translate",
        kind="request",
        message=f"开始批量翻译 {len(batch)} 句。",
        data={
            "indexes": request_payload["sentence_indexes"],
            "source_text": source_text,
            "translation_options": translation_options,
            "ai_call_log_id": log_id,
        },
    )
    try:
        response_text = call_chat_completion_text(
            config=config,
            messages=[{"role": "user", "content": source_text}],
            extra_payload={"translation_options": translation_options},
        )
        parsed = _parse_translation_batch_response(response_text, batch=batch)
        complete_external_ai_call_log(
            log_id,
            response_payload={
                "response_text": response_text,
                "parsed_items": parsed,
            },
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="response",
            message="批量翻译完成。",
            data={
                "indexes": request_payload["sentence_indexes"],
                "response_text": response_text,
                "parsed_items": parsed,
                "ai_call_log_id": log_id,
            },
        )
        return parsed
    except Exception as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "error": str(exc),
            },
        )
        if isinstance(exc, EnglishTranslationBatchMismatchError):
            raise
        raise EnglishCourseError(f"翻译句子失败：{exc}") from exc


def _translate_single_sentence(
    *,
    config: OpenAICompatibleChatConfig,
    sentence: dict[str, Any],
    task_id: str,
) -> str:
    source_text = str(sentence.get("text_en") or "").strip()
    translation_options = {
        "source_lang": "English",
        "target_lang": "Chinese",
    }
    request_payload = {
        "sentence_index": int(sentence["index"]),
        "source_text": source_text,
        "translation_options": translation_options,
    }
    log_id = begin_external_ai_call_log(
        feature="英语课程生成",
        operation="english_sentence_translation_single",
        provider="dashscope",
        base_url=config.base_url,
        model=config.model,
        job_id=task_id,
        request_payload=request_payload,
    )
    _append_generation_log_event(
        task_id=task_id,
        stage="translate",
        kind="request",
        message=f"降级为单句翻译：{int(sentence['index'])}。",
        data={
            "index": int(sentence["index"]),
            "source_text": source_text,
            "translation_options": translation_options,
            "ai_call_log_id": log_id,
        },
    )
    try:
        response_text = call_chat_completion_text(
            config=config,
            messages=[{"role": "user", "content": source_text}],
            extra_payload={"translation_options": translation_options},
        ).strip()
        if not response_text:
            raise EnglishCourseError("单句翻译结果为空。")
        complete_external_ai_call_log(
            log_id,
            response_payload={
                "response_text": response_text,
                "translation": response_text,
            },
        )
        _append_generation_log_event(
            task_id=task_id,
            stage="translate",
            kind="response",
            message=f"单句翻译完成：{int(sentence['index'])}。",
            data={
                "index": int(sentence["index"]),
                "response_text": response_text,
                "ai_call_log_id": log_id,
            },
        )
        return response_text
    except Exception as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "error": str(exc),
            },
        )
        raise EnglishCourseError(f"翻译句子失败：{exc}") from exc


def _parse_translation_batch_response(
    response_text: str,
    *,
    batch: list[dict[str, Any]],
) -> dict[int, str]:
    expected_indexes = [int(item["index"]) for item in batch]
    parsed: dict[int, str] = {}
    for raw_line in response_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = _TRANSLATION_LINE_RE.match(line)
        if not match:
            continue
        index = int(match.group("index"))
        text = match.group("text").strip()
        parsed[index] = text
    if sorted(parsed.keys()) != sorted(expected_indexes):
        raise EnglishTranslationBatchMismatchError(
            f"翻译返回的编号与输入不一致，expected={expected_indexes}, got={sorted(parsed.keys())}"
        )
    if any(not parsed[index] for index in expected_indexes):
        raise EnglishTranslationBatchMismatchError("翻译返回存在空译文。")
    return parsed


def _prepare_sentences_from_asr(asr_payload: dict[str, Any], *, task_id: str) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    skipped_empty = 0
    skipped_invalid = 0
    transcripts = asr_payload.get("transcripts")
    if not isinstance(transcripts, list):
        _append_generation_log_event(
            task_id=task_id,
            stage="prepare_sentences",
            kind="warning",
            message="ASR 结果中没有 transcripts 数组。",
            data={"payload": asr_payload},
        )
        return []
    for transcript_index, transcript in enumerate(transcripts):
        if not isinstance(transcript, dict):
            continue
        sentences = transcript.get("sentences")
        if not isinstance(sentences, list):
            continue
        for sentence_payload in sentences:
            if not isinstance(sentence_payload, dict):
                continue
            text = str(sentence_payload.get("text") or "").strip()
            if not text:
                skipped_empty += 1
                continue
            begin_ms = _safe_ms(sentence_payload.get("begin_time"))
            end_ms = _safe_ms(sentence_payload.get("end_time"))
            if begin_ms <= 0 and sentence_payload.get("start") is not None:
                begin_ms = _safe_ms(sentence_payload.get("start"), seconds=True)
            if end_ms <= 0 and sentence_payload.get("end") is not None:
                end_ms = _safe_ms(sentence_payload.get("end"), seconds=True)
            if end_ms <= begin_ms:
                skipped_invalid += 1
                _append_generation_log_event(
                    task_id=task_id,
                    stage="prepare_sentences",
                    kind="warning",
                    message="丢弃时间轴异常的 ASR 句子。",
                    data={
                        "transcript_index": transcript_index,
                        "sentence": sentence_payload,
                    },
                )
                continue
            tokens = tokenize_learning_sentence(text)
            if not tokens:
                skipped_empty += 1
                continue
            prepared.append(
                {
                    "index": len(prepared),
                    "text_en": text,
                    "start_ms": begin_ms,
                    "end_ms": end_ms,
                    "tokens": tokens,
                }
            )
    _append_generation_log_event(
        task_id=task_id,
        stage="prepare_sentences",
        kind="result",
        message=f"ASR 句子整理完成，共保留 {len(prepared)} 句。",
        data={
            "kept_count": len(prepared),
            "skipped_empty_count": skipped_empty,
            "skipped_invalid_count": skipped_invalid,
        },
    )
    return prepared


def _safe_ms(value: Any, *, seconds: bool = False) -> int:
    try:
        numeric = float(value)
    except Exception:
        return 0
    if seconds:
        numeric *= 1000
    return max(0, int(round(numeric)))


def _resolve_dashscope_sdk_base_url(base_url: str) -> str:
    normalized = str(base_url or "").strip().rstrip("/")
    if not normalized:
        return "https://dashscope.aliyuncs.com/api/v1"
    if normalized.endswith("/compatible-mode/v1"):
        return normalized[: -len("/compatible-mode/v1")] + "/api/v1"
    if normalized.endswith("/v1"):
        return normalized[: -len("/v1")] + "/api/v1"
    return normalized


def _to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        try:
            parsed = value.to_dict()
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _resolve_file_id(upload_output: dict[str, Any]) -> str:
    uploaded_files = upload_output.get("uploaded_files")
    if isinstance(uploaded_files, list):
        for item in uploaded_files:
            if isinstance(item, dict):
                file_id = str(item.get("file_id") or "").strip()
                if file_id:
                    return file_id
    return str(upload_output.get("file_id") or "").strip()


def _resolve_signed_url(meta_output: dict[str, Any]) -> str:
    direct_url = str(meta_output.get("url") or "").strip()
    if direct_url:
        return direct_url
    files_payload = meta_output.get("files")
    if isinstance(files_payload, list):
        for item in files_payload:
            if isinstance(item, dict):
                candidate = str(item.get("url") or "").strip()
                if candidate:
                    return candidate
    return ""


def _extract_transcription_url(fetch_output: dict[str, Any]) -> str:
    result = fetch_output.get("result")
    if isinstance(result, dict):
        url = str(result.get("transcription_url") or "").strip()
        if url:
            return url
    results = fetch_output.get("results")
    if isinstance(results, list):
        for item in results:
            if not isinstance(item, dict):
                continue
            if str(item.get("subtask_status") or "").strip().upper() != "SUCCEEDED":
                continue
            url = str(item.get("transcription_url") or "").strip()
            if url:
                return url
    return ""


def _check_sentence_tokens(expected_tokens: list[str], input_text: str) -> EnglishSentenceCheckResult:
    normalized_expected = [
        normalize_token(token)
        for token in normalize_learning_token_list(expected_tokens)
        if normalize_token(token)
    ]
    normalized_input = tokenize_learning_sentence(input_text)
    max_len = max(len(normalized_expected), len(normalized_input))
    passed = len(normalized_expected) == len(normalized_input)
    token_results: list[dict[str, Any]] = []
    for index in range(max_len):
        expected = normalized_expected[index] if index < len(normalized_expected) else ""
        actual = normalized_input[index] if index < len(normalized_input) else ""
        correct = bool(expected and actual and expected == actual)
        if expected != actual:
            passed = False
        token_results.append(
            {
                "input": actual,
                "correct": correct,
                "missing": bool(expected and not actual),
                "unexpected": bool(actual and not expected),
            }
        )
    return EnglishSentenceCheckResult(
        passed=passed,
        token_results=token_results,
        normalized_input=normalized_input,
        normalized_expected=normalized_expected,
    )


def normalize_token(token: str) -> str:
    normalized = (token or "").strip().lower().replace("’", "'")
    return _PUNCT_EDGE_RE.sub("", normalized)


def tokenize_sentence(sentence: str) -> list[str]:
    raw_tokens = re.split(r"\s+", (sentence or "").strip())
    return [token for token in (normalize_token(item) for item in raw_tokens) if token]


def tokenize_learning_sentence(sentence: str) -> list[str]:
    return tokenize_sentence(normalize_learning_english_text(sentence))


def normalize_learning_token_list(tokens: list[str]) -> list[str]:
    output: list[str] = []
    for item in list(tokens or []):
        output.extend(tokenize_learning_sentence(str(item or "")))
    return output


def normalize_learning_english_text(text: str) -> str:
    source = str(text or "").strip()
    if not source:
        return ""

    def _replace(match: re.Match[str]) -> str:
        return _usd_amount_to_spoken_text(match.group(1), match.group(2))

    return _USD_AMOUNT_RE.sub(_replace, source)


def _usd_amount_to_spoken_text(dollar_text: str, cent_text: str | None) -> str:
    dollars = int((dollar_text or "0").replace(",", "") or "0")
    cents = 0
    if cent_text:
        cents = int(str(cent_text).ljust(2, "0")[:2])
    dollar_words = ""
    if dollars > 0 or cents == 0:
        dollar_unit = "dollar" if dollars == 1 else "dollars"
        dollar_words = f"{_integer_to_english(dollars)} {dollar_unit}"
    if cents <= 0:
        return dollar_words
    cent_unit = "cent" if cents == 1 else "cents"
    cent_words = f"{_integer_to_english(cents)} {cent_unit}"
    if dollars <= 0:
        return cent_words
    return f"{dollar_words} and {cent_words}"


def _integer_to_english(value: int) -> str:
    if value < 20:
        return _NUMBER_WORDS_LT_20[value]
    if value < 100:
        tens, remainder = divmod(value, 10)
        head = _NUMBER_WORDS_TENS[tens]
        return head if remainder == 0 else f"{head}-{_integer_to_english(remainder)}"
    if value < 1000:
        hundreds, remainder = divmod(value, 100)
        head = f"{_integer_to_english(hundreds)} hundred"
        return head if remainder == 0 else f"{head} {_integer_to_english(remainder)}"
    for scale_value, scale_name in _NUMBER_WORDS_SCALES:
        if value >= scale_value:
            major, remainder = divmod(value, scale_value)
            head = f"{_integer_to_english(major)} {scale_name}"
            return head if remainder == 0 else f"{head} {_integer_to_english(remainder)}"
    return str(value)


def _task_dir(task_id: str) -> Path:
    return ENGLISH_TASKS_DIR / task_id


def _course_dir(course_id: int) -> Path:
    return ENGLISH_MEDIA_DIR / f"course-{course_id}"


def _task_log_path(task_id: str) -> Path:
    return _task_dir(task_id) / GENERATION_LOG_FILENAME


def _course_log_path(course_id: int) -> Path:
    return _course_dir(course_id) / GENERATION_LOG_FILENAME


def _append_generation_log_event(
    *,
    task_id: str,
    stage: str,
    kind: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = {
        "id": uuid.uuid4().hex,
        "timestamp": utc_now_naive().isoformat(),
        "stage": stage,
        "kind": kind,
        "message": message,
        "data": data or {},
    }
    path = _task_log_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False))
        handle.write("\n")
    return event


def _move_generation_log_to_course(*, task_id: str, course_id: int) -> None:
    source = _task_log_path(task_id)
    if not source.exists():
        return
    target = _course_log_path(course_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def _read_generation_log_events(
    *,
    task: EnglishGenerationTask | None = None,
    course: EnglishCourse | None = None,
) -> list[dict[str, Any]]:
    candidate_paths: list[Path] = []
    if task is not None:
        candidate_paths.append(_task_log_path(task.id))
        if task.course_id:
            candidate_paths.append(_course_log_path(task.course_id))
    if course is not None:
        candidate_paths.append(_course_log_path(course.id))
    path = next((item for item in candidate_paths if item.exists()), None)
    if path is None:
        return []
    events: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _load_ai_logs_for_task(session: Session, task_id: str | None) -> list[dict[str, Any]]:
    if not task_id:
        return []
    summaries = list_external_ai_call_logs(session, job_id=task_id, limit=200)
    detailed: list[dict[str, Any]] = []
    for item in summaries:
        log_id = str(item.get("id") or "")
        if not log_id:
            continue
        detail = get_external_ai_call_log(session, log_id)
        if detail:
            detailed.append(detail)
    return detailed


def _sanitize_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlsplit(url)
    if not parsed.query:
        return url
    sanitized_query = urlencode(
        [
            (key, "***" if any(token in key.lower() for token in ("token", "signature", "key", "auth")) else value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, sanitized_query, parsed.fragment))
