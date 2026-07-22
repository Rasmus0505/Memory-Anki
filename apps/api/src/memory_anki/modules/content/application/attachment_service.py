from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Attachment
from memory_anki.platform.application import UnitOfWork

from .palace_service import get_palace


@dataclass(frozen=True)
class AttachmentDownload:
    path: Path
    original_name: str


def create_attachment(
    session: Session,
    *,
    palace_id: int,
    original_name: str,
    content: bytes,
    attachments_dir: Path,
    uow: UnitOfWork,
) -> Attachment | None:
    if get_palace(session, palace_id) is None:
        return None
    extension = Path(original_name).suffix
    unique_name = f"{uuid.uuid4().hex}{extension}"
    target = attachments_dir / unique_name
    target.write_bytes(content)
    attachment = Attachment(
        palace_id=palace_id,
        filename=unique_name,
        original_name=original_name,
        file_size=len(content),
    )
    try:
        session.add(attachment)
        uow.commit()
        uow.refresh(attachment)
    except Exception:
        uow.rollback()
        target.unlink(missing_ok=True)
        raise
    return attachment


def resolve_attachment_download(
    session: Session,
    attachment_id: int,
    attachments_dir: Path,
) -> AttachmentDownload | None:
    attachment = session.query(Attachment).filter_by(id=attachment_id).first()
    if attachment is None:
        return None
    path = attachments_dir / attachment.filename
    if not path.exists():
        raise FileNotFoundError(path)
    return AttachmentDownload(path=path, original_name=attachment.original_name)


def delete_attachment(
    session: Session,
    attachment_id: int,
    attachments_dir: Path,
    *,
    uow: UnitOfWork,
) -> bool:
    attachment = session.query(Attachment).filter_by(id=attachment_id).first()
    if attachment is None:
        return False
    path = attachments_dir / attachment.filename
    quarantine_path = attachments_dir / f".{attachment.filename}.deleting-{uuid.uuid4().hex}"
    file_was_quarantined = path.exists()
    if file_was_quarantined:
        path.replace(quarantine_path)
    try:
        session.delete(attachment)
        uow.commit()
    except Exception:
        uow.rollback()
        if file_was_quarantined and quarantine_path.exists():
            quarantine_path.replace(path)
        raise
    quarantine_path.unlink(missing_ok=True)
    return True
