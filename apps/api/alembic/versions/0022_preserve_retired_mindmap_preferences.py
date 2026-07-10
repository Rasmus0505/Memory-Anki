"""Preserve compatibility with databases already stamped at the retired 0022 revision.

Revision ID: 0022_preserve_retired_mindmap_preferences
Revises: 0021_remove_mindmap_view_preferences
"""

from __future__ import annotations


revision = "0022_preserve_retired_mindmap_preferences"
down_revision = "0021_remove_mindmap_view_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Compatibility marker only; current schema definitions remain authoritative."""


def downgrade() -> None:
    """Compatibility marker only; no user data is changed."""
