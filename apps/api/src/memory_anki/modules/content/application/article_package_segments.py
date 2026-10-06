"""Portable segment descriptors for the quiz public article package boundary."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment
from memory_anki.modules.mindmap_document.api import collect_node_descendants


def list_article_package_segments(session: Session, palace_id: int) -> list[dict[str, Any]]:
    palace = session.get(Palace, palace_id)
    if palace is None:
        raise LookupError("Palace not found")
    nodes, _ = collect_node_descendants(palace.editor_doc)
    result = []
    for segment in session.query(PalaceSegment).filter_by(palace_id=palace_id).order_by(PalaceSegment.sort_order, PalaceSegment.id):
        uids = json.loads(segment.node_uids_json)
        if not isinstance(uids, list) or any(not isinstance(uid, str) or uid not in nodes for uid in uids) or len(set(uids)) != len(uids):
            raise ValueError("Segment has invalid or missing node references")
        result.append({"id": segment.id, "name": segment.name, "color": segment.color, "node_uids": uids, "sort_order": segment.sort_order})
    return result


def validate_article_segment_target(session: Session, palace_id: int, target_uids: set[str]) -> None:
    for segment in list_article_package_segments(session, palace_id):
        if set(segment["node_uids"]) - target_uids:
            raise ValueError("Replacement removes nodes referenced by an existing segment")


def restore_article_package_segments(session: Session, palace_id: int, descriptors: Any, uid_map: dict[str, str]) -> None:
    if not isinstance(descriptors, list) or len(descriptors) > 5000:
        raise ValueError("Invalid segment package")
    existing = list_article_package_segments(session, palace_id)
    seen: set[str] = set()
    for raw in descriptors:
        if not isinstance(raw, dict) or set(raw) != {"name", "color", "node_uids", "sort_order"}:
            raise ValueError("Unsupported segment fields")
        if not isinstance(raw["name"], str) or len(raw["name"]) > 200 or not isinstance(raw["color"], str) or len(raw["color"]) > 24 or type(raw["sort_order"]) is not int:
            raise ValueError("Invalid segment metadata")
        uids = raw["node_uids"]
        if not isinstance(uids, list) or any(not isinstance(uid, str) or uid not in uid_map for uid in uids) or len(set(uids)) != len(uids):
            raise ValueError("Segment references nodes outside package")
        mapped = {**raw, "node_uids": [uid_map[uid] for uid in uids]}
        key = json.dumps(mapped, sort_keys=True)
        if key in seen:
            raise ValueError("Duplicate segment descriptor")
        seen.add(key)
        matches = [item for item in existing if {field: value for field, value in item.items() if field != "id"} == mapped]
        if len(matches) > 1:
            raise ValueError("Ambiguous target segment descriptor")
        if matches:
            continue
        segment = PalaceSegment(palace_id=palace_id, name=mapped["name"], color=mapped["color"], sort_order=mapped["sort_order"], node_uids_json=json.dumps(mapped["node_uids"]))
        session.add(segment)
        session.flush()
        existing.append({"id": segment.id, **mapped})
