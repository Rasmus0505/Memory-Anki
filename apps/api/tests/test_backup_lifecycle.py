"""backups lifecycle tests isolated to tmp_path."""
import json
import os
import sqlite3
from datetime import timedelta

import pytest

from memory_anki.modules.backups.application import backup_lifecycle, storage_backup
from memory_anki.modules.backups.presentation import router as backups_router

_DB_MARKER = "backup-marker"


def _write_marker_db(path, marker: str) -> None:
    if path.exists():
        path.unlink()
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE marker(value TEXT NOT NULL)")
        connection.execute("INSERT INTO marker(value) VALUES (?)", (marker,))
        connection.commit()
    finally:
        connection.close()


def _read_marker(path) -> str:
    connection = sqlite3.connect(path)
    try:
        row = connection.execute("SELECT value FROM marker").fetchone()
    finally:
        connection.close()
    assert row is not None
    return row[0]


@pytest.fixture()
def backup_env(tmp_path, monkeypatch):
    from memory_anki.core.config import STORAGE_ROOT_CACHE, STORAGE_ROOT_LEARNING

    app_home = tmp_path / "home"
    backups = app_home / STORAGE_ROOT_CACHE / "backups"
    full_dir = backups / "full"
    rolling_dir = backups / "rolling"
    rescue_dir = backups / "rescue"
    db_path = app_home / STORAGE_ROOT_LEARNING / "memory_palace.db"
    for folder in (full_dir, rolling_dir, rescue_dir, db_path.parent):
        folder.mkdir(parents=True, exist_ok=True)
    _write_marker_db(db_path, _DB_MARKER)

    monkeypatch.setattr(storage_backup, "APP_HOME", app_home)
    monkeypatch.setattr(storage_backup, "BACKUPS_DIR", backups)
    monkeypatch.setattr(storage_backup, "DB_PATH", db_path)
    monkeypatch.setattr(backup_lifecycle, "DB_PATH", db_path)
    monkeypatch.setattr(backup_lifecycle, "FULL_BACKUPS_DIR", full_dir)
    monkeypatch.setattr(backup_lifecycle, "ROLLING_BACKUPS_DIR", rolling_dir)
    monkeypatch.setattr(backup_lifecycle, "RESCUE_BACKUPS_DIR", rescue_dir)
    monkeypatch.setattr(backups_router, "list_backups", backup_lifecycle.list_backups)
    monkeypatch.setattr(
        backups_router,
        "create_rolling_backup",
        backup_lifecycle.create_rolling_backup,
    )
    monkeypatch.setattr(
        backups_router,
        "restore_database_backup",
        backup_lifecycle.restore_database_backup,
    )
    monkeypatch.setattr(storage_backup, "ensure_runtime_dirs", lambda: None)
    monkeypatch.setattr(storage_backup, "checkpoint_sqlite_wal", lambda **kwargs: None)
    monkeypatch.setattr(backup_lifecycle, "analyze_database", lambda: None)
    return {
        "app_home": app_home,
        "full": full_dir,
        "rolling": rolling_dir,
        "rescue": rescue_dir,
        "db": db_path,
    }


def test_create_full_backup_writes_manifest_and_db(backup_env):
    folder = backup_lifecycle.create_full_backup("unit-test")

    assert folder.parent == backup_env["full"]
    assert (folder / "manifest.json").exists()
    assert _read_marker(folder / "学习数据" / "memory_palace.db") == _DB_MARKER
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest.get("full") is True
    assert manifest.get("scope") == "full"


def test_create_rolling_backup_uses_rolling_dir_and_light_scope(backup_env):
    folder = backup_lifecycle.create_rolling_backup("rolling-unit")

    assert folder.parent == backup_env["rolling"]
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest.get("full") is False
    assert manifest.get("scope") == "rolling"
    included = {item["key"] for item in manifest["included_items"]}
    assert {"database", "migration_state"} <= included
    assert "attachments" not in included
    assert _read_marker(folder / "学习数据" / "memory_palace.db") == _DB_MARKER


def test_create_rescue_snapshot_includes_attachments(backup_env):
    folder = backup_lifecycle.create_rescue_snapshot("before-test")

    assert folder.parent == backup_env["rescue"]
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest.get("full") is False
    assert manifest.get("scope") == "rescue"
    included = {item["key"] for item in manifest["included_items"]}
    assert {"database", "attachments", "migration_state"} <= included
    assert "time_ledger" not in included


