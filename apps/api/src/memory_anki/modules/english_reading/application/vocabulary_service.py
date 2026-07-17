"""Vocabulary notebook with FSRS scheduling (same model as palace nodes)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fsrs import Card, Rating, State
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
from memory_anki.modules.reviews.api import (
    RATING_LABELS,
    VALID_RATINGS,
    build_scheduler,
    load_fsrs_settings,
    normalize_rating,
)

from . import service as _svc

VOCABULARY_REVIEW_RESULTS = {"forgot", "hard", "good", "easy", *{str(i) for i in VALID_RATINGS}}


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
    if is_new or row.due_at is None:
        _init_fsrs_card(session, row)
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
            EnglishReadingVocabularyNote.due_at.asc(),
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
    result: str | int | None = None,
    rating: int | str | None = None,
) -> dict[str, Any]:
    row = session.get(EnglishReadingVocabularyNote, note_id)
    if row is None or row.status != "active":
        raise EnglishReadingError("词汇笔记不存在。")
    raw = rating if rating is not None else result
    try:
        grade = normalize_rating(raw if raw is not None else 3)
    except ValueError as exc:
        raise EnglishReadingError("复习评分仅支持 1-4 或 forgot/hard/good/easy。") from exc

    now = utc_now_naive()
    row.review_count = int(row.review_count or 0) + 1
    if grade == 1:
        row.incorrect_count = int(row.incorrect_count or 0) + 1
    else:
        row.correct_count = int(row.correct_count or 0) + 1
    row.last_reviewed_at = now
    row.updated_at = now
    _apply_fsrs_rating(session, row, grade, now=now)
    session.commit()
    session.refresh(row)
    return serialize_vocabulary_note(row, now=now)


def serialize_vocabulary_note(
    row: EnglishReadingVocabularyNote,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or utc_now_naive()
    due_at = row.due_at or row.next_due_at
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
        "nextDueDate": (
            (due_at.date().isoformat() if due_at else None)
            or (row.next_due_date.isoformat() if row.next_due_date else None)
        ),
        "nextDueAt": due_at.isoformat() if due_at else None,
        "intervalDays": int(row.interval_days or 0),
        "reviewType": "fsrs",
        "algorithmUsed": "FSRS",
        "anchorDate": row.anchor_date.isoformat() if row.anchor_date else None,
        "lastReviewedAt": row.last_reviewed_at.isoformat() if row.last_reviewed_at else None,
        "stability": row.stability,
        "difficulty": row.difficulty,
        "state": int(row.fsrs_state or 1),
        "desiredRetention": float(row.desired_retention or 0.9),
        "ratingLabels": RATING_LABELS,
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


def _init_fsrs_card(session: Session, row: EnglishReadingVocabularyNote) -> None:
    settings = load_fsrs_settings(session)
    now = utc_now_naive()
    row.fsrs_state = int(State.Learning)
    row.fsrs_step = 0
    row.stability = None
    row.difficulty = None
    row.due_at = now
    row.next_due_at = now
    row.next_due_date = now.date()
    row.last_review_at = None
    row.desired_retention = float(settings["desired_retention"])
    row.maximum_interval = int(settings["maximum_interval"])
    row.scheduler_version = "fsrs-6.3.1"
    row.algorithm_used = "FSRS"
    row.review_type = "fsrs"
    row.interval_days = 0
    row.review_number = 0
    row.anchor_date = now.date()


def _card_from_row(row: EnglishReadingVocabularyNote) -> Card:
    due = row.due_at or row.next_due_at or utc_now_naive()
    if due.tzinfo is None:
        due_aware = due.replace(tzinfo=UTC)
    else:
        due_aware = due.astimezone(UTC)
    last = row.last_review_at or row.last_reviewed_at
    last_aware = None
    if last is not None:
        last_aware = last.replace(tzinfo=UTC) if last.tzinfo is None else last.astimezone(UTC)
    return Card(
        card_id=int(row.id or 0),
        state=State(int(row.fsrs_state or 1)),
        step=row.fsrs_step,
        stability=row.stability,
        difficulty=row.difficulty,
        due=due_aware,
        last_review=last_aware,
    )


def _apply_fsrs_rating(
    session: Session,
    row: EnglishReadingVocabularyNote,
    rating: int,
    *,
    now: datetime,
) -> None:
    settings = load_fsrs_settings(session)
    scheduler = build_scheduler(session)
    if row.due_at is None and row.next_due_at is None:
        _init_fsrs_card(session, row)
    card = _card_from_row(row)
    review_dt = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    card, _log = scheduler.review_card(card, Rating(rating), review_datetime=review_dt)
    row.fsrs_state = int(card.state)
    row.fsrs_step = card.step
    row.stability = card.stability
    row.difficulty = card.difficulty
    due_naive = (
        card.due.astimezone(UTC).replace(tzinfo=None)
        if card.due.tzinfo
        else card.due
    )
    last_naive = None
    if card.last_review is not None:
        last_naive = (
            card.last_review.astimezone(UTC).replace(tzinfo=None)
            if card.last_review.tzinfo
            else card.last_review
        )
    row.due_at = due_naive
    row.next_due_at = due_naive
    row.next_due_date = due_naive.date() if due_naive else None
    row.last_review_at = last_naive
    row.last_reviewed_at = last_naive or now
    row.desired_retention = float(settings["desired_retention"])
    row.maximum_interval = int(settings["maximum_interval"])
    row.scheduler_version = "fsrs-6.3.1"
    row.algorithm_used = "FSRS"
    row.review_type = "fsrs"
    if last_naive and due_naive:
        row.interval_days = max(0, (due_naive.date() - last_naive.date()).days)
    row.review_number = int(row.review_number or 0) + 1


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
        EnglishReadingVocabularyNote.due_at <= now,
        (
            EnglishReadingVocabularyNote.due_at.is_(None)
            & (EnglishReadingVocabularyNote.next_due_at <= now)
        ),
        (
            EnglishReadingVocabularyNote.due_at.is_(None)
            & EnglishReadingVocabularyNote.next_due_at.is_(None)
            & (EnglishReadingVocabularyNote.next_due_date <= now.date())
        ),
    )


def _is_note_due(row: EnglishReadingVocabularyNote, now: datetime) -> bool:
    if row.status != "active":
        return False
    if row.due_at is not None:
        return row.due_at <= now
    if row.next_due_at is not None:
        return row.next_due_at <= now
    if row.next_due_date is not None:
        return row.next_due_date <= now.date()
    return True
