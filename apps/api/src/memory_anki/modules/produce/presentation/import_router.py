from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.api import (
    FullTransferError,
    build_full_archive,
    create_rescue_snapshot,
    import_full_archive,
    inspect_archive,
)
from memory_anki.modules.content.api import (
    export_json,
    export_markdown,
    import_json,
    import_markdown,
)
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["import-export"])


@router.get("/export/json")
def api_export_json(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_json(s), media_type="application/json",
                             headers={"Content-Disposition": "attachment; filename=palaces.json"})


@router.get("/export/markdown")
def api_export_md(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_markdown(s), media_type="text/markdown",
                             headers={"Content-Disposition": "attachment; filename=palaces.md"})


@router.get("/export/full")
def api_export_full(s: Session = Depends(session_dep)):
    zip_bytes, filename = build_full_archive(s)
    return Response(
        zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import/full/preview")
async def api_import_full_preview(
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    try:
        return {"ok": True, **inspect_archive(await file.read(), s)}
    except FullTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/full")
async def api_import_full(
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    zip_bytes = await file.read()
    try:
        inspect_archive(zip_bytes, s)
        create_rescue_snapshot("before-full-import")
        result = import_full_archive(zip_bytes, s)
        return {"ok": True, **result}
    except FullTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
async def api_import(
    request: Request,
    file: UploadFile = File(...),
    format: str = "json",
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    content = (await file.read()).decode("utf-8")
    response: dict = {}

    def prepare_atomic_side_effects(palaces) -> None:
        response.update({"ok": True, "count": len(palaces)})
        mutation_store.save(mutation_identity, response)

    try:
        importer = import_json if format == "json" else import_markdown
        importer(
            s,
            content,
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=prepare_atomic_side_effects,
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
