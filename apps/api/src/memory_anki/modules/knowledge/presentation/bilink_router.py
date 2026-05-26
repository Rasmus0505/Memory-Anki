from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, get_session
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
from memory_anki.modules.knowledge.application.bilink_service import (
    bilink_json,
    build_palace_doc_index,
    create_bilink,
    delete_bilink,
    get_bilink_counts,
    get_node_context,
    list_bilinks,
    search_nodes,
)

router = APIRouter(tags=["knowledge-bilink"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


@router.get("/search/nodes")
def bilink_search_nodes(
    q: str = "",
    limit: int = 20,
    s: Session = Depends(session_dep),
):
    return search_nodes(s, q, limit)


@router.post("/bilinks")
def create_bilink_endpoint(data: dict, s: Session = Depends(session_dep)):
    try:
        conn = create_bilink(
            s,
            source_palace_id=int(data.get("source_palace_id") or 0),
            target_palace_id=int(data.get("target_palace_id") or 0),
            src_uid=data.get("src_uid"),
            tgt_uid=data.get("tgt_uid"),
            text=str(data.get("text") or ""),
        )
        s.commit()
        maybe_create_rolling_backup("rolling-create-bilink")
        palaces = (
            s.query(Palace)
            .filter(Palace.id.in_([conn.source_id, conn.target_id]))
            .all()
        )
        palace_map = {palace.id: palace for palace in palaces}
        palace_indexes = {palace.id: build_palace_doc_index(palace) for palace in palaces}
        return {"item": bilink_json(conn, palace_map=palace_map, palace_indexes=palace_indexes)}
    except ValueError as error:
        s.rollback()
        return JSONResponse(status_code=400, content={"error": str(error)})


@router.get("/bilinks")
def get_bilinks(palace_id: int, s: Session = Depends(session_dep)):
    return list_bilinks(s, palace_id)


@router.get("/bilinks/counts")
def bilink_counts(palace_id: int, s: Session = Depends(session_dep)):
    return get_bilink_counts(s, palace_id)


@router.delete("/bilinks/{bilink_id}")
def delete_bilink_endpoint(bilink_id: int, s: Session = Depends(session_dep)):
    deleted = delete_bilink(s, bilink_id)
    if not deleted:
        return {"error": "not found"}
    s.commit()
    maybe_create_rolling_backup("rolling-delete-bilink")
    return {"ok": True}


@router.get("/nodes/context")
def node_context(
    palace_id: int,
    node_uid: str | None = None,
    s: Session = Depends(session_dep),
):
    context = get_node_context(s, palace_id, node_uid)
    if not context:
        return {"error": "not found"}
    return context
