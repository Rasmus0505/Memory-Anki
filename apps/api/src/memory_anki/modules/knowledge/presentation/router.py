"""知识体系路由：学科 + 章节 + 双向关联 + 自定义连线"""
import traceback

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    NodeConnection,
    Palace,
    Subject,
    get_session,
)
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
from memory_anki.modules.mindmap.application.editor_state_service import (
    get_subject_editor_state,
    save_subject_editor_state,
    sync_subject_editor_root,
)
from memory_anki.modules.palaces.domain.schemas import ChapterCreate

router = APIRouter(tags=["knowledge"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def chapter_json(c: Chapter) -> dict:
    children = c.children or []
    return {
        "id": c.id,
        "subject_id": c.subject_id,
        "parent_id": c.parent_id,
        "name": c.name,
        "sort_order": c.sort_order,
        "notes": c.notes,
        "children": [chapter_json(ch) for ch in children],
        "palace_count": len(c.palaces or []),
    }


def subject_json(s: Subject) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "color": s.color,
        "sort_order": s.sort_order,
    }


# === 学科 ===

@router.get("/subjects")
def list_subjects(s: Session = Depends(session_dep)):
    return [subject_json(sub) for sub in s.query(Subject).order_by(Subject.sort_order).all()]


@router.post("/subjects")
def create_subject(data: dict, s: Session = Depends(session_dep)):
    sub = Subject(name=data.get("name", ""), color=data.get("color", "#6366f1"),
                  sort_order=data.get("sort_order", 0))
    s.add(sub)
    s.commit()
    return subject_json(sub)


@router.put("/subjects/{subject_id}")
def update_subject(subject_id: int, data: dict, s: Session = Depends(session_dep)):
    sub = s.query(Subject).filter_by(id=subject_id).first()
    if not sub:
        return {"error": "not found"}
    for key in ("name", "color", "sort_order"):
        if key in data:
            setattr(sub, key, data[key])
    sync_subject_editor_root(sub)
    s.commit()
    return subject_json(sub)


@router.delete("/subjects/{subject_id}")
def delete_subject(subject_id: int, s: Session = Depends(session_dep)):
    sub = s.query(Subject).filter_by(id=subject_id).first()
    if not sub:
        return {"error": "not found"}
    s.delete(sub)
    s.commit()
    return {"ok": True}


# === 章节 ===

@router.get("/subjects/{subject_id}/tree")
def get_tree(subject_id: int, s: Session = Depends(session_dep)):
    """获取学科完整章节树"""
    subject = s.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return {"error": "not found"}
    root_chapters = [c for c in subject.chapters if c.parent_id is None]
    return {
        "subject": subject_json(subject),
        "chapters": [chapter_json(c) for c in root_chapters],
    }


@router.get("/subjects/{subject_id}/editor")
def get_subject_editor(subject_id: int, s: Session = Depends(session_dep)):
    subject = s.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return {"error": "not found"}
    return {
        "subject": subject_json(subject),
        **get_subject_editor_state(subject),
    }


@router.put("/subjects/{subject_id}/editor")
def update_subject_editor(subject_id: int, data: dict, s: Session = Depends(session_dep)):
    subject = s.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return {"error": "not found"}
    result = {
        "subject": subject_json(subject),
        **save_subject_editor_state(s, subject, data),
    }
    maybe_create_rolling_backup("rolling-subject-editor-save")
    return result


@router.get("/chapters/{chapter_id}")
def get_chapter(chapter_id: int, s: Session = Depends(session_dep)):
    """获取章节详情 + 关联的宫殿列表"""
    c = s.query(Chapter).filter_by(id=chapter_id).first()
    if not c:
        return {"error": "not found"}

    def palace_out(p):
        return {
            "id": p.id, "title": p.title,
            "pegs": [{"id": pg.id, "name": pg.name, "content": pg.content} for pg in p.pegs],
        }

    # 面包屑路径 (通过 parent_id 手动查询)
    breadcrumbs: list[dict[str, int | str]] = []
    cur_id = c.parent_id
    while cur_id:
        parent = s.query(Chapter).filter_by(id=cur_id).first()
        if parent:
            breadcrumbs.insert(0, {"id": parent.id, "name": parent.name})
            cur_id = parent.parent_id
        else:
            break

    return {
        "chapter": {
            "id": c.id, "name": c.name, "notes": c.notes,
            "subject": subject_json(c.subject) if c.subject else None,
            "children": [chapter_json(ch) for ch in (c.children or [])],
            "breadcrumbs": breadcrumbs,
        },
        "palaces": [palace_out(p) for p in c.palaces],
    }


@router.post("/subjects/{subject_id}/chapters")
def create_chapter(subject_id: int, data: ChapterCreate, s: Session = Depends(session_dep)):
    print(f"[DEBUG] create_chapter: subject_id={subject_id}, data={data}", flush=True)
    try:
        c = Chapter(
            subject_id=subject_id,
            parent_id=data.parent_id,
            name=data.name,
            notes=data.notes,
            sort_order=data.sort_order,
        )
        s.add(c)
        s.flush()
        s.refresh(c)
        result = chapter_json(c)
        s.commit()
        maybe_create_rolling_backup("rolling-create-chapter")
        print(f"[DEBUG] create_chapter OK: chapter_id={c.id}", flush=True)
        return result
    except Exception:
        s.rollback()
        tb = traceback.format_exc()
        print(f"[DEBUG] create_chapter FAIL: {tb}", flush=True)
        return JSONResponse(status_code=500, content={"error": tb})


@router.put("/chapters/{chapter_id}")
def update_chapter(chapter_id: int, data: dict, s: Session = Depends(session_dep)):
    c = s.query(Chapter).filter_by(id=chapter_id).first()
    if not c:
        return {"error": "not found"}
    for key in ("name", "notes", "sort_order", "parent_id"):
        if key in data:
            setattr(c, key, data[key])
    s.commit()
    maybe_create_rolling_backup("rolling-update-chapter")
    return chapter_json(c)


def _delete_recursive(chapter: Chapter, s: Session):
    """递归删除章节及其所有后代"""
    for child in chapter.children:
        _delete_recursive(child, s)
    s.delete(chapter)


@router.delete("/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, s: Session = Depends(session_dep)):
    print(f"[DEBUG] delete_chapter: chapter_id={chapter_id}", flush=True)
    try:
        c = s.query(Chapter).filter_by(id=chapter_id).first()
        if c:
            _delete_recursive(c, s)
            s.commit()
            maybe_create_rolling_backup("rolling-delete-chapter")
            print("[DEBUG] delete_chapter OK (cascade)", flush=True)
        return {"ok": True}
    except Exception:
        s.rollback()
        tb = traceback.format_exc()
        print(f"[DEBUG] delete_chapter FAIL: {tb}", flush=True)
        return JSONResponse(status_code=500, content={"error": tb})


# === 双向关联 ===

@router.get("/palaces/{palace_id}/chapters")
def palace_chapters(palace_id: int, s: Session = Depends(session_dep)):
    """获取宫殿关联的章节"""
    p = s.query(Palace).filter_by(id=palace_id).first()
    if not p:
        return {"error": "not found"}
    return [{
        "id": c.id, "name": c.name, "subject_id": c.subject_id,
        "parent_id": c.parent_id,
        "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None,
    } for c in p.chapters]


@router.put("/palaces/{palace_id}/chapters")
def link_chapters(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    """设置宫殿关联的章节 (data: {chapter_ids: [1,2,3]})"""
    p = s.query(Palace).filter_by(id=palace_id).first()
    if not p:
        return {"error": "not found"}
    ids = [int(chapter_id) for chapter_id in data.get("chapter_ids", [])]
    expanded_ids: set[int] = set()

    for chapter_id in ids:
        current = s.query(Chapter).filter_by(id=chapter_id).first()
        while current:
            expanded_ids.add(current.id)
            current = current.parent

    p.chapters = s.query(Chapter).filter(Chapter.id.in_(expanded_ids)).all() if expanded_ids else []
    s.commit()
    maybe_create_rolling_backup("rolling-link-chapters")
    return {"ok": True, "count": len(p.chapters)}


# === 自定义连线 ===

def connection_json(conn: NodeConnection) -> dict:
    return {
        "id": conn.id,
        "source_type": conn.source_type,
        "source_id": conn.source_id,
        "target_type": conn.target_type,
        "target_id": conn.target_id,
        "label": conn.label,
        "style": conn.style,
    }


@router.get("/connections")
def list_connections(
    source_type: str = "",
    source_id: int | None = None,
    s: Session = Depends(session_dep),
):
    """查询连线，可按来源节点过滤"""
    q = s.query(NodeConnection)
    if source_type and source_id is not None:
        q = q.filter_by(source_type=source_type, source_id=source_id)
    return [connection_json(c) for c in q.all()]


@router.post("/connections")
def create_connection(data: dict, s: Session = Depends(session_dep)):
    """创建自定义连线"""
    conn = NodeConnection(
        source_type=data.get("source_type", ""),
        source_id=data.get("source_id", 0),
        target_type=data.get("target_type", ""),
        target_id=data.get("target_id", 0),
        label=data.get("label", ""),
        style=data.get("style", "solid"),
    )
    s.add(conn)
    s.commit()
    maybe_create_rolling_backup("rolling-create-connection")
    return connection_json(conn)


@router.delete("/connections/{conn_id}")
def delete_connection(conn_id: int, s: Session = Depends(session_dep)):
    s.query(NodeConnection).filter_by(id=conn_id).delete()
    s.commit()
    maybe_create_rolling_backup("rolling-delete-connection")
    return {"ok": True}
