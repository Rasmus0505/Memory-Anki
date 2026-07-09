"""Vocabulary notebook and lightweight review scheduling for English reading."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingDictionaryCache,
    EnglishReadingMaterial,
    EnglishReadingVersion,
    EnglishReadingVocabularyNote,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.reviews.application.schedule_policy import (
    build_review_schedule_draft,
    load_review_schedule_policy,
)

from . import service as _svc

VOCABULARY_REVIEW_RESULTS = {"forgot", "hard", "good", "easy"}


def create_vocabulary_note(
    session: Session,
    *,
    word: str,
    note: str = "",
    definition_zh: str = "",
    context: str = "",
    material_id: int | None = None,
    version_id: int | None = None,
    span_annotation_id: str = "",
    cefr: str | None = None,
) -> dict[str, Any]:
    safe_word = _normalize_vocabulary_word(word)
    normalized_surface = _svc.normalize_lookup_key(safe_word)
    material, version = _resolve_vocabulary_source(
        session,
        material_id=material_id,
        version_id=version_id,
    )
    row = (
        session.query(EnglishReadingVocabularyNote)
        .filter_by(normalized_surface=normalized_surface)
        .first()
    )
    is_new = row is None
    if row is None:
        row = EnglishReadingVocabularyNote(
            normalized_surface=normalized_surface,
            word=safe_word,
            lemma=normalized_surface,
        )
        session.add(row)
    row.word = safe_word
    row.lemma = normalized_surface
    row.note = _clean_text(note, limit=1200)
    row.definition_zh = _clean_text(definition_zh, limit=1200) or _dictionary_summary_zh(
        session,
        normalized_surface,
    )
    row.context = _clean_text(context, limit=2000)
    row.material_id = material.id if material is not None else None
    row.version_id = version.id if version is not None else None
    row.span_annotation_id = str(span_annotation_id or "").strip()[:80]
    row.cefr = _normalize_optional_cefr(cefr)
    row.status = "active"
    row.updated_at = utc_now_naive()
    if is_new or row.next_due_date is None:
        _assign_next_schedule(session, row, review_number=0, base_datetime=utc_now_naive())
    session.commit()
    session.refresh(row)
    return serialize_vocabulary_note(row)


def list_vocabulary_notes(
    session: Session,
    *,
    due_only: bool = False,
    limit: int = 50,
) -> dict[str, Any]:
    now = utc_now_naive()
    safe_limit = max(1, min(100, int(limit)))
    query = session.query(EnglishReadingVocabularyNote).filter(
        EnglishReadingVocabularyNote.status == "active"
    )
    if due_only:
        query = query.filter(_due_filter(now))
    rows = (
        query.order_by(
            EnglishReadingVocabularyNote.next_due_date.asc(),
            EnglishReadingVocabularyNote.next_due_at.asc(),
            EnglishReadingVocabularyNote.updated_at.desc(),
            EnglishReadingVocabularyNote.id.desc(),
        )
        .limit(safe_limit)
        .all()
    )
    due_count = (
        session.query(EnglishReadingVocabularyNote)
        .filter(
            EnglishReadingVocabularyNote.status == "active",
            _due_filter(now),
        )
        .count()
    )
    total = (
        session.query(EnglishReadingVocabularyNote)
        .filter(EnglishReadingVocabularyNote.status == "active")
        .count()
    )
    return {
        "items": [serialize_vocabulary_note(row, now=now) for row in rows],
        "dueCount": int(due_count),
        "total": int(total),
    }


def review_vocabulary_note(
    session: Session,
    *,
    note_id: int,
    result: str,
) -> dict[str, Any]:
    row = session.get(EnglishReadingVocabularyNote, note_id)
    if row is None or row.status != "active":
        raise EnglishReadingError("词汇笔记不存在。")
    safe_result = str(result or "good").strip().lower()
    if safe_result not in VOCABULARY_REVIEW_RESULTS:
        raise EnglishReadingError("复习结果仅支持 forgot、hard、good 或 easy。")

    now = utc_now_naive()
    row.review_count = int(row.review_count or 0) + 1
    if safe_result == "forgot":
        row.incorrect_count = int(row.incorrect_count or 0) + 1
        next_review_number = max(0, int(row.review_number or 0))
    elif safe_result == "hard":
        row.correct_count = int(row.correct_count or 0) + 1
        next_review_number = max(0, int(row.review_number or 0))
    else:
        row.correct_count = int(row.correct_count or 0) + 1
        step = 2 if safe_result == "easy" else 1
        next_review_number = max(0, int(row.review_number or 0) + step)
    row.last_reviewed_at = now
    row.updated_at = now
    _assign_next_schedule(session, row, review_number=next_review_number, base_datetime=now)
    session.commit()
    session.refresh(row)
    return serialize_vocabulary_note(row, now=now)


def serialize_vocabulary_note(
    row: EnglishReadingVocabularyNote,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or utc_now_naive()
    return {
        "id": row.id,
        "word": row.word,
        "normalizedSurface": row.normalized_surface,
        "lemma": row.lemma,
        "cefr": row.cefr or None,
        "note": row.note,
        "definitionZh": row.definition_zh,
        "context": row.context,
        "materialId": row.material_id,
        "versionId": row.version_id,
        "spanAnnotationId": row.span_annotation_id or None,
        "status": row.status,
        "reviewNumber": int(row.review_number or 0),
        "reviewCount": int(row.review_count or 0),
        "correctCount": int(row.correct_count or 0),
        "incorrectCount": int(row.incorrect_count or 0),
        "nextDueDate": row.next_due_date.isoformat() if row.next_due_date else None,
        "nextDueAt": row.next_due_at.isoformat() if row.next_due_at else None,
        "intervalDays": int(row.interval_days or 0),
        "reviewType": row.review_type,
        "algorithmUsed": row.algorithm_used,
        "anchorDate": row.anchor_date.isoformat() if row.anchor_date else None,
        "lastReviewedAt": row.last_reviewed_at.isoformat() if row.last_reviewed_at else None,
        "isDue": _is_note_due(row, current),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def _resolve_vocabulary_source(
    session: Session,
    *,
    material_id: int | None,
    version_id: int | None,
) -> tuple[EnglishReadingMaterial | None, EnglishReadingVersion | None]:
    material = None
    if material_id is not None:
        material = session.get(EnglishReadingMaterial, int(material_id))
        if material is None:
            raise EnglishReadingError("英语阅读材料不存在。")
    version = None
    if version_id is not None:
        version = session.get(EnglishReadingVersion, int(version_id))
        if version is None:
            raise EnglishReadingError("英语阅读版本不存在。")
        if material is not None and version.material_id != material.id:
            raise EnglishReadingError("词汇笔记的阅读版本不属于当前材料。")
        if material is None:
            material = version.material
    return material, version


def _assign_next_schedule(
    session: Session,
    row: EnglishReadingVocabularyNote,
    *,
    review_number: int,
    base_datetime: datetime,
) -> None:
    anchor_date = row.anchor_date or base_datetime.date()
    draft = build_review_schedule_draft(
        load_review_schedule_policy(session),
        review_number=review_number,
        base_date=base_datetime.date(),
        anchor_date=anchor_date,
        base_datetime=base_datetime,
    )
    row.review_number = max(0, int(review_number))
    row.anchor_date = anchor_date
    if draft is None:
        row.status = "mastered"
        row.next_due_date = None
        row.next_due_at = None
        return
    row.next_due_date = draft.scheduled_date
    row.next_due_at = draft.scheduled_at
    row.interval_days = draft.interval_days
    row.algorithm_used = draft.algorithm_used
    row.review_type = draft.review_type


def _normalize_vocabulary_word(word: str) -> str:
    safe_word = _svc.WHITESPACE_RE.sub(" ", str(word or "")).strip()
    if not safe_word or not _svc.ASCII_LETTER_RE.search(safe_word):
        raise EnglishReadingError("请提供要保存的英文单词或短语。")
    return safe_word[:240]


def _normalize_optional_cefr(cefr: str | None) -> str:
    if cefr is None or not str(cefr).strip():
        return ""
    return _svc.normalize_cefr_level(cefr)


def _clean_text(value: str | None, *, limit: int) -> str:
    return _svc.WHITESPACE_RE.sub(" ", str(value or "")).strip()[:limit]


def _dictionary_summary_zh(session: Session, normalized_surface: str) -> str:
    row = (
        session.query(EnglishReadingDictionaryCache)
        .filter_by(normalized_surface=normalized_surface)
        .first()
    )
    if row is None:
        return ""
    try:
        values = json.loads(row.summary_zh_json or "[]")
    except json.JSONDecodeError:
        return ""
    if not isinstance(values, list):
        return ""
    return "；".join(str(value).strip() for value in values if str(value).strip())[:1200]


def _due_filter(now: datetime):
    return or_(
        EnglishReadingVocabularyNote.next_due_at <= now,
        (
            EnglishReadingVocabularyNote.next_due_at.is_(None)
            & (EnglishReadingVocabularyNote.next_due_date <= now.date())
        ),
    )


def _is_note_due(row: EnglishReadingVocabularyNote, now: datetime) -> bool:
    if row.status != "active":
        return False
    if row.next_due_at is not None:
        return row.next_due_at <= now
    if row.next_due_date is not None:
        return row.next_due_date <= now.date()
    return False
