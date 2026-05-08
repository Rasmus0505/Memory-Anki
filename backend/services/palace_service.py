"""宫殿 CRUD 服务"""
from sqlalchemy.orm import Session
from models import Palace, Peg
from schemas import PalaceCreate, PalaceUpdate, PegIn


def restore_archived_palaces(session: Session) -> int:
    restored = (
        session.query(Palace)
        .filter(Palace.archived == True)
        .update({Palace.archived: False}, synchronize_session=False)
    )
    if restored:
        session.commit()
    return restored


def list_palaces(session: Session, search: str = ""):
    restore_archived_palaces(session)
    q = session.query(Palace)
    if search:
        q = q.filter(Palace.title.ilike(f"%{search}%"))
    return q.order_by(Palace.updated_at.desc()).all()


def get_palace(session: Session, palace_id: int) -> Palace | None:
    restore_archived_palaces(session)
    return session.query(Palace).filter_by(id=palace_id).first()


def create_palace(session: Session, data: PalaceCreate) -> Palace:
    palace = Palace(
        title=data.title, description=data.description,
        difficulty=0, review_mode="review",
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


def delete_palace(session: Session, palace_id: int):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if palace:
        import os
        from config import ATTACHMENTS_DIR
        for att in palace.attachments:
            filepath = ATTACHMENTS_DIR / att.filename
            if filepath.exists():
                os.remove(filepath)
        session.delete(palace)
        session.commit()


def _sync_pegs(session: Session, palace: Palace, pegs_in: list[PegIn], parent_id: int | None = None):
    """递归同步记忆桩"""
    # 获取当前层级的所有现存 peg
    existing = session.query(Peg).filter_by(palace_id=palace.id, parent_id=parent_id).all()
    existing_ids = {p.id for p in existing}
    incoming_ids = {p.id for p in pegs_in if p.id}

    # 删除不在 incoming 中的
    for peg in existing:
        if peg.id not in incoming_ids:
            _delete_peg_cascade(session, peg)

    # 创建/更新
    for i, p_in in enumerate(pegs_in):
        if p_in.id and p_in.id in existing_ids:
            peg = session.query(Peg).filter_by(id=p_in.id).first()
            if peg:
                peg.name = p_in.name
                peg.content = p_in.content
                peg.sort_order = i
                peg.parent_id = parent_id
        else:
            peg = Peg(
                palace_id=palace.id, parent_id=parent_id,
                name=p_in.name, content=p_in.content, sort_order=i,
            )
            session.add(peg)
            session.flush()  # 获取 peg.id
        # 递归处理子桩
        if p_in.children:
            _sync_pegs(session, palace, p_in.children, peg.id)

    session.flush()


def _delete_peg_cascade(session: Session, peg: Peg):
    """递归删除 peg 及其所有子孙"""
    for child in peg.children:
        _delete_peg_cascade(session, child)
    session.delete(peg)
