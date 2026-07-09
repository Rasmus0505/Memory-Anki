"""prune legacy config keys left behind by deleted features

Revision ID: 0013_prune_legacy_config_keys
Revises: 0012_freestyle_history

memory-anki: allow-destructive-migration
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_prune_legacy_config_keys"
down_revision = "0012_freestyle_history"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def upgrade() -> None:
    if not _table_exists("config"):
        return
    op.get_bind().execute(
        sa.text(
            """
            DELETE FROM config
            WHERE key IN (
                'default_algorithm',
                'algorithm_change_scope',
                'custom_intervals',
                'time_recording_threshold_seconds',
                'flow_voice_api_key',
                'flow_voice_base_url',
                'flow_voice_model',
                'flow_voice_voice',
                'flow_voice_format',
                'flow_voice_sample_rate',
                'flow_voice_instruction',
                'flow_voice_thinking_enabled'
            )
            """
        )
    )


def downgrade() -> None:
    return
