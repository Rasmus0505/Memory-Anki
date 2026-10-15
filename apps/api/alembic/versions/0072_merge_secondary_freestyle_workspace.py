"""merge the secondary freestyle workspace into 随心

Revision ID: 0072_merge_secondary_freestyle_workspace
Revises: 0071_retire_cohort_review_units

Product decision: one 随心 entry. The secondary workspace (随心2) takes over the
primary slot together with its feed settings. A primary round that was still
active is kept as ``status='archived'`` rather than deleted, so it can be found
again. Completed secondary rounds move to primary as history.

Nothing is deleted from the round tables. Downgrade is a no-op.
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0072_merge_secondary_freestyle_workspace"
down_revision = "0071_retire_cohort_review_units"
branch_labels = None
depends_on = None

PRIMARY = "primary"
SECONDARY = "secondary"
PRIMARY_FEED_KEY = "freestyle_feed_config"
SECONDARY_FEED_KEY = "freestyle_feed_config_secondary"


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())
    if "freestyle_round_states" in tables:
        _merge_rounds(connection)
    if "config" in tables:
        _merge_feed_settings(connection)


def _merge_rounds(connection: sa.Connection) -> None:
    rounds = sa.table(
        "freestyle_round_states",
        sa.column("round_id", sa.String),
        sa.column("workspace", sa.String),
        sa.column("status", sa.String),
        sa.column("updated_at", sa.DateTime),
    )
    secondary_active = connection.execute(
        sa.select(rounds.c.round_id).where(
            rounds.c.workspace == SECONDARY, rounds.c.status == "active"
        )
    ).first()
    if secondary_active is not None:
        # The primary round is displaced by 随心2's round; keep it as an archive.
        connection.execute(
            rounds.update()
            .where(rounds.c.workspace == PRIMARY, rounds.c.status == "active")
            .values(status="archived")
        )

    connection.execute(
        rounds.update().where(rounds.c.workspace == SECONDARY).values(workspace=PRIMARY)
    )

    # Defensive: if the secondary slot ever held more than one active round,
    # keep only the most recently updated one active.
    active = connection.execute(
        sa.select(rounds.c.round_id, rounds.c.updated_at)
        .where(rounds.c.workspace == PRIMARY, rounds.c.status == "active")
        .order_by(rounds.c.updated_at.desc())
    ).all()
    for round_id, _updated_at in active[1:]:
        connection.execute(
            rounds.update().where(rounds.c.round_id == round_id).values(status="archived")
        )


def _merge_feed_settings(connection: sa.Connection) -> None:
    config = sa.table(
        "config",
        sa.column("key", sa.String),
        sa.column("value", sa.Text),
        sa.column("updated_at", sa.DateTime),
    )
    secondary_value = connection.execute(
        sa.select(config.c.value).where(config.c.key == SECONDARY_FEED_KEY)
    ).scalar_one_or_none()
    if secondary_value is None:
        return
    now = datetime.now(UTC).replace(tzinfo=None)
    primary_exists = connection.execute(
        sa.select(config.c.key).where(config.c.key == PRIMARY_FEED_KEY)
    ).first()
    if primary_exists is None:
        connection.execute(
            config.insert().values(key=PRIMARY_FEED_KEY, value=secondary_value, updated_at=now)
        )
    else:
        connection.execute(
            config.update()
            .where(config.c.key == PRIMARY_FEED_KEY)
            .values(value=secondary_value, updated_at=now)
        )
    connection.execute(config.delete().where(config.c.key == SECONDARY_FEED_KEY))


def downgrade() -> None:
    # Merged rounds and settings cannot be split back apart.
    pass
