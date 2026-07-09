"""reset legacy english reading dictionary cache table

memory-anki: allow-destructive-migration

This legacy cache reset migration intentionally drops a rebuildable cache table.
"""

from __future__ import annotations

from alembic import op

from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingDictionaryCache,
)

revision = "0003_reset_english_reading_dictionary_cache"
down_revision = "0002_legacy_schema_adjustments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    table_info = bind.exec_driver_sql(
        "PRAGMA table_info(english_reading_dictionary_cache)"
    ).fetchall()
    existing_columns = {str(row[1]) for row in table_info}
    if table_info and "provider" in existing_columns:
        bind.exec_driver_sql("DROP TABLE IF EXISTS english_reading_dictionary_cache")
        table_info = []
    if not table_info:
        EnglishReadingDictionaryCache.__table__.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP TABLE IF EXISTS english_reading_dictionary_cache")
