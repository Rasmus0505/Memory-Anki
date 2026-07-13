from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import PdfDocument
from memory_anki.platform.application import UnitOfWork


class PdfLibraryError(ValueError):
    pass


@dataclass(frozen=True)
class PdfDownload:
    path: Path
    original_name: str


def serialize_pdf_document(document: PdfDocument) -> dict[str, object]:
    return {
        "id": document.id,
        "original_name": document.original_name,
        "mime_type": document.mime_type,
        "file_size": document.file_size,
        "page_count": document.page_count,
        "created_at": document.created_at.isoformat() if document.created_at else None,
    }


def list_pdf_documents(session: Session) -> list[PdfDocument]:
    return session.query(PdfDocument).order_by(PdfDocument.created_at.desc(), PdfDocument.id.desc()).all()


def get_pdf_document(session: Session, document_id: str) -> PdfDocument | None:
    return session.query(PdfDocument).filter_by(id=document_id).first()


def resolve_pdf_path(document: PdfDocument, library_dir: Path) -> Path:
    return library_dir / document.filename


def save_pdf_document(
    session: Session,
    *,
    original_name: str,
    mime_type: str,
    content: bytes,
    library_dir: Path,
    uow: UnitOfWork,
) -> PdfDocument:
    if not content.startswith(b"%PDF-"):
        raise PdfLibraryError("请选择有效的 PDF 文件。")
    try:
        with fitz.open(stream=content, filetype="pdf") as pdf:
            page_count = pdf.page_count
    except Exception as exc:
        raise PdfLibraryError("PDF 文件损坏或无法读取。") from exc
    if page_count <= 0:
        raise PdfLibraryError("PDF 文件不包含可识别页面。")

    document_id = uuid.uuid4().hex
    filename = f"{document_id}.pdf"
    library_dir.mkdir(parents=True, exist_ok=True)
    temporary_path = library_dir / f".{filename}.uploading"
    target_path = library_dir / filename
    temporary_path.write_bytes(content)
    temporary_path.replace(target_path)
    document = PdfDocument(
        id=document_id,
        filename=filename,
        original_name=Path(original_name or "document.pdf").name,
        mime_type=mime_type if mime_type in {"application/pdf", "application/x-pdf"} else "application/pdf",
        file_size=len(content),
        page_count=page_count,
    )
    try:
        session.add(document)
        uow.commit()
        uow.refresh(document)
    except Exception:
        uow.rollback()
        target_path.unlink(missing_ok=True)
        raise
    return document


def resolve_pdf_download(session: Session, document_id: str, library_dir: Path) -> PdfDownload | None:
    document = get_pdf_document(session, document_id)
    if document is None:
        return None
    path = resolve_pdf_path(document, library_dir)
    if not path.exists():
        raise FileNotFoundError(path)
    return PdfDownload(path=path, original_name=document.original_name)


def delete_pdf_document(
    session: Session,
    document_id: str,
    library_dir: Path,
    *,
    uow: UnitOfWork,
) -> bool:
    document = get_pdf_document(session, document_id)
    if document is None:
        return False
    path = resolve_pdf_path(document, library_dir)
    quarantine = library_dir / f".{document.filename}.deleting-{uuid.uuid4().hex}"
    moved = path.exists()
    if moved:
        path.replace(quarantine)
    try:
        session.delete(document)
        uow.commit()
    except Exception:
        uow.rollback()
        if moved and quarantine.exists():
            quarantine.replace(path)
        raise
    quarantine.unlink(missing_ok=True)
    return True
