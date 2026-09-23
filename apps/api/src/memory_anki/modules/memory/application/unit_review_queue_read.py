"""Trusted due-unit reads for queue build.

Queue build must not parse editor_doc or reconcile. Opening a unit reconciles
that palace; this read returns the stored active rows.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from .unit_review_projection import json_load_list


def list_trusted_due_units_for_queue(
    session: Session,
    palace_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Active due units for queue build, without parsing editor_doc or reconciling.

    ``palace_ids is None`` means every active palace. An empty list means none.
    """
    if palace_ids is not None and not palace_ids:
        return []
    query = (
        session.query(
            ReviewUnitState.id,
            ReviewUnitState.palace_id,
            ReviewUnitState.anchor_uid,
            ReviewUnitState.unit_kind,
            ReviewUnitState.node_uids_json,
            ReviewUnitState.revision,
            Palace.group_sort_order,
            Palace.title,
            Palace.manual_title,
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= date.today(),
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
    )
    if palace_ids is not None:
        query = query.filter(ReviewUnitState.palace_id.in_(list(palace_ids)))
    rows = query.order_by(
        Palace.group_sort_order.asc(),
        Palace.id.asc(),
        ReviewUnitState.due_date.asc(),
        ReviewUnitState.topology_order.asc(),
        ReviewUnitState.id.asc(),
    ).all()
    result: list[dict[str, Any]] = []
    for row in rows:
        manual = str(row.manual_title or "").strip()
        title = manual or str(row.title or "")
        anchor = str(row.anchor_uid or "")
        node_uids = [uid for uid in json_load_list(row.node_uids_json) if uid]
        if not node_uids and anchor:
            node_uids = [anchor]
        result.append(
            {
                "id": str(row.id),
                "palace_id": int(row.palace_id),
                "anchor_uid": anchor,
                "unit_kind": str(row.unit_kind or ""),
                "node_uids": node_uids,
                "revision": int(row.revision or 1),
                "title": title,
                "group_sort_order": int(row.group_sort_order or 0),
            }
        )
    return result
