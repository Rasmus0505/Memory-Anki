"""retire same-parent cohort review units

Revision ID: 0071_retire_cohort_review_units
Revises: 0070_remove_timer_study_data

The ``cohort`` unit kind is gone: each permanent mark (and the residual root
flow) is its own unit, and no region is covered twice. Existing cohort rows are
deactivated rather than deleted, so their history stays readable.

Their palaces are also topology-changed, so any open unit-review study session
that froze a cohort is invalidated and its open encounters are closed. This is
the SQL form of ``reconcile._invalidate_active_sessions``; the reconcile path
would not run for a palace whose queue rows are read directly.

Nothing is deleted. Downgrade cannot restore the cohort rows, so it is a no-op.
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0071_retire_cohort_review_units"
down_revision = "0070_remove_timer_study_data"
branch_labels = None
depends_on = None

UNIT_SCENES = ("formal_unit_review", "freestyle_unit_review")


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())
    if "review_unit_states" not in tables:
        return

    now = datetime.now(UTC).replace(tzinfo=None)
    palace_ids = [
        row[0]
        for row in connection.execute(
            sa.text(
                "SELECT DISTINCT palace_id FROM review_unit_states "
                "WHERE unit_kind = 'cohort' AND active = 1"
            )
        ).all()
    ]
    if not palace_ids:
        return

    connection.execute(
        sa.text(
            "UPDATE review_unit_states SET active = 0, updated_at = :now "
            "WHERE unit_kind = 'cohort' AND active = 1"
        ),
        {"now": now},
    )

    if "study_sessions" not in tables:
        return
    scene_params = {f"scene{i}": scene for i, scene in enumerate(UNIT_SCENES)}
    scene_clause = ", ".join(f":scene{i}" for i in range(len(UNIT_SCENES)))
    for palace_id in palace_ids:
        params = {"now": now, "palace_id": palace_id, **scene_params}
        if "review_unit_encounters" in tables:
            connection.execute(
                sa.text(
                    "UPDATE review_unit_encounters SET status = 'closed', closed_at = :now "
                    "WHERE status = 'open' AND study_session_id IN ("
                    "SELECT id FROM study_sessions "
                    "WHERE palace_id = :palace_id AND scene IN (" + scene_clause + ") "
                    "AND status = 'active')"
                ),
                params,
            )
        connection.execute(
            sa.text(
                "UPDATE study_sessions SET status = 'invalidated', ended_at = :now, "
                "completion_method = 'unit_topology_changed', updated_at = :now "
                "WHERE palace_id = :palace_id AND scene IN (" + scene_clause + ") "
                "AND status = 'active'"
            ),
            params,
        )


def downgrade() -> None:
    # Retired cohort rows and invalidated sessions cannot be reconstructed.
    pass
