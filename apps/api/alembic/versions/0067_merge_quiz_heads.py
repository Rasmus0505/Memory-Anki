"""Merge quiz binding and practice progress migration heads.

Revision ID: 0067_merge_quiz_heads
Revises: 0050_quiz_node_binding_single_palace, 0066_quiz_practice_progress
"""

revision = "0067_merge_quiz_heads"
down_revision = (
    "0050_quiz_node_binding_single_palace",
    "0066_quiz_practice_progress",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