def test_list_backups_reads_created_folder(backup_env):
    backup_lifecycle.create_full_backup("unit-test")

    items = backup_lifecycle.list_backups()

    assert len(items) == 1
    assert items[0]["kind"] == "full"
    assert items[0]["reason"] == "unit-test"
    assert items[0]["has_database"] is True
    assert "database" in items[0]["included_items"]


def test_list_backups_includes_rolling_kind(backup_env):
    backup_lifecycle.create_rolling_backup("rolling-unit")
    items = backup_lifecycle.list_backups()
    assert any(item["kind"] == "rolling" for item in items)


def test_list_backups_uses_manifest_database_relative_path(backup_env):
    folder = backup_env["full"] / "manual-backup"
    db_file = folder / "snapshot" / "custom.sqlite"
    db_file.parent.mkdir(parents=True)
    db_file.write_bytes(b"db")
    manifest = {
        "created_at": "2026-07-09T12:00:00",
        "database": {"relative_path": "snapshot/custom.sqlite"},
        "included_items": [],
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )

    items = backup_lifecycle.list_backups()

    assert len(items) == 1
    assert items[0]["has_database"] is True


def test_restore_database_backup_returns_rescue_and_restores(backup_env, monkeypatch):
    monkeypatch.setattr(
        backup_lifecycle,
        "assert_exclusive_runtime_operation",
        lambda *args, **kwargs: None,
    )
    folder = backup_lifecycle.create_full_backup("unit-test")
    backup_env["db"].write_bytes(b"corrupted")

    rescue = backup_lifecycle.restore_database_backup(str(folder))

    assert rescue.parent == backup_env["rescue"]
    assert _read_marker(backup_env["db"]) == _DB_MARKER


def test_restore_missing_backup_raises(backup_env):
    with pytest.raises(FileNotFoundError):
        backup_lifecycle.restore_database_backup(str(backup_env["app_home"] / "nope"))


def test_restore_missing_backup_route_returns_400(backup_env, make_client):
    client = make_client(backups_router)

    response = client.post(
        "/api/v1/backups/restore-database",
        json={"path": str(backup_env["app_home"] / "nope")},
    )

    assert response.status_code == 400
    assert "数据库快照" in response.json()["detail"]


def test_prune_old_backups_keeps_newest_directories(tmp_path):
    root = tmp_path / "backups"
    root.mkdir()
    for index in range(4):
        folder = root / f"backup-{index}"
        folder.mkdir()
        os.utime(folder, (index, index))

    removed = backup_lifecycle.prune_old_backups(root, keep=2)

    assert removed == 2
    assert {child.name for child in root.iterdir()} == {"backup-2", "backup-3"}


def test_rolling_and_full_pruned_separately(backup_env, monkeypatch):
    monkeypatch.setattr(backup_lifecycle, "MAX_FULL_BACKUPS", 2)
    monkeypatch.setattr(backup_lifecycle, "MAX_ROLLING_BACKUPS", 2)
    counter = {"n": 0}

    def unique_slug(now=None):
        counter["n"] += 1
        return f"20260721-10000{counter['n']}"

    monkeypatch.setattr(backup_lifecycle, "timestamp_slug", unique_slug)

    for _ in range(3):
        backup_lifecycle.create_full_backup("full")
        backup_lifecycle.create_rolling_backup("rolling")

    assert len(list(backup_env["full"].iterdir())) == 2
    assert len(list(backup_env["rolling"].iterdir())) == 2


def test_daily_full_backup_exists_ignores_rolling_only(backup_env):
    backup_lifecycle.create_rolling_backup("rolling-only")
    assert backup_lifecycle._daily_full_backup_exists() is False

    backup_lifecycle.create_full_backup("startup")
    assert backup_lifecycle._daily_full_backup_exists() is True


def test_periodic_and_shutdown_use_rolling(backup_env, monkeypatch):
    monkeypatch.setattr(backup_lifecycle, "AUTO_ROLLING_BACKUP_INTERVAL", timedelta(seconds=0))
    periodic = backup_lifecycle.maybe_create_periodic_backup()
    shutdown = backup_lifecycle.create_shutdown_backup()

    assert periodic is not None
    assert periodic.parent == backup_env["rolling"]
    assert shutdown is not None
    assert shutdown.parent == backup_env["rolling"]
    assert not any(backup_env["full"].iterdir())


def test_backups_route_lists_tmp_backups(backup_env, make_client):
    backup_lifecycle.create_full_backup("unit-test")
    client = make_client(backups_router)

    response = client.get("/api/v1/backups")

    assert response.status_code == 200
    assert response.json()["items"][0]["reason"] == "unit-test"


