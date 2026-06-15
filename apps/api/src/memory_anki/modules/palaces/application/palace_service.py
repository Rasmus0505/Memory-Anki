"""Palace CRUD services.

Persistence is delegated to ``PalaceRepository`` so this module no longer
issues raw ``session.query(...)`` against the ORM. The public function
signatures are unchanged (the repository is constructed internally from the
session to keep call sites stable).
"""

from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate, PegIn
from memory_anki.modules.palaces.infrastructure.repositories import PalaceRepository


def _repo(session: Session) -> PalaceRepository:
    return PalaceRepository(session)


def list_palaces(session: Session, search: str = ""):
    restore_archived_palaces(session)
    return _repo(session).list_palaces(search=search)


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


def restore_archived_palaces(session: Session) -> int:
    repo = _repo(session)
    restored = repo.restore_archived()
    if restored:
        repo.commit()
    return restored


def get_palace(session: Session, palace_id: int) -> Palace | None:
    restore_archived_palaces(session)
    return _repo(session).get_palace(palace_id)


def create_palace(session: Session, data: PalaceCreate) -> Palace:
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
    repo.commit()
    repo.refresh(palace)
    return palace


def update_palace(session: Session, palace: Palace, data: PalaceUpdate) -> Palace:
    if data.title is not None:
        palace.title = data.title
    if data.description is not None:
        palace.description = data.description
    if data.created_at is not None:
        palace.created_at = data.created_at
    if data.pegs is not None:
        _sync_pegs(session, palace, data.pegs)
    repo = _repo(session)
    repo.commit()
    repo.refresh(palace)
    return palace


def delete_palace(session: Session, palace_id: int) -> None:
    repo = _repo(session)
    palace = repo.get_palace(palace_id)
    if palace:
        for attachment in palace.attachments:
            filepath = ATTACHMENTS_DIR / attachment.filename
            if filepath.exists():
                filepath.unlink()
        repo.delete(palace)
        repo.commit()


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
