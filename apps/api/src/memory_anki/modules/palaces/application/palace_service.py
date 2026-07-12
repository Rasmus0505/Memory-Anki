"""Palace CRUD services.

Persistence is delegated to ``PalaceRepository`` so this module no longer
issues raw ``session.query(...)`` against the ORM. The public function
signatures are unchanged (the repository is constructed internally from the
session to keep call sites stable).
"""

from collections.abc import Callable

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate, PegIn
from memory_anki.modules.palaces.infrastructure.repositories import PalaceRepository
from memory_anki.platform.application import UnitOfWork


def _repo(session: Session) -> PalaceRepository:
    return PalaceRepository(session)


def list_palaces(
    session: Session,
    search: str = "",
    *,
    limit: int | None = None,
    offset: int = 0,
):
    return _repo(session).list_palaces(search=search, limit=limit, offset=offset)


def count_palaces(session: Session, search: str = "") -> int:
    return _repo(session).count_palaces(search=search)


def list_catalog_palaces(session: Session, search: str = ""):
    return _repo(session).list_catalog_palaces(search=search)


def list_deleted_palaces(session: Session) -> list[Palace]:
    return _repo(session).list_deleted_palaces()


def list_palaces_by_subject(session: Session, subject_id: int | None, search: str = ""):
    palaces = list_palaces(session, search)
    if subject_id is None:
        return palaces

    filtered: list[Palace] = []
    for palace in palaces:
        chapters = list(getattr(palace, "chapters", []) or [])
        if any(getattr(chapter, "subject_id", None) == subject_id for chapter in chapters):
            filtered.append(palace)
    return filtered


def list_catalog_palaces_by_subject(session: Session, subject_id: int | None, search: str = ""):
    palaces = list_catalog_palaces(session, search)
    if subject_id is None:
        return palaces
    filtered: list[Palace] = []
    for palace in palaces:
        chapters = list(getattr(palace, "chapters", []) or [])
        if any(chapter.subject_id == subject_id for chapter in chapters):
            filtered.append(palace)
    return filtered


def get_palace(session: Session, palace_id: int) -> Palace | None:
    return _repo(session).get_palace(palace_id)


def create_palace(
    session: Session,
    data: PalaceCreate,
    *,
    uow: UnitOfWork,
    before_commit: Callable[[Palace], None] | None = None,
) -> Palace:
    repo = _repo(session)
    palace = Palace(
        title=data.title,
        description=data.description,
        difficulty=0,
        review_mode="review",
        created_at=None,
    )
    repo.add(palace)
    repo.flush()
    _sync_pegs(session, palace, data.pegs)
    if before_commit is not None:
        before_commit(palace)
    uow.commit()
    uow.refresh(palace)
    return palace


def update_palace(
    session: Session,
    palace: Palace,
    data: PalaceUpdate,
    *,
    uow: UnitOfWork,
) -> Palace:
    if data.title is not None:
        palace.title = data.title
    if data.description is not None:
        palace.description = data.description
    if data.created_at is not None:
        palace.created_at = data.created_at
    if data.pegs is not None:
        _sync_pegs(session, palace, data.pegs)
    if data.title is not None:
        from memory_anki.modules.palaces.application.editor_state_service import (
            sync_palace_editor_root,
        )

        sync_palace_editor_root(palace)
    uow.commit()
    uow.refresh(palace)
    return palace


def set_palace_archived(
    session: Session,
    palace: Palace,
    archived: bool,
    *,
    uow: UnitOfWork,
) -> Palace:
    palace.archived = archived
    uow.commit()
    uow.refresh(palace)
    return palace


def set_palace_practice_flag(
    session: Session,
    palace: Palace,
    needs_practice: bool,
    *,
    uow: UnitOfWork,
) -> Palace:
    palace.needs_practice = needs_practice
    uow.commit()
    uow.refresh(palace)
    return palace


def delete_palace(
    session: Session,
    palace_id: int,
    *,
    uow: UnitOfWork,
) -> None:
    repo = _repo(session)
    palace = repo.get_palace(palace_id)
    if palace:
        palace.deleted_at = utc_now_naive()
        uow.commit()


def restore_deleted_palace(
    session: Session,
    palace_id: int,
    *,
    uow: UnitOfWork,
) -> Palace | None:
    repo = _repo(session)
    palace = repo.get_any_palace(palace_id)
    if palace is None or palace.deleted_at is None:
        return None
    palace.deleted_at = None
    uow.commit()
    uow.refresh(palace)
    return palace


def _sync_pegs(
    session: Session,
    palace: Palace,
    pegs_in: list[PegIn],
    parent_id: int | None = None,
) -> None:
    repo = _repo(session)
    existing = repo.list_pegs(palace.id, parent_id=parent_id)
    existing_ids = {peg.id for peg in existing}
    incoming_ids = {peg.id for peg in pegs_in if peg.id}

    for peg in existing:
        if peg.id not in incoming_ids:
            _delete_peg_cascade(session, peg)

    for index, peg_in in enumerate(pegs_in):
        if peg_in.id and peg_in.id in existing_ids:
            existing_peg = repo.get_peg(peg_in.id)
            if existing_peg is None:
                continue
            existing_peg.name = peg_in.name
            existing_peg.content = peg_in.content
            existing_peg.sort_order = index
            existing_peg.parent_id = parent_id
            peg = existing_peg
        else:
            peg = Peg(
                palace_id=palace.id,
                parent_id=parent_id,
                name=peg_in.name,
                content=peg_in.content,
                sort_order=index,
            )
            repo.add_peg(peg)
            repo.flush()
        if peg_in.children:
            _sync_pegs(session, palace, peg_in.children, peg.id)

    repo.flush()


def _delete_peg_cascade(session: Session, peg: Peg) -> None:
    repo = _repo(session)
    for child in peg.children:
        _delete_peg_cascade(session, child)
    repo.delete_peg(peg)
