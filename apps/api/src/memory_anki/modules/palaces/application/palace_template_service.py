"""Palace template CRUD and instantiation."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceTemplate
from memory_anki.platform.application import UnitOfWork


class PalaceTemplateError(ValueError):
    pass


def _template_json(template: PalaceTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "name": template.name,
        "description": template.description,
        "source_palace_id": template.source_palace_id,
        "created_at": template.created_at.isoformat() if template.created_at else None,
    }


def list_templates(session: Session) -> list[dict[str, Any]]:
    rows = session.query(PalaceTemplate).order_by(PalaceTemplate.id.desc()).all()
    return [_template_json(row) for row in rows]


def create_template_from_palace(
    session: Session,
    palace_id: int,
    name: str,
    description: str,
    *,
    uow: UnitOfWork,
) -> dict[str, Any]:
    palace = session.get(Palace, palace_id)
    if not palace:
        raise PalaceTemplateError("宫殿不存在。")
    if not str(palace.editor_doc or "").strip():
        raise PalaceTemplateError("这个宫殿还没有思维导图内容，无法存为模板。")
    template = PalaceTemplate(
        name=str(name or "").strip() or (palace.manual_title or palace.title or "未命名模板"),
        description=str(description or "").strip(),
        editor_doc=palace.editor_doc or "",
        editor_config=palace.editor_config or "",
        source_palace_id=palace.id,
    )
    session.add(template)
    uow.commit()
    uow.refresh(template)
    return _template_json(template)


def delete_template(
    session: Session, template_id: int, *, uow: UnitOfWork
) -> bool:
    template = session.get(PalaceTemplate, template_id)
    if not template:
        return False
    session.delete(template)
    uow.commit()
    return True


def _retitle_editor_doc(editor_doc: str, title: str) -> str:
    """Update known mind-map root title fields; invalid JSON is preserved."""
    try:
        doc = json.loads(editor_doc)
    except (TypeError, ValueError):
        return editor_doc
    if not isinstance(doc, dict):
        return editor_doc
    if title:
        root = doc.get("root")
        if isinstance(root, dict):
            data = root.get("data")
            if isinstance(data, dict):
                data["text"] = title
        node_data = doc.get("nodeData")
        if isinstance(node_data, dict):
            node_data["topic"] = title
    return json.dumps(doc, ensure_ascii=False)


def instantiate_template(
    session: Session,
    template_id: int,
    title: str,
    *,
    uow: UnitOfWork,
    before_commit: Callable[[Palace], None] | None = None,
) -> Palace:
    template = session.get(PalaceTemplate, template_id)
    if not template:
        raise PalaceTemplateError("模板不存在。")
    safe_title = str(title or "").strip() or template.name
    palace = Palace(
        title=safe_title,
        description=f"由模板「{template.name}」创建",
        editor_doc=_retitle_editor_doc(template.editor_doc, safe_title),
        editor_config=template.editor_config or "",
    )
    session.add(palace)
    session.flush()
    if before_commit is not None:
        before_commit(palace)
    uow.commit()
    uow.refresh(palace)
    return palace
