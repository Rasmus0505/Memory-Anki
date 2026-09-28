"""Exam star weights on chapters/palaces and syllabus share on subjects.

Revision ID: 0064_exam_star_weights
Revises: 0063_review_unit_cohort_order
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0064_exam_star_weights"
down_revision = "0063_review_unit_cohort_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chapters", sa.Column("exam_stars", sa.Integer(), nullable=True))
    op.add_column("chapters", sa.Column("exam_stars_source", sa.String(16), nullable=True))
    op.add_column("palaces", sa.Column("exam_stars", sa.Integer(), nullable=True))
    op.add_column("palaces", sa.Column("exam_stars_source", sa.String(16), nullable=True))
    op.add_column("subjects", sa.Column("exam_share", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("subjects", "exam_share")
    op.drop_column("palaces", "exam_stars_source")
    op.drop_column("palaces", "exam_stars")
    op.drop_column("chapters", "exam_stars_source")
    op.drop_column("chapters", "exam_stars")
