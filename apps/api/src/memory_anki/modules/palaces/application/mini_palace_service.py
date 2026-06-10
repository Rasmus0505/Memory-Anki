from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Palace, PalaceMiniPalace, engine
from memory_anki.modules.palaces.application.segment_nodes import (
    collect_doc_nodes_with_descendants,
)


def ensure_mini_palace_schema() -> None:
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "palace_mini_palaces" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_mini_palaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_id INTEGER NOT NULL,
                    name VARCHAR(200) NOT NULL DEFAULT '',
                    node_uids_json TEXT DEFAULT '[]',
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
                )
                """
            )
        else:
            existing_columns = {
                row[1]
                for row in conn.exec_driver_sql(
                    "PRAGMA table_info(palace_mini_palaces)"
                ).fetchall()
            }
            columns = (
                ("name", "VARCHAR(200) NOT NULL DEFAULT ''"),
                ("node_uids_json", "TEXT DEFAULT '[]'"),
                ("sort_order", "INTEGER DEFAULT 0"),
                ("created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
                ("updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
            )
            for column_name, column_type in columns:
                if column_name not in existing_columns:
                    conn.exec_driver_sql(
                        f"ALTER TABLE palace_mini_palaces ADD COLUMN {column_name} {column_type}"
                    )

        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_mini_palaces_palace_sort "
            "ON palace_mini_palaces (palace_id, sort_order)"
        )


def parse_mini_palace_node_uids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return _unique_strings(data)


def serialize_mini_palace_node_uids(node_uids: list[str]) -> str:
    return json.dumps(_unique_strings(node_uids), ensure_ascii=False)


def list_palace_mini_palaces(session: Session, palace: Palace) -> list[dict[str, Any]]:
    if cleanup_mini_palace_node_uids(session, palace):
        session.commit()
        session.refresh(palace)
    return [mini_palace_summary_json(item) for item in palace.mini_palaces]


def mini_palace_summary_json(mini_palace: PalaceMiniPalace) -> dict[str, Any]:
    node_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
    return {
        "id": mini_palace.id,
        "palace_id": mini_palace.palace_id,
        "name": mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}",
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "sort_order": mini_palace.sort_order,
        "created_at": mini_palace.created_at.isoformat() if mini_palace.created_at else None,
        "updated_at": mini_palace.updated_at.isoformat() if mini_palace.updated_at else None,
        "is_empty": len(node_uids) == 0,
    }


def create_palace_mini_palace(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    mini_palace = PalaceMiniPalace(
        palace_id=palace.id,
        name=_resolve_name(palace, payload.get("name")),
        node_uids_json=serialize_mini_palace_node_uids(
            _normalize_node_uids(palace, payload.get("node_uids", []))
        ),
        sort_order=max([item.sort_order for item in palace.mini_palaces], default=-1) + 1,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(mini_palace)
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def update_palace_mini_palace(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    if "name" in payload:
        mini_palace.name = _resolve_name(
            mini_palace.palace,
            payload.get("name"),
            exclude_id=mini_palace.id,
        )
    if "node_uids" in payload:
        mini_palace.node_uids_json = serialize_mini_palace_node_uids(
            _normalize_node_uids(mini_palace.palace, payload.get("node_uids", []))
        )
    if "sort_order" in payload:
        mini_palace.sort_order = max(0, int(payload.get("sort_order") or 0))
    mini_palace.updated_at = utc_now_naive()
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def delete_palace_mini_palace(session: Session, mini_palace: PalaceMiniPalace) -> None:
    session.delete(mini_palace)
    session.commit()


def get_palace_mini_palace(
    session: Session,
    mini_palace_id: int,
) -> PalaceMiniPalace | None:
    return session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()


def cleanup_mini_palace_node_uids(session: Session, palace: Palace) -> bool:
    valid_uids = _valid_checkpoint_uids(palace)
    changed = False
    for mini_palace in palace.mini_palaces:
        current_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
        next_uids = [uid for uid in current_uids if uid in valid_uids]
        if next_uids != current_uids:
            mini_palace.node_uids_json = serialize_mini_palace_node_uids(next_uids)
            mini_palace.updated_at = utc_now_naive()
            changed = True
    if changed:
        session.flush()
    return changed


def _normalize_node_uids(palace: Palace, value: Any) -> list[str]:
    valid_uids = _valid_checkpoint_uids(palace)
    return [uid for uid in _unique_strings(value if isinstance(value, list) else []) if uid in valid_uids]


def _valid_checkpoint_uids(palace: Palace) -> set[str]:
    valid_uids = set(collect_doc_nodes_with_descendants(palace.editor_doc)[0].keys())
    root_uid = _get_root_uid(palace.editor_doc)
    if root_uid:
        valid_uids.discard(root_uid)
    return valid_uids


def _get_root_uid(editor_doc: Any) -> str:
    try:
        doc = json.loads(editor_doc) if isinstance(editor_doc, str) else editor_doc
    except Exception:
        return ""
    if not isinstance(doc, dict):
        return ""
    root = doc.get("root")
    if not isinstance(root, dict):
        return ""
    data = root.get("data")
    if not isinstance(data, dict):
        return ""
    return str(data.get("uid") or "").strip()


def _unique_strings(values: Any) -> list[str]:
    result: list[str] = []
    if not isinstance(values, list):
        return result
    for item in values:
        text = str(item or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def _resolve_name(
    palace: Palace,
    value: Any,
    *,
    exclude_id: int | None = None,
) -> str:
    raw = str(value or "").strip()
    if raw:
        return raw
    existing_names = {
        str(item.name or "").strip()
        for item in palace.mini_palaces
        if exclude_id is None or item.id != exclude_id
    }
    index = 1
    while True:
        candidate = f"小宫殿 {index}"
        if candidate not in existing_names:
            return candidate
        index += 1
