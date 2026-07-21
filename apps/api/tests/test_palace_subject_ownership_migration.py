import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load_migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0034_palace_subject_ownership.py"
    spec = importlib.util.spec_from_file_location("migration_0034", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backfills_all_explicit_subjects_and_uncategorized_deterministically():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(100) UNIQUE NOT NULL, color VARCHAR(20), sort_order INTEGER, editor_doc TEXT, editor_config TEXT, editor_local_config TEXT)")
        connection.exec_driver_sql("CREATE TABLE palaces (id INTEGER PRIMARY KEY, primary_chapter_id INTEGER)")
        connection.exec_driver_sql("CREATE TABLE chapters (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL)")
        connection.exec_driver_sql("CREATE TABLE chapter_palaces (id INTEGER PRIMARY KEY, chapter_id INTEGER, palace_id INTEGER, is_explicit BOOLEAN)")
        connection.exec_driver_sql("INSERT INTO subjects VALUES (1, '学科A', '#111111', 0, '', '', ''), (2, '学科B', '#222222', 1, '', '', '')")
        connection.exec_driver_sql("INSERT INTO chapters VALUES (10, 1), (20, 2)")
        connection.exec_driver_sql("INSERT INTO palaces VALUES (100, 10), (200, NULL), (300, 20)")
        connection.exec_driver_sql("INSERT INTO chapter_palaces VALUES (1, 10, 100, 1), (2, 20, 100, 1), (3, 20, 300, 0)")

        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        rows = connection.exec_driver_sql("SELECT palace_id, subject_id FROM palace_subjects ORDER BY palace_id, subject_id").fetchall()
        names = dict(connection.exec_driver_sql("SELECT id, name FROM subjects").fetchall())
        assert rows[0:2] == [(100, 1), (100, 2)]
        assert names[dict(rows)[200]] == "未分类"
        assert (300, 2) in rows
        revisions = connection.exec_driver_sql("SELECT DISTINCT binding_revision FROM palaces").fetchall()
        assert revisions == [(0,)]
