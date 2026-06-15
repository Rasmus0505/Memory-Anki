from __future__ import annotations

import uuid
from pathlib import Path

import fitz
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db.models import Subject, SubjectDocument

PDF_MIME_TYPES = {"application/pdf", "application/x-pdf"}
THUMBNAIL_WIDTH = 220
PREVIEW_WIDTH = 1100


def subject_document_json(document: SubjectDocument, *, subject_id: int | None = None) -> dict:
    resolved_subject_id = subject_id if subject_id is not None else document.subject_id
    return {
        "id": document.id,
        "subject_id": resolved_subject_id,
        "filename": document.filename,
        "original_name": document.original_name,
        "mime_type": document.mime_type,
        "file_size": document.file_size,
        "page_count": document.page_count,
        "created_at": document.created_at.isoformat() if document.created_at else None,
    }


def subject_document_path(document: SubjectDocument) -> Path:
    return ATTACHMENTS_DIR / document.filename


def list_subject_documents(session: Session, subject_id: int) -> list[SubjectDocument]:
    return (
        session.query(SubjectDocument)
        .filter_by(subject_id=subject_id)
        .order_by(SubjectDocument.created_at.desc(), SubjectDocument.id.desc())
        .all()
    )


def get_subject_document(
    session: Session,
    *,
    subject_id: int,
    document_id: int,
) -> SubjectDocument | None:
    return (
        session.query(SubjectDocument)
        .filter_by(id=document_id, subject_id=subject_id)
        .first()
    )


def get_subject_document_by_id(session: Session, document_id: int) -> SubjectDocument | None:
    return session.query(SubjectDocument).filter_by(id=document_id).first()


def save_subject_document(
    session: Session,
    *,
    subject: Subject,
    original_name: str,
    mime_type: str,
    content: bytes,
) -> SubjectDocument:
    _ensure_pdf_upload(original_name=original_name, mime_type=mime_type, content=content)
    page_count = count_pdf_pages_from_bytes(content)
    relative_path = _build_subject_document_relative_path(subject.id, original_name)
    target_path = ATTACHMENTS_DIR / relative_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(content)
    document = SubjectDocument(
        subject_id=subject.id,
        filename=relative_path.as_posix(),
        original_name=original_name or "document.pdf",
        mime_type="application/pdf",
        file_size=len(content),
        page_count=page_count,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def delete_subject_document(session: Session, document: SubjectDocument) -> None:
    path = subject_document_path(document)
    if path.exists():
        path.unlink()
    session.delete(document)
    session.commit()


def count_pdf_pages_from_bytes(content: bytes) -> int:
    with fitz.open(stream=content, filetype="pdf") as document:
        return document.page_count


def build_page_summaries(
    *,
    subject_id: int,
    document: SubjectDocument,
) -> list[dict]:
    return [
        {
            "page_number": page_number,
            "thumbnail_url": (
                f"/api/v1/subjects/{subject_id}/documents/{document.id}/pages/"
                f"{page_number}/image?kind=thumbnail"
            ),
            "preview_url": (
                f"/api/v1/subjects/{subject_id}/documents/{document.id}/pages/"
                f"{page_number}/image?kind=preview"
            ),
        }
        for page_number in range(1, max(document.page_count, 0) + 1)
    ]


def render_subject_document_page(
    document: SubjectDocument,
    *,
    page_number: int,
    kind: str = "thumbnail",
) -> bytes:
    path = subject_document_path(document)
    if not path.exists():
        raise FileNotFoundError("资料文件不存在。")
    if page_number < 1 or page_number > max(document.page_count, 0):
        raise ValueError("页码超出范围。")

    target_width = PREVIEW_WIDTH if kind == "preview" else THUMBNAIL_WIDTH
    with fitz.open(path) as pdf_document:
        page = pdf_document.load_page(page_number - 1)
        width = max(page.rect.width, 1)
        scale = target_width / width
        matrix = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        return pix.tobytes("png")


def render_selected_pdf_pages(
    document: SubjectDocument,
    *,
    page_numbers: list[int],
    kind: str = "preview",
) -> list[tuple[int, bytes, str]]:
    unique_pages = sorted(set(page_numbers))
    if not unique_pages:
        raise ValueError("请至少选择一页 PDF。")
    return [
        (
            page_number,
            render_subject_document_page(document, page_number=page_number, kind=kind),
            f"page-{page_number}.png",
        )
        for page_number in unique_pages
    ]


def _ensure_pdf_upload(*, original_name: str, mime_type: str, content: bytes) -> None:
    extension = Path(original_name or "").suffix.lower()
    if extension != ".pdf" and mime_type not in PDF_MIME_TYPES:
        raise ValueError("仅支持上传 PDF 文件。")
    if not content:
        raise ValueError("未读取到 PDF 内容。")


def _build_subject_document_relative_path(subject_id: int, original_name: str) -> Path:
    extension = Path(original_name or "").suffix.lower() or ".pdf"
    safe_extension = extension if extension == ".pdf" else ".pdf"
    unique_name = f"{uuid.uuid4().hex}{safe_extension}"
    return Path("subjects") / str(subject_id) / unique_name
