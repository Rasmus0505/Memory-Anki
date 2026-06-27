"""Repository encapsulating Palace + Peg persistence.

Wraps the SQLAlchemy ``session.query(Palace)`` / ``session.query(Peg)``
calls previously scattered across ``palace_service``. The service now goes
through this object so ORM details stay in infrastructure while the service
expresses intent (list / get / add / delete / sync-pegs).
"""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload, selectinload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceMiniPalace, PalaceSegment, Peg


def _catalog_loader_options():
    return (
        joinedload(Palace.primary_chapter).joinedload(Chapter.parent),
        joinedload(Palace.primary_chapter).joinedload(Chapter.subject),
        selectinload(Palace.chapters).joinedload(Chapter.subject),
        selectinload(Palace.chapters).joinedload(Chapter.parent),
        selectinload(Palace.review_schedules),
        selectinload(Palace.review_logs),
        selectinload(Palace.segments).selectinload(PalaceSegment.review_schedules),
        selectinload(Palace.segments).selectinload(PalaceSegment.review_logs),
        selectinload(Palace.mini_palaces).selectinload(PalaceMiniPalace.review_schedules),
        selectinload(Palace.mini_palaces).selectinload(PalaceMiniPalace.review_logs),
    )


def _detail_loader_options():
    return (
        *_catalog_loader_options(),
        selectinload(Palace.attachments),
        selectinload(Palace.pegs),
    )


class PalaceRepository:
    """Palace and Peg persistence gateway."""

    def __init__(self, session: Session) -> None:
        self._session = session

    # ---- Palace reads ----

    def list_palaces(self, *, search: str = "") -> list[Palace]:
        query = self._session.query(Palace).options(*_detail_loader_options())
        if search:
            query = query.filter(Palace.title.ilike(f"%{search}%"))
        return query.order_by(Palace.updated_at.desc()).all()

    def list_catalog_palaces(self, *, search: str = "") -> list[Palace]:
        query = self._session.query(Palace).options(*_catalog_loader_options())
        if search:
            query = query.filter(Palace.title.ilike(f"%{search}%"))
        return query.order_by(Palace.updated_at.desc()).all()

    def get_palace(self, palace_id: int) -> Palace | None:
        return (
            self._session.query(Palace)
            .options(*_detail_loader_options())
            .filter_by(id=palace_id)
            .first()
        )

    def list_palaces_by_primary_chapter(self, chapter_id: int) -> list[Palace]:
        return (
            self._session.query(Palace)
            .filter_by(primary_chapter_id=chapter_id)
            .all()
        )

    # ---- Palace writes ----

    def add(self, palace: Palace) -> None:
        self._session.add(palace)

    def delete(self, palace: Palace) -> None:
        self._session.delete(palace)

    def restore_archived(self) -> int:
        """Un-archive every archived palace and return how many were restored."""
        return (
            self._session.query(Palace)
            .filter(Palace.archived == True)  # noqa: E712
            .update({Palace.archived: False}, synchronize_session=False)
        )

    # ---- Peg reads / writes ----

    def list_pegs(self, palace_id: int, *, parent_id: int | None) -> list[Peg]:
        return (
            self._session.query(Peg)
            .filter_by(palace_id=palace_id, parent_id=parent_id)
            .all()
        )

    def get_peg(self, peg_id: int) -> Peg | None:
        return self._session.query(Peg).filter_by(id=peg_id).first()

    def add_peg(self, peg: Peg) -> None:
        self._session.add(peg)

    def delete_peg(self, peg: Peg) -> None:
        self._session.delete(peg)

    # ---- Unit-of-work primitives ----

    def flush(self) -> None:
        self._session.flush()

    def commit(self) -> None:
        self._session.commit()

    def refresh(self, palace: Palace) -> None:
        self._session.refresh(palace)
