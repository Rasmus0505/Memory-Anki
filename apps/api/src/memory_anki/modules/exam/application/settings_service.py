"""Exam settings and star/share edits."""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace

from ..domain.stars import clamp_stars, normalize_source

EXAM_SETTINGS_KEY = "exam_settings"


class ExamNotFoundError(LookupError):
    pass


def _parse_date(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10]).isoformat()
    except ValueError as exc:
        raise ValueError("exam_date must be YYYY-MM-DD") from exc


def get_exam_settings(session: Session) -> dict[str, Any]:
    row = session.query(Config).filter(Config.key == EXAM_SETTINGS_KEY).one_or_none()
    payload: dict[str, Any] = {}
    if row is not None and row.value:
        try:
            loaded = json.loads(row.value)
            payload = loaded if isinstance(loaded, dict) else {}
        except json.JSONDecodeError:
            payload = {}
    subject_ids = [int(v) for v in payload.get("subject_ids") or [] if str(v).lstrip("-").isdigit()]
    return {
        "exam_name": str(payload.get("exam_name") or ""),
        "exam_date": payload.get("exam_date") or None,
        "subject_ids": [v for v in subject_ids if v > 0],
    }


def save_exam_settings(session: Session, data: dict[str, Any]) -> dict[str, Any]:
    current = get_exam_settings(session)
    if "exam_name" in data:
        current["exam_name"] = str(data.get("exam_name") or "").strip()[:80]
    if "exam_date" in data:
        current["exam_date"] = _parse_date(data.get("exam_date"))
    if "subject_ids" in data:
        ids = {int(v) for v in data.get("subject_ids") or [] if str(v).isdigit()}
        known = {sid for (sid,) in session.query(Subject.id).filter(Subject.id.in_(ids))} if ids else set()
        current["subject_ids"] = sorted(known)
    row = session.query(Config).filter(Config.key == EXAM_SETTINGS_KEY).one_or_none()
    value = json.dumps(current, ensure_ascii=False)
    if row is None:
        session.add(Config(key=EXAM_SETTINGS_KEY, value=value, updated_at=utc_now_naive()))
    else:
        row.value = value
        row.updated_at = utc_now_naive()
    session.commit()
    return current


def _apply_stars(entity: Chapter | Palace, data: dict[str, Any]) -> None:
    stars = clamp_stars(data.get("stars"))
    entity.exam_stars = stars
    entity.exam_stars_source = normalize_source(data.get("source")) if stars is not None else None


def set_chapter_stars(session: Session, chapter_id: int, data: dict[str, Any]) -> dict[str, Any]:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None:
        raise ExamNotFoundError(chapter_id)
    _apply_stars(chapter, data)
    session.commit()
    return {"id": chapter.id, "exam_stars": chapter.exam_stars, "exam_stars_source": chapter.exam_stars_source}


def set_palace_stars(session: Session, palace_id: int, data: dict[str, Any]) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if palace is None:
        raise ExamNotFoundError(palace_id)
    _apply_stars(palace, data)
    session.commit()
    return {"id": palace.id, "exam_stars": palace.exam_stars, "exam_stars_source": palace.exam_stars_source}


def set_subject_share(session: Session, subject_id: int, data: dict[str, Any]) -> dict[str, Any]:
    subject = session.get(Subject, subject_id)
    if subject is None:
        raise ExamNotFoundError(subject_id)
    raw = data.get("share")
    share: int | None
    if raw is None or raw == "":
        share = None
    else:
        share = max(0, min(100, int(float(raw))))
    subject.exam_share = share
    session.commit()
    return {"id": subject.id, "exam_share": subject.exam_share}
