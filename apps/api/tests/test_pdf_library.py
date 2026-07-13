from __future__ import annotations

import fitz
import pytest

from memory_anki.infrastructure.db._tables.misc import PdfDocument
from memory_anki.modules.pdf_library.application import (
    PdfLibraryError,
    delete_pdf_document,
    list_pdf_documents,
    save_pdf_document,
)
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork


def _pdf_bytes(page_count: int = 2) -> bytes:
    document = fitz.open()
    for page_number in range(page_count):
        page = document.new_page()
        page.insert_text((72, 72), f"page {page_number + 1}")
    content = document.tobytes()
    document.close()
    return content


def test_pdf_library_saves_lists_and_deletes_persistent_file(db_session, tmp_path):
    document = save_pdf_document(
        db_session,
        original_name="课程资料.pdf",
        mime_type="application/pdf",
        content=_pdf_bytes(3),
        library_dir=tmp_path,
        uow=SqlAlchemyUnitOfWork(db_session),
    )

    assert document.page_count == 3
    assert (tmp_path / document.filename).read_bytes().startswith(b"%PDF-")
    assert [item.id for item in list_pdf_documents(db_session)] == [document.id]

    assert delete_pdf_document(
        db_session,
        document.id,
        tmp_path,
        uow=SqlAlchemyUnitOfWork(db_session),
    ) is True
    assert db_session.query(PdfDocument).filter_by(id=document.id).first() is None
    assert not (tmp_path / document.filename).exists()


def test_pdf_library_rejects_invalid_pdf(db_session, tmp_path):
    with pytest.raises(PdfLibraryError, match="有效的 PDF"):
        save_pdf_document(
            db_session,
            original_name="fake.pdf",
            mime_type="application/pdf",
            content=b"not-a-pdf",
            library_dir=tmp_path,
            uow=SqlAlchemyUnitOfWork(db_session),
        )


def test_pdf_delete_restores_file_when_commit_fails(db_session, tmp_path):
    document = save_pdf_document(
        db_session,
        original_name="rollback.pdf",
        mime_type="application/pdf",
        content=_pdf_bytes(),
        library_dir=tmp_path,
        uow=SqlAlchemyUnitOfWork(db_session),
    )
    original_path = tmp_path / document.filename

    class FailingUnitOfWork:
        def commit(self):
            raise RuntimeError("commit failed")

        def rollback(self):
            db_session.rollback()

    with pytest.raises(RuntimeError, match="commit failed"):
        delete_pdf_document(
            db_session,
            document.id,
            tmp_path,
            uow=FailingUnitOfWork(),
        )

    assert original_path.exists()
    assert db_session.query(PdfDocument).filter_by(id=document.id).one().original_name == "rollback.pdf"
