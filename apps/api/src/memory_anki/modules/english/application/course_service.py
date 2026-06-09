from __future__ import annotations

import json
import logging
import mimetypes
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import ENGLISH_MEDIA_DIR
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    EnglishCourse,
    EnglishCourseProgress,
    EnglishSentence,
    TimeRecord,
)
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.english.domain.text import check_sentence_tokens
from memory_anki.modules.english.infrastructure.generation_log_store import (
    move_generation_log_to_course,
)
from memory_anki.modules.english.infrastructure.media import probe_media_duration_seconds
from memory_anki.modules.english.infrastructure.paths import course_dir

logger = logging.getLogger(__name__)

MAX_REASONABLE_MEDIA_DURATION_SECONDS = 60 * 60 * 24 * 30


def list_recent_courses(session: Session, limit: int = 12) -> list[dict[str, Any]]:
    courses = (
        session.query(EnglishCourse)
        .order_by(EnglishCourse.updated_at.desc(), EnglishCourse.id.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [serialize_course_summary(repair_course_duration_if_needed(session, course)) for course in courses]


def get_recent_unfinished_course_payload(session: Session) -> dict[str, Any] | None:
    progress = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(False))
        .order_by(EnglishCourseProgress.updated_at.desc(), EnglishCourseProgress.id.desc())
        .first()
    )
    if progress is None or progress.course is None:
        return None
    return serialize_course_summary(repair_course_duration_if_needed(session, progress.course))


def get_course_detail(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    course = repair_course_duration_if_needed(session, course)
    progress = course.progress or ensure_progress_row(session, course)
    return {
        **serialize_course_summary(course),
        "mediaUrl": f"/api/v1/english/courses/{course.id}/media",
        "sentences": [serialize_sentence(sentence) for sentence in course.sentences],
        "progress": serialize_progress(progress, sentence_count=course.sentence_count),
    }


def get_course_progress(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    progress = course.progress or ensure_progress_row(session, course)
    return serialize_progress(progress, sentence_count=course.sentence_count)


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
    progress = course.progress or ensure_progress_row(session, course)
    normalized_indexes = normalize_completed_indexes(
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
    return serialize_progress(progress, sentence_count=course.sentence_count)


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
    result = check_sentence_tokens(
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
    course_path = media_path.parent if media_path else None
    session.query(TimeRecord).filter(TimeRecord.english_course_id == course_id).update(
        {
            "english_course_id": None,
            "source_kind": "english",
        },
        synchronize_session=False,
    )
    session.delete(course)
    session.commit()
    if course_path is not None:
        shutil.rmtree(course_path, ignore_errors=True)


def resolve_course_media_path(course: EnglishCourse) -> Path:
    relative_path = str(course.media_relative_path or "").strip()
    if not relative_path:
        raise EnglishCourseError("课程媒体路径缺失。")
    candidate = ENGLISH_MEDIA_DIR / Path(relative_path)
    resolved = candidate.resolve()
    if not str(resolved).startswith(str(ENGLISH_MEDIA_DIR.resolve())):
        raise EnglishCourseError("课程媒体路径非法。")
    if not resolved.exists():
        raise EnglishCourseError("课程媒体文件不存在。")
    return resolved


def get_course_media_file(session: Session, course_id: int) -> dict[str, Any]:
    course = session.query(EnglishCourse).filter_by(id=course_id).first()
    if course is None:
        raise EnglishCourseError("英语课程不存在。")
    media_path = resolve_course_media_path(course)
    return {
        "path": media_path,
        "media_type": course.media_mime_type or "video/mp4",
        "filename": course.original_filename or media_path.name,
    }


def finalize_course_from_task(
    session: Session,
    *,
    task_id: str,
    task: Any,
    source_path: Path,
    source_mime_type: str,
    file_size: int,
    duration_seconds: int,
    sentences: list[dict[str, Any]],
) -> EnglishCourse | None:
    if task is None:
        return None
    title = derive_course_title(task.source_filename)
    course = EnglishCourse(
        title=title,
        original_filename=task.source_filename or source_path.name,
        media_filename="",
        media_relative_path="",
        media_mime_type=source_mime_type or guess_media_type(task.source_filename),
        file_size=max(0, int(file_size)),
        duration_seconds=max(0, int(duration_seconds)),
        sentence_count=len(sentences),
    )
    session.add(course)
    session.flush()

    target_course_dir = course_dir(course.id)
    target_course_dir.mkdir(parents=True, exist_ok=True)
    media_filename = f"source{source_path.suffix or '.mp4'}"
    target_media_path = target_course_dir / media_filename
    shutil.move(str(source_path), str(target_media_path))
    course.media_filename = media_filename
    course.media_relative_path = f"{target_course_dir.name}/{media_filename}"

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
    move_generation_log_to_course(task_id=task_id, course_id=course.id)
    return course


def serialize_course_summary(course: EnglishCourse) -> dict[str, Any]:
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


def serialize_progress(progress: EnglishCourseProgress, *, sentence_count: int) -> dict[str, Any]:
    completed_indexes = normalize_completed_indexes(
        json.loads(progress.completed_sentence_indexes_json or "[]"),
        sentence_count=sentence_count,
    )
    return {
        "currentSentenceIndex": int(progress.current_sentence_index or 0),
        "completedSentenceIndexes": completed_indexes,
        "completed": bool(progress.is_completed),
        "updatedAt": progress.updated_at.isoformat() if progress.updated_at else None,
    }


def serialize_sentence(sentence: EnglishSentence) -> dict[str, Any]:
    return {
        "id": sentence.id,
        "index": int(sentence.sentence_index or 0),
        "textEn": sentence.text_en or "",
        "textZh": sentence.text_zh or "",
        "startMs": int(sentence.start_ms or 0),
        "endMs": int(sentence.end_ms or 0),
        "tokens": json.loads(sentence.tokens_json or "[]"),
    }


def repair_course_duration_if_needed(session: Session, course: EnglishCourse) -> EnglishCourse:
    duration_seconds = int(course.duration_seconds or 0)
    if 0 < duration_seconds <= MAX_REASONABLE_MEDIA_DURATION_SECONDS:
        return course

    try:
        media_path = resolve_course_media_path(course)
    except EnglishCourseError:
        return course

    repaired_duration_seconds = probe_media_duration_seconds(media_path)
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


def ensure_progress_row(session: Session, course: EnglishCourse) -> EnglishCourseProgress:
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


def normalize_completed_indexes(values: list[Any], *, sentence_count: int) -> list[int]:
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


def derive_course_title(filename: str) -> str:
    stem = Path(filename or "").stem.strip()
    if not stem:
        return "未命名英语课程"
    return stem.replace("_", " ").strip() or "未命名英语课程"


def guess_media_type(filename: str) -> str:
    guessed = mimetypes.guess_type(filename or "")[0]
    return guessed or "video/mp4"
