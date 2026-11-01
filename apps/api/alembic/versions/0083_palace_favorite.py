"""Add the learner favorite flag to palaces.

Revision ID: 0083_palace_favorite
Revises: 0082_quiz_question_variants

Favorites are curation, separate from ``exam_stars`` (the 1-3 exam importance
weight). The shelf toggles this flag and the freestyle progress rail stars every
review unit of a favorited palace.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0083_palace_favorite"
down_revision = "0082_quiz_question_variants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "palaces",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("palaces") as batch:
        batch.drop_column("is_favorite")
