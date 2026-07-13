import importlib.util
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def _load_migration_module():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0029_unify_learning_groups.py"
    spec = importlib.util.spec_from_file_location("migration_0029_unify_learning_groups", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load learning group migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _BatchOp:
    def add_column(self, _column):
        return None


class _SqliteOp:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    @contextmanager
    def batch_alter_table(self, _table_name: str):
        yield _BatchOp()

    def create_table(self, _name: str, *_columns):
        return None

    def create_index(self, _name: str, _table_name: str, _columns: list[str]):
        return None

    def execute(self, statement: str):
        self.connection.execute(statement)


def test_upgrade_removes_only_mini_divisions_and_preserves_palace_and_questions():
    migration = _load_migration_module()
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE palace_segments (id INTEGER PRIMARY KEY);
        CREATE TABLE palaces (id INTEGER PRIMARY KEY, editor_doc TEXT NOT NULL);
        CREATE TABLE palace_mini_palaces (id INTEGER PRIMARY KEY, palace_id INTEGER NOT NULL);
        CREATE TABLE palace_quiz_questions (
            id INTEGER PRIMARY KEY,
            palace_id INTEGER NOT NULL,
            mini_palace_id INTEGER,
            stem TEXT NOT NULL,
            correct_count INTEGER NOT NULL,
            incorrect_count INTEGER NOT NULL,
            attempt_count INTEGER NOT NULL
        );
        CREATE TABLE session_progress (
            id INTEGER PRIMARY KEY,
            session_kind TEXT NOT NULL
        );
        INSERT INTO palaces VALUES (1, '{"root":{"data":{"text":"大宫殿"}}}');
        INSERT INTO palace_mini_palaces VALUES (9, 1);
        INSERT INTO palace_quiz_questions VALUES (3, 1, 9, '保留的题目', 4, 2, 6);
        INSERT INTO session_progress VALUES (5, 'mini_practice');
        """
    )
    migration.op = _SqliteOp(connection)

    migration.upgrade()

    palace = connection.execute("SELECT editor_doc FROM palaces WHERE id = 1").fetchone()
    question = connection.execute(
        "SELECT palace_id, mini_palace_id, stem, correct_count, incorrect_count, attempt_count "
        "FROM palace_quiz_questions WHERE id = 3"
    ).fetchone()
    mini_count = connection.execute("SELECT COUNT(*) FROM palace_mini_palaces").fetchone()[0]
    mini_progress_count = connection.execute(
        "SELECT COUNT(*) FROM session_progress WHERE session_kind = 'mini_practice'"
    ).fetchone()[0]

    assert palace == ('{"root":{"data":{"text":"大宫殿"}}}',)
    assert question == (1, None, '保留的题目', 4, 2, 6)
    assert mini_count == 0
    assert mini_progress_count == 0
