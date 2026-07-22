"""Global search across palaces, pegs, quiz questions and chapters."""

from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    Peg,
)
from memory_anki.modules.content.public.queries import resolve_palace_title

PER_GROUP_LIMIT = 10
_LIKE_ESCAPE = "\\"


def _like_pattern(query: str) -> str:
    escaped = (
        query.replace(_LIKE_ESCAPE, _LIKE_ESCAPE + _LIKE_ESCAPE)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )
    return f"%{escaped}%"


def _snippet(text: str | None, query: str, radius: int = 30) -> str:
    content = (text or "").strip()
    if not content:
        return ""
    index = content.lower().find(query.lower())
    if index < 0:
        return content[: radius * 2]
    start = max(0, index - radius)
    end = min(len(content), index + len(query) + radius)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(content) else ""
    return f"{prefix}{content[start:end]}{suffix}"


def global_search(session: Session, query: str, limit: int = PER_GROUP_LIMIT) -> dict:
    query = (query or "").strip()
    if len(query) < 1:
        return {
            "query": query,
            "palaces": [],
            "pegs": [],
            "questions": [],
            "chapters": [],
        }
    limit = max(1, min(int(limit), 20))
    pattern = _like_pattern(query)

    palaces = (
        session.query(Palace)
        .filter(
            Palace.archived.is_(False),
            or_(
                Palace.title.like(pattern, escape=_LIKE_ESCAPE),
                Palace.manual_title.like(pattern, escape=_LIKE_ESCAPE),
                Palace.description.like(pattern, escape=_LIKE_ESCAPE),
            ),
        )
        .order_by(Palace.updated_at.desc(), Palace.id.desc())
        .limit(limit)
        .all()
    )

    pegs = (
        session.query(Peg)
        .options(joinedload(Peg.palace))
        .join(Palace, Peg.palace_id == Palace.id)
        .filter(
            Palace.archived.is_(False),
            or_(
                Peg.name.like(pattern, escape=_LIKE_ESCAPE),
                Peg.content.like(pattern, escape=_LIKE_ESCAPE),
            ),
        )
        .order_by(Peg.id.desc())
        .limit(limit)
        .all()
    )

    questions = (
        session.query(PalaceQuizQuestion)
        .options(joinedload(PalaceQuizQuestion.palace))
        .outerjoin(Palace, PalaceQuizQuestion.palace_id == Palace.id)
        .filter(
            PalaceQuizQuestion.stem.like(pattern, escape=_LIKE_ESCAPE),
            or_(
                PalaceQuizQuestion.palace_id.is_(None),
                Palace.archived.is_(False),
            ),
        )
        .order_by(PalaceQuizQuestion.updated_at.desc(), PalaceQuizQuestion.id.desc())
        .limit(limit)
        .all()
    )

    chapters = (
        session.query(Chapter)
        .options(joinedload(Chapter.subject))
        .filter(Chapter.name.like(pattern, escape=_LIKE_ESCAPE))
        .order_by(Chapter.sort_order, Chapter.id)
        .limit(limit)
        .all()
    )

    return {
        "query": query,
        "palaces": [
            {
                "id": palace.id,
                "title": resolve_palace_title(palace),
                "snippet": _snippet(palace.description, query),
            }
            for palace in palaces
        ],
        "pegs": [
            {
                "id": peg.id,
                "palace_id": peg.palace_id,
                "palace_title": resolve_palace_title(peg.palace) if peg.palace else "",
                "name": peg.name,
                "snippet": _snippet(peg.content or peg.name, query),
            }
            for peg in pegs
        ],
        "questions": [
            {
                "id": question.id,
                "palace_id": question.palace_id,
                "palace_title": resolve_palace_title(question.palace)
                if question.palace
                else "",
                "snippet": _snippet(question.stem, query),
            }
            for question in questions
        ],
        "chapters": [
            {
                "id": chapter.id,
                "name": chapter.name,
                "subject_name": chapter.subject.name if chapter.subject else "",
            }
            for chapter in chapters
        ],
    }
