"""Purge 睡前复习 cards and plan-only grades from stored rounds

Revision ID: 0086_remove_bedtime_review
Revises: 0085_remove_review_unit_fsrs_shadow

The 睡前复习 (bedtime review) feature is gone: endpoint, plan rules, and UI.
A stored round plan may still carry cards with ``bedtime`` / ``palace_pass``
and a plan-only ``bedtime_ratings`` map. Those cards were never written to the
Reviews ledger, so deleting them outright loses no scheduling evidence.

This migration also drops the columns whenever a round carried bedtime rows
into ``completed_ids`` / ``excluded_ids`` / ``compressed_ids`` /
``presented_ids`` / ``encounters`` / ``occurrences``, so a resumed round cannot
show a card whose detail endpoint is gone.

The delete is not reversible.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0086_remove_bedtime_review"
down_revision = "0085_remove_review_unit_fsrs_shadow"
branch_labels = None
depends_on = None

_ID_LIST_KEYS = ("presented_ids", "completed_ids", "excluded_ids", "compressed_ids")


def _bedtime_ids(plan: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for item in plan.get("original_cards") or []:
        if not isinstance(item, dict):
            continue
        if item.get("bedtime") or item.get("palace_pass"):
            card_id = str(item.get("card_id") or "").strip()
            if card_id:
                ids.add(card_id)
    for key in plan.get("bedtime_ratings") or {}:
        card_id = str(key or "").strip()
        if card_id:
            ids.add(card_id)
    return ids


def _clean_plan(plan: dict[str, Any]) -> dict[str, Any]:
    ids = _bedtime_ids(plan)
    cleaned = dict(plan)
    cleaned.pop("bedtime_ratings", None)
    if not ids:
        return cleaned
    cleaned["original_cards"] = [
        item
        for item in plan.get("original_cards") or []
        if not (isinstance(item, dict) and str(item.get("card_id") or "") in ids)
    ]
    for key in _ID_LIST_KEYS:
        cleaned[key] = [item for item in plan.get(key) or [] if str(item) not in ids]
    encounters = plan.get("encounters") or {}
    if isinstance(encounters, dict):
        cleaned["encounters"] = {
            key: value for key, value in encounters.items() if str(key) not in ids
        }
    occurrences = plan.get("occurrences") or []
    if isinstance(occurrences, list):
        cleaned["occurrences"] = [
            occ
            for occ in occurrences
            if not (
                isinstance(occ, dict)
                and (
                    str(occ.get("source_card_id") or "") in ids
                    or str(occ.get("occurrence_id") or "") in ids
                )
            )
        ]
    current = cleaned.get("current_card_id")
    if current is not None and str(current) in ids:
        presented = cleaned.get("presented_ids") or []
        cleaned["current_card_id"] = presented[0] if presented else None
        cleaned["current_index"] = 0
    return cleaned


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())
    if "freestyle_round_states" not in tables:
        return
    rows = connection.execute(
        sa.text("SELECT round_id, plan_json FROM freestyle_round_states")
    ).mappings().all()
    for row in rows:
        try:
            plan = json.loads(row["plan_json"] or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(plan, dict):
            continue
        cleaned = _clean_plan(plan)
        if cleaned == plan:
            continue
        connection.execute(
            sa.text(
                "UPDATE freestyle_round_states SET plan_json = :plan_json "
                "WHERE round_id = :round_id"
            ),
            {
                "round_id": row["round_id"],
                "plan_json": json.dumps(cleaned, ensure_ascii=False),
            },
        )


def downgrade() -> None:
    # 睡前复习 cards were never written to the Reviews ledger; nothing to restore.
    pass
