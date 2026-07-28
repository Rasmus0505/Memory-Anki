"""Add stable per-appearance review unit encounters.

Revision ID: 0050_review_unit_encounters
Revises: 0049_permanent_mark_review_units
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0050_review_unit_encounters"
down_revision = "0049_permanent_mark_review_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_unit_encounters",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "study_session_id",
            sa.String(64),
            sa.ForeignKey("study_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "unit_id",
            sa.String(64),
            sa.ForeignKey("review_unit_states.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("unit_revision", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.String(128), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("baseline_state_json", sa.Text(), nullable=False),
        sa.Column("effective_operation_id", sa.String(64), nullable=True),
        sa.Column("selected_rating", sa.Integer(), nullable=True),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("retry_after_cards", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("close_operation_id", sa.String(64), nullable=True, unique=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint(
            "study_session_id",
            "unit_id",
            "sequence",
            name="uq_review_unit_encounters_sequence",
        ),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_review_unit_encounters_open "
        "ON review_unit_encounters (study_session_id, unit_id) WHERE status = 'open'"
    )
    op.create_index(
        "ix_review_unit_encounters_round",
        "review_unit_encounters",
        ["round_id", "created_at"],
    )

    op.add_column(
        "review_unit_rating_operations",
        sa.Column("encounter_id", sa.String(64), nullable=True),
    )
    op.add_column(
        "review_unit_rating_operations",
        sa.Column("replaces_operation_id", sa.String(64), nullable=True),
    )
    op.add_column(
        "review_unit_rating_operations",
        sa.Column("replaced_at", sa.DateTime(), nullable=True),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, study_session_id, unit_id, unit_revision, rating, passed, "
            "retry_after_cards, before_state_json, undone_at, created_at "
            "FROM review_unit_rating_operations ORDER BY created_at, id"
        )
    ).mappings()
    sequences: dict[tuple[str, str], int] = {}
    for row in rows:
        key = (str(row["study_session_id"]), str(row["unit_id"]))
        sequence = sequences.get(key, 0)
        sequences[key] = sequence + 1
        encounter_id = f"legacy-{row['id']}"
        if len(encounter_id) > 64:
            encounter_id = encounter_id[:64]
        baseline = row["before_state_json"] or json.dumps({"state": {}, "item": {}})
        effective_id = None if row["undone_at"] is not None else row["id"]
        conn.execute(
            sa.text(
                "INSERT INTO review_unit_encounters "
                "(id, study_session_id, unit_id, unit_revision, round_id, sequence, "
                "baseline_state_json, effective_operation_id, selected_rating, passed, "
                "retry_after_cards, status, closed_at, created_at, updated_at) "
                "VALUES (:id, :session_id, :unit_id, :revision, 'legacy', :sequence, "
                ":baseline, :effective_id, :rating, :passed, :retry_after, 'closed', "
                ":created_at, :created_at, :created_at)"
            ),
            {
                "id": encounter_id,
                "session_id": row["study_session_id"],
                "unit_id": row["unit_id"],
                "revision": row["unit_revision"],
                "sequence": sequence,
                "baseline": baseline,
                "effective_id": effective_id,
                "rating": row["rating"] if effective_id is not None else None,
                "passed": row["passed"] if effective_id is not None else None,
                "retry_after": row["retry_after_cards"] if effective_id is not None else 0,
                "created_at": row["created_at"],
            },
        )
        conn.execute(
            sa.text(
                "UPDATE review_unit_rating_operations SET encounter_id = :encounter_id "
                "WHERE id = :operation_id"
            ),
            {"encounter_id": encounter_id, "operation_id": row["id"]},
        )

    op.create_index(
        "ix_review_unit_rating_operations_encounter",
        "review_unit_rating_operations",
        ["encounter_id", "created_at"],
    )


def downgrade() -> None:
    raise RuntimeError("0050 is a one-way review semantics migration")
