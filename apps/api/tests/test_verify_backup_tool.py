import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "tools" / "verify_backup.py"


def _make_fake_backup(tmp_path: Path) -> Path:
    backup_dir = tmp_path / "home" / "data" / "backups" / "full" / "20260101-000000-test"
    backup_data_dir = backup_dir / "data"
    backup_data_dir.mkdir(parents=True)
    db_file = backup_data_dir / "memory_palace.db"
    with sqlite3.connect(db_file) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num TEXT)")
        conn.execute("INSERT INTO alembic_version VALUES ('0012_freestyle_history')")
        conn.execute("CREATE TABLE palaces (id INTEGER PRIMARY KEY, title TEXT)")
        conn.execute("INSERT INTO palaces (title) VALUES ('t1')")
        conn.commit()
    manifest = {
        "included_items": [
            {
                "key": "database",
                "relative_path": "data/memory_palace.db",
                "kind": "file",
                "included": True,
            }
        ]
    }
    (backup_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False),
        encoding="utf-8",
    )
    return backup_dir


def test_verify_backup_pass_on_valid_backup(tmp_path, monkeypatch):
    app_home = tmp_path / "home"
    monkeypatch.setenv("MEMORY_ANKI_HOME", str(app_home))
    backup_dir = _make_fake_backup(tmp_path)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(backup_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    reports = list((app_home / "backup-verify-reports").glob("verify-*.json"))

    assert result.returncode == 0, result.stdout + result.stderr
    assert "[PASS]" in result.stdout
    assert reports


def test_verify_backup_fails_without_db(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ANKI_HOME", str(tmp_path / "home"))
    empty_dir = tmp_path / "empty-backup"
    empty_dir.mkdir()
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(empty_dir)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "[FAIL]" in result.stdout


def test_verify_backup_reports_corrupt_database(tmp_path, monkeypatch):
    app_home = tmp_path / "home"
    monkeypatch.setenv("MEMORY_ANKI_HOME", str(app_home))
    backup_dir = app_home / "data" / "backups" / "full" / "20260101-000000-bad"
    backup_data_dir = backup_dir / "data"
    backup_data_dir.mkdir(parents=True)
    (backup_data_dir / "memory_palace.db").write_bytes(b"not a sqlite database")
    (backup_dir / "manifest.json").write_text(
        json.dumps(
            {
                "included_items": [
                    {
                        "key": "database",
                        "relative_path": "data/memory_palace.db",
                        "kind": "file",
                        "included": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(backup_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    reports = list((app_home / "backup-verify-reports").glob("verify-*.json"))

    assert result.returncode == 1
    assert "[FAIL]" in result.stdout
    assert reports


def test_verify_backup_auto_selects_latest_manifest_database(tmp_path, monkeypatch):
    app_home = tmp_path / "home"
    monkeypatch.setenv("MEMORY_ANKI_HOME", str(app_home))
    backup_dir = _make_fake_backup(tmp_path)
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert backup_dir.name in result.stdout
    assert str(backup_dir / "data" / "memory_palace.db") in result.stdout
