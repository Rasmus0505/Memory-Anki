"""Question-owned quiz 已做. Refresh reads it; only an explicit clear removes it."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.quiz_practice import (
    QuizPracticeProgress,
    QuizPracticeProgressClear,
)

_ALL = "all"


def _stamp() -> str:
    return utc_now_naive().isoformat(timespec="milliseconds") + "Z"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _question_id(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def _palace_id(value: Any) -> int | None:
    parsed = _question_id(value)
    return parsed or None


def _clear_map(session: Session) -> dict[str, str]:
    return {
        row.scope_key: _text(row.cleared_at)
        for row in session.query(QuizPracticeProgressClear).all()
    }


def _blocked_at(clears: dict[str, str], *, question_id: int, palace_id: int | None) -> str:
    stamps = [_text(clears.get(_ALL))]
    if palace_id:
        stamps.append(_text(clears.get(f"palace:{palace_id}")))
    stamps.append(_text(clears.get(f"question:{question_id}")))
    return max(stamps)


def read_practice_progress(session: Session) -> dict[str, Any]:
    clears = _clear_map(session)
    items = []
    for row in session.query(QuizPracticeProgress).all():
        updated_at = _text(row.updated_at)
        if updated_at <= _blocked_at(clears, question_id=row.question_id, palace_id=row.palace_id):
            continue
        try:
            state = json.loads(row.state_json or "{}")
        except json.JSONDecodeError:
            state = {}
        if not isinstance(state, dict):
            state = {}
        items.append(
            {
                "question_id": row.question_id,
                "palace_id": row.palace_id,
                "state": state,
                "updated_at": updated_at,
            }
        )
    return {"items": items, "clears": _public_clears(clears)}


def _public_clears(clears: dict[str, str]) -> dict[str, Any]:
    palaces: dict[str, str] = {}
    questions: dict[str, str] = {}
    for key, stamp in clears.items():
        if key.startswith("palace:"):
            palaces[key.split(":", 1)[1]] = stamp
        elif key.startswith("question:"):
            questions[key.split(":", 1)[1]] = stamp
    return {"all": clears.get(_ALL) or None, "palaces": palaces, "questions": questions}


def upsert_practice_progress(session: Session, items: list[dict[str, Any]]) -> dict[str, Any]:
    clears = _clear_map(session)
    for raw in items:
        if not isinstance(raw, dict):
            continue
        question_id = _question_id(raw.get("question_id"))
        updated_at = _text(raw.get("updated_at")) or _stamp()
        palace_id = _palace_id(raw.get("palace_id"))
        if question_id <= 0 or updated_at <= _blocked_at(clears, question_id=question_id, palace_id=palace_id):
            continue
        state = raw.get("state")
        if not isinstance(state, dict):
            state = {}
        row = session.get(QuizPracticeProgress, question_id)
        if row is not None and _text(row.updated_at) >= updated_at:
            continue
        if row is None:
            row = QuizPracticeProgress(question_id=question_id)
            session.add(row)
        row.palace_id = palace_id if palace_id is not None else row.palace_id
        row.state_json = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        row.updated_at = updated_at
    session.commit()
    return read_practice_progress(session)


def _remember_clear(session: Session, scope_key: str, cleared_at: str) -> None:
    row = session.get(QuizPracticeProgressClear, scope_key)
    if row is None:
        session.add(QuizPracticeProgressClear(scope_key=scope_key, cleared_at=cleared_at))
        return
    if _text(row.cleared_at) < cleared_at:
        row.cleared_at = cleared_at


def clear_practice_progress(
    session: Session,
    *,
    clear_all: bool = False,
    palace_ids: list[int] | None = None,
    question_ids: list[int] | None = None,
    cleared_at: str | None = None,
) -> dict[str, Any]:
    stamp = _text(cleared_at) or _stamp()
    if clear_all:
        _remember_clear(session, _ALL, stamp)
        session.query(QuizPracticeProgress).filter(
            QuizPracticeProgress.updated_at <= stamp
        ).delete(synchronize_session=False)
    palace_set = {parsed for raw in palace_ids or [] if (parsed := _question_id(raw))}
    for palace_id in palace_set:
        _remember_clear(session, f"palace:{palace_id}", stamp)
    if palace_set:
        session.query(QuizPracticeProgress).filter(
            QuizPracticeProgress.palace_id.in_(palace_set),
            QuizPracticeProgress.updated_at <= stamp,
        ).delete(synchronize_session=False)
    question_set = {parsed for raw in question_ids or [] if (parsed := _question_id(raw))}
    for question_id in question_set:
        _remember_clear(session, f"question:{question_id}", stamp)
    if question_set:
        session.query(QuizPracticeProgress).filter(
            QuizPracticeProgress.question_id.in_(question_set),
            QuizPracticeProgress.updated_at <= stamp,
        ).delete(synchronize_session=False)
    session.commit()
    return read_practice_progress(session)