def test_ensure_daily_backup_writes_rolling_not_full(backup_env):
    folder = backup_lifecycle.ensure_daily_backup()

    assert folder is not None
    assert folder.parent == backup_env["rolling"]
    assert not any(backup_env["full"].iterdir())
    assert backup_lifecycle.ensure_daily_backup() is None


def test_create_backup_route_writes_rolling(backup_env, make_client):
    client = make_client(backups_router)

    response = client.post("/api/v1/backups/create", json={"reason": "manual"})

    assert response.status_code == 200
    items = backup_lifecycle.list_backups()
    assert len(items) == 1
    assert items[0]["kind"] == "rolling"
    assert items[0]["reason"] == "manual"
    assert not any(backup_env["full"].iterdir())


def test_request_rolling_backup_is_single_flight(backup_env, monkeypatch):
    import threading

    started = threading.Event()
    release = threading.Event()
    calls: list[str] = []

    def slow_backup(reason, minimum_interval, *, wait_seconds=None):
        calls.append(reason)
        started.set()
        release.wait(5)
        return None

    monkeypatch.setattr(backup_lifecycle, "_create_rolling_backup_if_due", slow_backup)
    assert backup_lifecycle.request_rolling_backup("a") is True
    assert started.wait(5)
    assert backup_lifecycle.request_rolling_backup("b") is False
    assert backup_lifecycle.maybe_create_rolling_backup("c") is None
    release.set()
    for _ in range(100):
        if not backup_lifecycle._ROLLING_REQUEST_RUNNING:
            break
        threading.Event().wait(0.05)
    assert calls == ["a"]
    assert backup_lifecycle.request_rolling_backup("d") is True
    threading.Event().wait(0.2)


def test_stale_staging_is_not_a_backup_and_is_cleaned(backup_env):
    stale = backup_env["rolling"] / ".backup-stage-crashed"
    stale.mkdir()
    (stale / "junk.db").write_bytes(b"x")
    nested = storage_backup.staging_root() / ".backup-stage-old"
    nested.mkdir(parents=True)

    assert backup_lifecycle._latest_backup_in(backup_env["rolling"]) is None
    assert backup_lifecycle._daily_rolling_backup_exists() is False
    assert backup_lifecycle.list_backups() == []

    assert backup_lifecycle.cleanup_stale_backup_staging() == 2
    assert not stale.exists()
    assert not nested.exists()


def test_backup_stage_lives_outside_rolling_dir(backup_env, monkeypatch):
    seen: list = []
    real = storage_backup.tempfile.TemporaryDirectory

    def spy(*args, **kwargs):
        seen.append(kwargs.get("dir"))
        return real(*args, **kwargs)

    monkeypatch.setattr(storage_backup.tempfile, "TemporaryDirectory", spy)
    backup_lifecycle.create_rolling_backup("stage-location")
    assert seen == [storage_backup.staging_root()]
    assert not any(p.name.startswith(".") for p in backup_env["rolling"].iterdir())


def test_restore_removes_stale_wal_and_shm(backup_env):
    folder = backup_lifecycle.create_rolling_backup("before")
    db = backup_env["db"]
    _write_marker_db(db, "changed")
    wal = db.with_name(db.name + "-wal")
    shm = db.with_name(db.name + "-shm")
    wal.write_bytes(b"stale-wal")
    shm.write_bytes(b"stale-shm")

    storage_backup.restore_storage_backup(folder)

    assert _read_marker(db) == _DB_MARKER
    assert not wal.exists()
    assert not shm.exists()


def test_online_backup_gives_up_after_duration_cap(backup_env, monkeypatch):
    db = backup_env["db"]
    connection = sqlite3.connect(db)
    connection.execute("CREATE TABLE bulk(v BLOB)")
    connection.executemany("INSERT INTO bulk VALUES (?)", [(b"x" * 4000,)] * 500)
    connection.commit()
    connection.close()
    monkeypatch.setattr(storage_backup, "_ONLINE_BACKUP_PAGES", 1)
    monkeypatch.setattr(storage_backup, "_ONLINE_BACKUP_MAX_SECONDS", -1.0)

    with pytest.raises(storage_backup.BackupTooSlowError):
        storage_backup._sqlite_online_backup(db, backup_env["app_home"] / "out.db")


def test_bounded_shutdown_backup_stops_waiting(backup_env, monkeypatch):
    import threading

    release = threading.Event()
    monkeypatch.setattr(
        backup_lifecycle, "create_shutdown_backup", lambda: release.wait(5) and None
    )
    assert backup_lifecycle.run_shutdown_backup_bounded(0.05) is False
    release.set()
