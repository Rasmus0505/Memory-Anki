"""Palace CRUD services."""

from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db.models import Palace, Peg
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate, PegIn


def list_palaces(session: Session, search: str = ""):
    restore_archived_palaces(session)
    query = session.query(Palace)
    if search:
        query = query.filter(Palace.title.ilike(f"%{search}%"))
    return query.order_by(Palace.updated_at.desc()).all()


def restore_archived_palaces(session: Session) -> int:
    restored = (
        session.query(Palace)
        .filter(Palace.archived == True)
        .update({Palace.archived: False}, synchronize_session=False)
    )
    if restored:
        session.commit()
    return restored


def get_palace(session: Session, palace_id: int) -> Palace | None:
    restore_archived_palaces(session)
    return session.query(Palace).filter_by(id=palace_id).first()


def create_palace(session: Session, data: PalaceCreate) -> Palace:
    palace = Palace(
        title=data.title,
        description=data.description,
        difficulty=0,
        review_mode="review",
        created_at=None,
    )
    session.add(palace)
    session.flush()
    _sync_pegs(session, palace, data.pegs)
    session.commit()
    session.refresh(palace)
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
    session.commit()
    session.refresh(palace)
    return palace


def delete_palace(session: Session, palace_id: int) -> None:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if palace:
        for attachment in palace.attachments:
            filepath = ATTACHMENTS_DIR / attachment.filename
            if filepath.exists():
                filepath.unlink()
        session.delete(palace)
        session.commit()


def _sync_pegs(
    session: Session,
    palace: Palace,
    pegs_in: list[PegIn],
    parent_id: int | None = None,
) -> None:
    existing = session.query(Peg).filter_by(palace_id=palace.id, parent_id=parent_id).all()
    existing_ids = {peg.id for peg in existing}
    incoming_ids = {peg.id for peg in pegs_in if peg.id}

    for peg in existing:
        if peg.id not in incoming_ids:
            _delete_peg_cascade(session, peg)

    for index, peg_in in enumerate(pegs_in):
        if peg_in.id and peg_in.id in existing_ids:
            existing_peg = session.query(Peg).filter_by(id=peg_in.id).first()
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
            session.add(peg)
            session.flush()
        if peg_in.children:
            _sync_pegs(session, palace, peg_in.children, peg.id)

    session.flush()


def _delete_peg_cascade(session: Session, peg: Peg) -> None:
    for child in peg.children:
        _delete_peg_cascade(session, child)
    session.delete(peg)
