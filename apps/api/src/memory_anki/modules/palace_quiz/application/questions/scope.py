from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import PalaceMiniPalace, PalaceQuizQuestion

from ..question_contracts import PalaceQuizNotFoundError, PalaceQuizValidationError
from ..question_scope_ids import normalize_optional_int


def get_chapter_or_raise(session: Session, chapter_id: int) -> Chapter:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    if not chapter:
        raise PalaceQuizNotFoundError("章节不存在。")
    return chapter


def get_mini_palace_or_raise(
    session: Session,
    palace_id: int,
    mini_palace_id: int,
) -> PalaceMiniPalace:
    mini_palace = (
        session.query(PalaceMiniPalace)
        .filter_by(id=mini_palace_id, palace_id=palace_id)
        .first()
    )
    if not mini_palace:
        raise PalaceQuizValidationError("专项训练不存在，或不属于当前宫殿。")
    return mini_palace


def get_origin_question_or_raise(
    session: Session,
    *,
    palace_id: int,
    origin_question_id: int,
) -> PalaceQuizQuestion:
    origin_question = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id == origin_question_id,
            PalaceQuizQuestion.palace_id == palace_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .first()
    )
    if not origin_question:
        raise PalaceQuizValidationError("原始题目不存在，无法建立专项训练归类副本。")
    return origin_question


def _is_chapter_within_scope(
    chapter: Chapter,
    *,
    source_chapter_id: int,
) -> bool:
    current: Chapter | None = chapter
    while current is not None:
        if current.id == source_chapter_id:
            return True
        current = current.parent
    return False


def normalize_mini_palace_id(
    session: Session | None,
    palace_id: int | None,
    raw_value: Any,
) -> int | None:
    mini_palace_id = normalize_optional_int(raw_value)
    if mini_palace_id is None:
        return None
    if session is None or palace_id is None:
        return mini_palace_id
    get_mini_palace_or_raise(session, palace_id, mini_palace_id)
    return mini_palace_id


def normalize_origin_question_id(
    session: Session | None,
    palace_id: int | None,
    raw_value: Any,
) -> int | None:
    origin_question_id = normalize_optional_int(raw_value)
    if origin_question_id is None:
        return None
    if session is None or palace_id is None:
        return origin_question_id
    get_origin_question_or_raise(
        session,
        palace_id=palace_id,
        origin_question_id=origin_question_id,
    )
    return origin_question_id


def normalize_source_chapter_id(
    session: Session | None,
    raw_value: Any,
) -> int | None:
    source_chapter_id = normalize_optional_int(raw_value)
    if source_chapter_id is None or session is None:
        return source_chapter_id
    get_chapter_or_raise(session, source_chapter_id)
    return source_chapter_id


def normalize_classified_chapter_id(
    session: Session | None,
    source_chapter_id: int | None,
    raw_value: Any,
) -> int | None:
    classified_chapter_id = normalize_optional_int(raw_value)
    if classified_chapter_id is None or session is None:
        return classified_chapter_id
    chapter = get_chapter_or_raise(session, classified_chapter_id)
    if source_chapter_id is not None and not _is_chapter_within_scope(
        chapter,
        source_chapter_id=source_chapter_id,
    ):
        raise PalaceQuizValidationError("章节分类节点必须位于当前章节范围内。")
    return classified_chapter_id


def validate_mini_palace(session: Session, palace_id: int, mini_palace_id: int) -> None:
    get_mini_palace_or_raise(session, palace_id, mini_palace_id)


__all__ = [
    "get_chapter_or_raise",
    "get_mini_palace_or_raise",
    "get_origin_question_or_raise",
    "normalize_classified_chapter_id",
    "normalize_mini_palace_id",
    "normalize_origin_question_id",
    "normalize_source_chapter_id",
    "validate_mini_palace",
]
