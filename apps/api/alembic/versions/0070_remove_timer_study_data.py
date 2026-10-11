"""remove timer study sessions and freestyle learning-time state

Revision ID: 0070_remove_timer_study_data
Revises: 0069_repair_beijing_offset_study_sessions

The timer / study-time feature is gone. This drops every study session that
only existed to record timer time, and strips the learning-time bookkeeping
from stored freestyle round plans.

``study_sessions`` itself stays: ``review_unit_encounters.study_session_id``
is a cascading FK to it, and that table only references the review scenes
``formal_unit_review`` and ``freestyle_unit_review``. Those scenes are kept, so
the delete is cascade-safe. The delete is not reversible.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0070_remove_timer_study_data"
down_revision = "0069_repair_beijing_offset_study_sessions"
branch_labels = None
depends_on = None

KEPT_SCENES = ("formal_unit_review", "freestyle_unit_review")
DURATION_KEYS = ("effective_seconds", "total_effective_seconds", "quiz_seconds")


def _strip_durations(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_durations(item)
            for key, item in value.items()
            if key not in DURATION_KEYS
        }
    if isinstance(value, list):
        return [_strip_durations(item) for item in value]
    return value


def _clean_plan(plan: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(plan)
    cleaned.pop("learning_time", None)
    settlements = cleaned.get("partial_settlements")
    if settlements is not None:
        cleaned["partial_settlements"] = _strip_durations(settlements)
    return cleaned


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())

    if "study_sessions" in tables:
        placeholders = ", ".join(f":scene{i}" for i in range(len(KEPT_SCENES)))
        connection.execute(
            sa.text(f"DELETE FROM study_sessions WHERE scene NOT IN ({placeholders})"),
            {f"scene{i}": scene for i, scene in enumerate(KEPT_SCENES)},
        )

    if "freestyle_round_states" in tables:
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
    # The removed timer data cannot be reconstructed.
    pass
