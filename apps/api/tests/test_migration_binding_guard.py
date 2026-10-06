from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from alembic.config import Config

from memory_anki.infrastructure.db import migrations
from memory_anki.infrastructure.db.migration_binding_guard import (
    BINDING_REVISION,
    ensure_binding_migration_safe,
)


def _config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
    return config


def _database(tmp_path: Path, bindings=(), revisions=("0066_quiz_practice_progress",)) -> Path:
    path = tmp_path / "isolated.db"
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript(
            "CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY);"
            "CREATE TABLE palace_quiz_questions (id INTEGER PRIMARY KEY, palace_id INTEGER);"
            "CREATE TABLE palace_quiz_question_node_bindings "
            "(id INTEGER PRIMARY KEY, question_id INTEGER, palace_id INTEGER, node_uid TEXT);"
            "INSERT INTO palace_quiz_questions VALUES (1, 10), (2, NULL);"
        )
        conn.executemany("INSERT INTO alembic_version VALUES (?)", [(r,) for r in revisions])
        conn.executemany("INSERT INTO palace_quiz_question_node_bindings VALUES (?, ?, ?, ?)", bindings)
        conn.commit()
    return path


@pytest.mark.parametrize(
    ("bindings", "message"),
    [
        ([(1, 1, 20, "node")], "1 cross-palace binding(s) and 0 additional"),
        ([(1, 2, 10, "node"), (2, 2, 20, "node")], "0 cross-palace binding(s) and 1 additional"),
        ([(1, 1, 20, "node"), (2, 1, 10, "node")], "1 cross-palace binding(s) and 0 additional"),
    ],
)
def test_guard_refuses_deletion_without_mutating_database(tmp_path, bindings, message):
    path = _database(tmp_path, bindings)
    before = path.read_bytes()
    with pytest.raises(RuntimeError) as error:
        ensure_binding_migration_safe(_config(), path)
    assert message in str(error.value)
    assert "explicit user decision" in str(error.value)
    assert path.read_bytes() == before


def test_guard_refuses_deletion_in_unversioned_database(tmp_path):
    path = _database(tmp_path, [(1, 1, 20, "node")], revisions=())
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("DROP TABLE alembic_version")
        conn.commit()
    with pytest.raises(RuntimeError, match="blocked to preserve quiz bindings"):
        ensure_binding_migration_safe(_config(), path)


def test_guard_allows_clean_bindings_without_mutation(tmp_path):
    path = _database(tmp_path, [(1, 1, 10, "node"), (2, 2, 20, "node")])
    before = path.read_bytes()
    ensure_binding_migration_safe(_config(), path)
    assert path.read_bytes() == before


@pytest.mark.parametrize("revisions", [("0067_merge_quiz_heads",), ("0066_quiz_practice_progress", BINDING_REVISION)])
def test_guard_skips_binding_revision_already_applied(tmp_path, revisions):
    path = _database(tmp_path, [(1, 1, 20, "node")], revisions)
    ensure_binding_migration_safe(_config(), path)


def test_guard_does_not_create_absent_database(tmp_path):
    path = tmp_path / "absent.db"
    ensure_binding_migration_safe(_config(), path)
    assert not path.exists()


def test_guard_allows_empty_database_without_bindings(tmp_path):
    path = tmp_path / "empty.db"
    path.touch()
    ensure_binding_migration_safe(_config(), path)
    assert path.stat().st_size == 0


def test_guard_fails_closed_on_uninspectable_schema(tmp_path):
    path = _database(tmp_path)
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("DROP TABLE palace_quiz_questions")
        conn.commit()
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="Cannot safely inspect bindings"):
        ensure_binding_migration_safe(_config(), path)
    assert path.read_bytes() == before


def test_guard_fails_closed_on_invalid_database(tmp_path):
    path = tmp_path / "invalid.db"
    path.write_bytes(b"not a database")
    with pytest.raises(RuntimeError, match="Cannot safely inspect bindings"):
        ensure_binding_migration_safe(_config(), path)


def test_runner_refuses_upgrade_when_binding_guard_blocks(tmp_path, monkeypatch):
    path = _database(tmp_path, [(1, 1, 20, "node")])
    monkeypatch.setattr("memory_anki.core.config.DB_PATH", path)
    monkeypatch.setattr(migrations, "build_alembic_config", _config)
    calls = []
    monkeypatch.setattr(migrations.command, "upgrade", lambda *args: calls.append(args))
    with pytest.raises(RuntimeError, match="blocked to preserve quiz bindings"):
        migrations.run_migrations()
    assert calls == []


def test_runner_only_upgrades_after_clean_preflight(tmp_path, monkeypatch):
    path = _database(tmp_path, [(1, 1, 10, "node")])
    monkeypatch.setattr("memory_anki.core.config.DB_PATH", path)
    monkeypatch.setattr(migrations, "build_alembic_config", _config)
    calls = []
    monkeypatch.setattr(migrations.command, "upgrade", lambda *args: calls.append(args))
    migrations.run_migrations()
    assert len(calls) == 1
    assert calls[0][1] == "head"
