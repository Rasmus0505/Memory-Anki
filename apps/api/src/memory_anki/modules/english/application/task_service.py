from __future__ import annotations

import json
import logging
import shutil
import traceback
import uuid
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path
from time import sleep
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables import get_session
from memory_anki.infrastructure.db._tables.english import EnglishCourse, EnglishGenerationTask
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.english.infrastructure.dashscope_gateway import (
    DashscopeEnglishAsrGateway,
    DashscopeEnglishTranslator,
)
from memory_anki.modules.english.infrastructure.generation_log_store import (
    append_generation_log_event,
    load_ai_logs_for_task,
    read_generation_log_events,
)
from memory_anki.modules.english.infrastructure.media import (
    extract_audio_track_to_wav,
    probe_media_duration_seconds,
)
from memory_anki.modules.english.infrastructure.paths import task_dir
from memory_anki.modules.english.infrastructure.task_runner import (
    EnglishTaskRunner,
    LocalThreadEnglishTaskRunner,
)
from memory_anki.modules.sessions.application.study_session_service import (
    get_english_study_stats,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

from .asr_normalization import prepare_sentences_from_asr
from .course_service import (
    finalize_course_from_task,
    get_recent_unfinished_course_payload,
    guess_media_type,
    list_recent_courses,
)

logger = logging.getLogger(__name__)

VISIBLE_TASK_STATUSES = {"queued", "running", "failed"}
ACTIVE_TASK_STATUSES = {"queued", "running"}
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
GENERATION_LOG_POLL_SECONDS = 0.4
STARTUP_PRESERVED_TASK_STATUSES = {"completed", "cleared"}


@dataclass(slots=True)
class EnglishRuntime:
    runner: EnglishTaskRunner
    asr_gateway: Any
    translator: Any


_runtime = EnglishRuntime(
    runner=LocalThreadEnglishTaskRunner(),
    asr_gateway=DashscopeEnglishAsrGateway(),
    translator=DashscopeEnglishTranslator(),
)


def configure_english_runtime(runtime: EnglishRuntime) -> None:
    global _runtime
    _runtime = runtime


def get_english_runtime() -> EnglishRuntime:
    return _runtime


def get_workspace_summary(session: Session) -> dict[str, Any]:
    return {
        "currentTask": get_current_task_payload(session),
        "continueCourse": get_recent_unfinished_course_payload(session),
        "recentCourses": list_recent_courses(session),
        "stats": get_english_study_stats(session),
    }


def get_current_task_payload(session: Session) -> dict[str, Any] | None:
    task = get_current_task(session)
    return serialize_task(task) if task else None


def create_generation_task(
    session: Session,
    *,
    filename: str,
    content_type: str,
    file_bytes: bytes,
    asr_ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    current_task = get_current_task(session)
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

    task = create_task_row(
        session,
        filename=filename,
        content_type=content_type,
        file_bytes=file_bytes,
        asr_ai_options=asr_ai_options,
    )
    get_english_runtime().runner.launch(task["id"], run_generation_task)
    return task


def retry_current_task(session: Session) -> dict[str, Any]:
    task = get_current_task(session)
    if task is None or task.status != "failed":
        raise EnglishCourseError("当前没有可重试的失败任务。")
    source_path = Path(task.source_media_path or "")
    if not source_path.exists():
        raise EnglishCourseError("原始视频已丢失，无法重试，请重新上传。")
    retry_task = create_task_row(
        session,
        filename=task.source_filename,
        content_type=task.source_mime_type or guess_media_type(task.source_filename),
        file_bytes=source_path.read_bytes(),
    )
    old_dir = source_path.parent
    new_dir = task_dir(retry_task["id"])
    for artifact_name in ("asr_result.json", "audio.wav", "runtime_options.json"):
        artifact = old_dir / artifact_name
        if artifact.exists():
            shutil.copy2(artifact, new_dir / artifact_name)
    task.status = "retried"
    task.stage = "retried"
    task.message = "已重试，历史日志保留。"
    task.updated_at = utc_now_naive()
    session.commit()
    get_english_runtime().runner.launch(retry_task["id"], run_generation_task)
    return retry_task


def clear_current_task(session: Session) -> None:
    task = get_current_task(session)
    if task is None:
        return
    if task.status not in {"failed", "queued"}:
        raise EnglishCourseError("当前任务正在处理中，暂不支持清除。")
    task_path = task_dir(task.id)
    task.status = "cleared"
    task.stage = "cleared"
    task.message = "任务已清除。"
    task.updated_at = utc_now_naive()
    session.commit()
    shutil.rmtree(task_path, ignore_errors=True)


def get_task_generation_log(session: Session, task_id: str) -> dict[str, Any]:
    task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
    if task is None:
        raise EnglishCourseError("英语生成任务不存在。")
    ai_logs = load_ai_logs_for_task(session, task.id)
    return {
        "task": serialize_task(task),
        "events": read_generation_log_events(task=task),
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
    ai_logs = load_ai_logs_for_task(session, task.id if task else None)
    return {
        "task": serialize_task(task) if task else None,
        "events": read_generation_log_events(task=task, course=course),
        "aiLogs": ai_logs,
    }


def stream_task_events(task_id: str) -> Generator[str, None, None]:
    def encode(event_name: str, payload: dict[str, Any]) -> str:
        return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    with get_session() as session:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            yield encode("error", {"error": "英语生成任务不存在。"})
            return

    sent_event_ids: set[str] = set()
    last_status_signature: tuple[Any, ...] | None = None

    while True:
        with get_session() as session:
            task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
            if task is None:
                yield encode("error", {"error": "英语生成任务不存在。"})
                return
            task_payload = serialize_task(task)

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
            yield encode("status", {"task": task_payload})

        for event in read_generation_log_events(task=task):
            event_id = str(event.get("id") or "")
            if not event_id or event_id in sent_event_ids:
                continue
            sent_event_ids.add(event_id)
            yield encode("log", {"event": event})

        if task.status == "completed":
            yield encode("done", {"task": task_payload})
            return
        if task.status == "failed":
            yield encode(
                "error",
                {
                    "task": task_payload,
                    "error": task_payload["errorMessage"] or "英语生成失败。",
                },
            )
            return
        if task.status in {"retried", "cleared"}:
            yield encode("done", {"task": task_payload})
            return

        sleep(GENERATION_LOG_POLL_SECONDS)


def create_task_row(
    session: Session,
    *,
    filename: str,
    content_type: str,
    file_bytes: bytes,
    asr_ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    suffix = Path(filename).suffix or ".mp4"
    task_id = uuid.uuid4().hex
    task_path = task_dir(task_id)
    task_path.mkdir(parents=True, exist_ok=True)
    source_path = task_path / f"source{suffix}"
    source_path.write_bytes(file_bytes)
    (task_path / "runtime_options.json").write_text(
        json.dumps(
            {
                "asr": {
                    "model": asr_ai_options.model if asr_ai_options else None,
                    "thinking_enabled": (
                        asr_ai_options.thinking_enabled if asr_ai_options else None
                    ),
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    task = EnglishGenerationTask(
        id=task_id,
        status="queued",
        stage="queued",
        progress_percent=5,
        message="等待开始生成",
        source_filename=filename,
        source_media_path=str(source_path),
        source_mime_type=content_type or guess_media_type(filename),
        file_size=len(file_bytes),
        error_message="",
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    append_generation_log_event(
        task_id=task.id,
        stage="queued",
        kind="info",
        message="已创建英语生成任务。",
        data={
            "source_filename": filename,
            "content_type": content_type or guess_media_type(filename),
            "file_size": len(file_bytes),
        },
    )
    return serialize_task(task)


def run_generation_task(task_id: str) -> None:
    session = get_session()
    try:
        task = session.query(EnglishGenerationTask).filter_by(id=task_id).first()
        if task is None:
            return
        update_task_fields(
            session,
            task_id,
            status="running",
            stage="extract_audio",
            progress_percent=15,
            message="正在提取音轨",
            started_at=utc_now_naive(),
            error_message="",
        )
        append_generation_log_event(
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
        if not audio_path.exists():
            extract_audio_track_to_wav(source_path, audio_path)
        duration_seconds = probe_media_duration_seconds(source_path)
        append_generation_log_event(
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
            update_task_fields(
                None,
                task_id,
                status="running",
                stage="transcribe",
                progress_percent=45,
                message=f"正在识别字幕（{status}，已等待 {elapsed} 秒）",
            )

        update_task_fields(
            None,
            task_id,
            status="running",
            stage="transcribe",
            progress_percent=35,
            message="正在识别字幕",
        )
        append_generation_log_event(
            task_id=task_id,
            stage="transcribe",
            kind="status",
            message="开始调用 ASR 转写。",
        )
        runtime = get_english_runtime()
        asr_cache_path = source_path.parent / "asr_result.json"
        if asr_cache_path.exists():
            asr_payload = json.loads(asr_cache_path.read_text(encoding="utf-8"))
            append_generation_log_event(
                task_id=task_id,
                stage="transcribe",
                kind="result",
                message="复用已完成的 ASR 转写结果（未重新调用 ASR）。",
            )
        else:
            asr_payload = runtime.asr_gateway.transcribe(
                audio_path,
                task_id=task_id,
                ai_options=load_task_asr_ai_options(source_path.parent),
                progress_callback=asr_progress,
            )
            asr_cache_path.write_text(
                json.dumps(asr_payload, ensure_ascii=False),
                encoding="utf-8",
            )

        update_task_fields(
            None,
            task_id,
            status="running",
            stage="prepare_sentences",
            progress_percent=60,
            message="正在整理 ASR 句子结果",
        )
        prepared_result = prepare_sentences_from_asr(asr_payload)
        for warning in prepared_result.warnings:
            append_generation_log_event(
                task_id=task_id,
                stage="prepare_sentences",
                kind="warning",
                message=str(warning.get("message") or "ASR 句子整理警告。"),
                data=warning.get("data") if isinstance(warning.get("data"), dict) else {},
            )
        append_generation_log_event(
            task_id=task_id,
            stage="prepare_sentences",
            kind="result",
            message=f"ASR 句子整理完成，共保留 {len(prepared_result.sentences)} 句。",
            data={
                "kept_count": len(prepared_result.sentences),
                "skipped_empty_count": prepared_result.skipped_empty_count,
                "skipped_invalid_count": prepared_result.skipped_invalid_count,
            },
        )
        if not prepared_result.sentences:
            raise EnglishCourseError("没有识别出可学习的英语句子，请更换素材后重试。")

        update_task_fields(
            None,
            task_id,
            status="running",
            stage="translate",
            progress_percent=70,
            message=f"正在翻译句子 0/{len(prepared_result.sentences)}",
        )
        translated_sentences = runtime.translator.translate_sentences(
            prepared_result.sentences,
            task_id=task_id,
        )

        update_task_fields(
            None,
            task_id,
            status="running",
            stage="finalize",
            progress_percent=95,
            message="正在保存课程",
        )
        append_generation_log_event(
            task_id=task_id,
            stage="finalize",
            kind="status",
            message="开始保存课程。",
            data={"sentence_count": len(translated_sentences)},
        )
        finalize_generation_task(
            task_id=task_id,
            source_path=source_path,
            source_mime_type=task.source_mime_type or guess_media_type(task.source_filename),
            file_size=int(task.file_size or source_path.stat().st_size),
            duration_seconds=duration_seconds,
            sentences=translated_sentences,
        )
    except Exception as exc:
        logger.exception("english generation task failed: %s", task_id)
        append_generation_log_event(
            task_id=task_id,
            stage="failed",
            kind="error",
            message="英语生成失败。",
            data={
                "error": str(exc),
                "traceback": traceback.format_exc(limit=20),
            },
        )
        update_task_fields(
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


def finalize_generation_task(
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
        course = finalize_course_from_task(
            session,
            task_id=task_id,
            task=task,
            source_path=source_path,
            source_mime_type=source_mime_type,
            file_size=file_size,
            duration_seconds=duration_seconds,
            sentences=sentences,
        )
        if course is None:
            return
        append_generation_log_event(
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
        shutil.rmtree(task_dir(task_id), ignore_errors=True)
    finally:
        session.close()


def update_task_fields(
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


def serialize_task(task: EnglishGenerationTask | None) -> dict[str, Any] | None:
    if task is None:
        return None
    resolved_ai = None
    try:
        resolved_ai = serialize_resolved_ai_runtime(
            resolve_scenario_runtime(
                None,
                "asr_course_transcription",
                ai_options=load_task_asr_ai_options(task_dir(task.id)),
            )
        )
    except Exception:
        resolved_ai = None
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
        "resolved_ai": resolved_ai,
    }


def get_current_task(session: Session) -> EnglishGenerationTask | None:
    return (
        session.query(EnglishGenerationTask)
        .filter(EnglishGenerationTask.status.in_(tuple(VISIBLE_TASK_STATUSES)))
        .order_by(EnglishGenerationTask.created_at.desc(), EnglishGenerationTask.id.desc())
        .first()
    )


def load_task_asr_ai_options(task_path: Path) -> AiRuntimeOptions:
    options_path = task_path / "runtime_options.json"
    if not options_path.exists():
        return AiRuntimeOptions()
    try:
        payload = json.loads(options_path.read_text(encoding="utf-8"))
    except Exception:
        return AiRuntimeOptions()
    asr_payload = payload.get("asr") if isinstance(payload, dict) else None
    if not isinstance(asr_payload, dict):
        return AiRuntimeOptions()
    return AiRuntimeOptions(
        model=str(asr_payload.get("model") or "").strip() or None,
        thinking_enabled=(
            None
            if asr_payload.get("thinking_enabled") is None
            else bool(asr_payload.get("thinking_enabled"))
        ),
    )


def cleanup_incomplete_generation_tasks(session: Session) -> dict[str, int]:
    tasks = (
        session.query(EnglishGenerationTask)
        .filter(EnglishGenerationTask.status.notin_(tuple(STARTUP_PRESERVED_TASK_STATUSES)))
        .all()
    )
    interrupted = 0
    cleared = 0
    for task in tasks:
        if task.status in ACTIVE_TASK_STATUSES:
            task.status = "failed"
            task.stage = "interrupted"
            task.message = "生成因服务重启被中断，可点击重试继续。"
            task.error_message = "服务重启导致任务中断。"
            task.updated_at = utc_now_naive()
            interrupted += 1
            continue
        if task.status == "failed":
            continue
        task.status = "cleared"
        task.stage = "cleared"
        task.message = "启动时清理历史任务。"
        task.updated_at = utc_now_naive()
        shutil.rmtree(task_dir(task.id), ignore_errors=True)
        cleared += 1
    if interrupted or cleared:
        session.commit()
    return {"cleared": cleared, "interrupted": interrupted}
