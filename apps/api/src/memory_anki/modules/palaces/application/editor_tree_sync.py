from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.modules.mindmap_document.api import (
    NODE_ID_KEY,
    NODE_TYPE_KEY,
    NODE_UID_KEY,
    coerce_editor_int,
    deserialize_editor_payload,
    ensure_editor_dict,
    plain_editor_text,
    stringify_editor_value,
)


def sync_palace_tree_from_doc(session: Session, palace: Palace, doc: dict[str, Any]) -> None:
    nodes = doc["root"]["children"]
    existing = session.query(Peg).filter_by(palace_id=palace.id).all()
    by_id = {peg.id: peg for peg in existing}
    uid_map = _collect_existing_id_map(deserialize_editor_payload(palace.editor_doc, None))
    seen_ids: set[int] = set()

    def visit(items: list[dict[str, Any]], parent_id: int | None) -> None:
        for index, item in enumerate(items):
            data = ensure_editor_dict(item.get("data"))
            item["data"] = data
            original_text = stringify_editor_value(data.get("text"))
            original_note = stringify_editor_value(data.get("note"))
            peg_name = plain_editor_text(data.get("text"), fallback="新节点")
            peg_content = stringify_editor_value(data.get("note"))
            peg_id = coerce_editor_int(data.get(NODE_ID_KEY))
            if peg_id is None:
                peg_id = uid_map.get(stringify_editor_value(data.get(NODE_UID_KEY)))
            peg = by_id.get(peg_id) if peg_id else None
            if peg is None:
                peg = Peg(
                    palace_id=palace.id,
                    parent_id=parent_id,
                    sort_order=index,
                    name=peg_name,
                    content=peg_content,
                )
                session.add(peg)
                session.flush()
                by_id[peg.id] = peg

            peg.palace_id = palace.id
            peg.parent_id = parent_id
            peg.sort_order = index
            peg.name = peg_name
            peg.content = peg_content

            data["text"] = original_text or peg_name
            data["note"] = original_note or peg_content
            data[NODE_ID_KEY] = peg.id
            data[NODE_TYPE_KEY] = "peg"
            seen_ids.add(peg.id)

            children = item.get("children")
            if not isinstance(children, list):
                children = []
                item["children"] = children
            visit(children, peg.id)

    visit(nodes, None)
    session.flush()

    removed_ids = {peg.id for peg in existing if peg.id not in seen_ids}
    if removed_ids:
        for peg in existing:
            if peg.id in removed_ids and peg.parent_id not in removed_ids:
                _delete_peg_tree(session, peg)
        session.flush()


def _delete_peg_tree(session: Session, peg: Peg) -> None:
    for child in list(peg.children or []):
        _delete_peg_tree(session, child)
    session.delete(peg)


def _collect_existing_id_map(doc: Any) -> dict[str, int]:
    if not isinstance(doc, dict):
        return {}
    result: dict[str, int] = {}

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            uid = stringify_editor_value(data.get(NODE_UID_KEY))
            business_id = coerce_editor_int(data.get(NODE_ID_KEY))
            if uid and business_id:
                result[uid] = business_id
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                walk(child)

    walk(doc.get("root"))
    return result
