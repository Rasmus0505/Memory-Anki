from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.core.config import PDF_LIBRARY_DIR
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

from ..application import (
    PdfLibraryError,
    delete_pdf_document,
    get_pdf_document,
    get_pdf_ocr_coverage,
    list_pdf_documents,
    resolve_pdf_download,
    save_pdf_document,
    serialize_pdf_document,
)

router = APIRouter(prefix="/pdf-library", tags=["pdf-library"])


@router.get("")
def api_list_pdf_documents(session: Session = Depends(session_dep)):
    return {"items": [serialize_pdf_document(item) for item in list_pdf_documents(session)]}


@router.post("")
async def api_upload_pdf_document(file: UploadFile = File(...), session: Session = Depends(session_dep)):
    try:
        document = save_pdf_document(
            session,
            original_name=file.filename or "document.pdf",
            mime_type=file.content_type or "application/pdf",
            content=await file.read(),
            library_dir=PDF_LIBRARY_DIR,
            uow=SqlAlchemyUnitOfWork(session),
        )
    except PdfLibraryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_pdf_document(document)


@router.get("/{document_id}/ocr-coverage")
def api_pdf_ocr_coverage(document_id: str, session: Session = Depends(session_dep)):
    if get_pdf_document(session, document_id) is None:
        raise HTTPException(status_code=404, detail="PDF 资料不存在。")
    return get_pdf_ocr_coverage(document_id)


@router.get("/{document_id}")
def api_download_pdf_document(document_id: str, session: Session = Depends(session_dep)):
    try:
        download = resolve_pdf_download(session, document_id, PDF_LIBRARY_DIR)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="PDF 文件缺失。") from exc
    if download is None:
        raise HTTPException(status_code=404, detail="PDF 资料不存在。")
    return FileResponse(download.path, filename=download.original_name, media_type="application/pdf")


@router.delete("/{document_id}")
def api_delete_pdf_document(document_id: str, session: Session = Depends(session_dep)):
    return {
        "ok": delete_pdf_document(
            session,
            document_id,
            PDF_LIBRARY_DIR,
            uow=SqlAlchemyUnitOfWork(session),
        )
    }
