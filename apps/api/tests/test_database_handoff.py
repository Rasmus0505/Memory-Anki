"""The experimental handoff layer is disabled and decoupled from the runtime.

These tests pin the isolation contract, not a never-validated migration: the CLI
refuses every command, and the app resolves the database under the requested
home without consulting device-local placement.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[3] / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import database_handoff as handoff  # noqa: E402

from memory_anki.core.runtime_paths import (  # noqa: E402
    database_file_path,
    resolve_database_file,
    resolve_existing_database_file,
)

SRC = Path(__file__).resolve().parents[1] / "src" / "memory_anki"


@pytest.mark.parametrize(
    "command",
    [
        ["status"],
        ["migrate-to-local"],
        ["verify", "snapshot.zip"],
        ["export", "snapshot.zip", "--to-device", "0" * 32],
        ["import", "snapshot.zip"],
    ],
)
def test_cli_refuses_every_command(command, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setenv("MEMORY_ANKI_HOME", str(tmp_path / "home"))

    assert handoff.main(command) == 2

    err = capsys.readouterr().err
    assert "已默认停用" in err
    # Refusal must not create a device id, placement marker, lock or database.
    assert list(tmp_path.rglob("*")) == []


def test_runtime_never_consults_local_placement(tmp_path, monkeypatch):
    # Even with a placement marker and a live directory present, resolution stays
    # on the requested home: a maintenance tool must not land on another DB.
    root = tmp_path / "device" / "database-handoff"
    (root / "live").mkdir(parents=True)
    (root / "placement-enabled").write_text("sqlite-handoff-v1\n", encoding="ascii")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "device"))

    first = tmp_path / "app-a"
    second = tmp_path / "app-b"
    assert resolve_database_file(first) == database_file_path(first)
    assert resolve_database_file(second) == database_file_path(second)
    assert resolve_database_file(first) != resolve_database_file(second)


def test_existing_database_prefers_learning_root_then_legacy_data(tmp_path):
    home = tmp_path / "home"
    preferred = database_file_path(home)
    assert resolve_existing_database_file(home) == preferred

    preferred.parent.mkdir(parents=True)
    preferred.write_bytes(b"")
    assert resolve_existing_database_file(home) == preferred

    preferred.unlink()
    legacy = home / "data" / preferred.name
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"")
    assert resolve_existing_database_file(home) == legacy


def test_app_startup_does_not_import_the_placement_layer():
    for name in ("app/main.py", "app/startup_runtime.py", "core/config.py"):
        assert "database_placement" not in (SRC / name).read_text(encoding="utf-8")
    assert handoff.HANDOFF_WORKFLOW_ENABLED is False
