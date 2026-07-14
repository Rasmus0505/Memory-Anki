from __future__ import annotations

import sqlite3
from pathlib import Path

from tools.data_integrity_manifest import build_manifest, compare_manifests


def create_runtime_home(root: Path) -> Path:
    home = root / "runtime"
    database = home / "data" / "memory_palace.db"
    database.parent.mkdir(parents=True)
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
        connection.execute("INSERT INTO config VALUES ('timer', '25')")
        connection.execute("INSERT INTO notes(body) VALUES ('保留数据')")
        connection.commit()
    attachment = home / "data" / "attachments" / "example.txt"
    attachment.parent.mkdir(parents=True)
    attachment.write_text("attachment", encoding="utf-8")
    return home


def test_manifest_captures_database_and_files(tmp_path: Path) -> None:
    manifest = build_manifest(create_runtime_home(tmp_path))
    assert manifest["database"]["integrityCheck"] == ["ok"]
    assert manifest["database"]["foreignKeyCheck"] == []
    assert manifest["database"]["tables"]["config"]["rowCount"] == 1
    assert manifest["database"]["tables"]["notes"]["rowCount"] == 1
    assert manifest["files"]["data/attachments/example.txt"]["size"] == 10


def test_consistent_snapshot_includes_wal_state(tmp_path: Path) -> None:
    home = create_runtime_home(tmp_path)
    writer = sqlite3.connect(home / "data" / "memory_palace.db")
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("INSERT INTO notes(body) VALUES ('WAL 中的数据')")
    writer.commit()
    manifest = build_manifest(home, tmp_path / "snapshot")
    writer.close()
    assert manifest["database"]["tables"]["notes"]["rowCount"] == 2
    assert (tmp_path / "snapshot" / "memory_palace.db").exists()


def test_compare_manifests_reports_changes(tmp_path: Path) -> None:
    home = create_runtime_home(tmp_path)
    before = build_manifest(home)
    with sqlite3.connect(home / "data" / "memory_palace.db") as connection:
        connection.execute("UPDATE config SET value='30' WHERE key='timer'")
        connection.commit()
    (home / "data" / "attachments" / "example.txt").write_text("changed", encoding="utf-8")
    differences = compare_manifests(before, build_manifest(home))
    assert "database table changed: config" in differences
    assert "file changed: data/attachments/example.txt" in differences