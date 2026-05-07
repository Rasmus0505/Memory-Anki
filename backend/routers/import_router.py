from fastapi import APIRouter, UploadFile, File, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from models import get_session, Palace
from services.import_export import export_json, export_markdown, import_json, import_markdown
from services.review_service import trigger_review_for_palace

router = APIRouter(tags=["import-export"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


@router.get("/export/json")
def api_export_json(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_json(s), media_type="application/json",
                             headers={"Content-Disposition": "attachment; filename=palaces.json"})


@router.get("/export/markdown")
def api_export_md(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_markdown(s), media_type="text/markdown",
                             headers={"Content-Disposition": "attachment; filename=palaces.md"})


@router.post("/import")
async def api_import(file: UploadFile = File(...), format: str = "json",
                     s: Session = Depends(session_dep)):
    content = (await file.read()).decode("utf-8")
    try:
        count = import_json(s, content) if format == "json" else import_markdown(s, content)
        latest = s.query(Palace).order_by(Palace.id.desc()).limit(count).all()
        for p in latest:
            trigger_review_for_palace(s, p.id)
        return {"ok": True, "count": count}
    except Exception as e:
        return {"ok": False, "error": str(e)}
