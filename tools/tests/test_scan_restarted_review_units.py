"""The restarted-unit scanner must find real damage and ignore incidental overlap.

The scanner backs a manual repair decision, so a false positive is as costly as a
miss: it would tempt a human into granting progress that was never earned. These
tests pin both directions using synthetic databases, so they never touch real
runtime data.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS = REPO_ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from scan_restarted_review_units import scan  # noqa: E402

SCHEMA = """
CREATE TABLE palaces (id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE review_unit_states (
    id TEXT PRIMARY KEY, palace_id INTEGER, anchor_uid TEXT, unit_kind TEXT,
    node_uids_json TEXT, stage_index INTEGER, has_passed INTEGER,
    due_date TEXT, revision INTEGER, active INTEGER, topology_order INTEGER,
    created_at TEXT, updated_at TEXT
);
"""


def _row(unit_id, uids, *, stage, passed, active, anchor="anchorA", kind="mark"):
    return (
        unit_id, 1, anchor, kind, json.dumps(uids), stage, int(passed),
        "2026-12-06", 1, int(active), 0, "2026-01-01", "2026-01-01",
    )


def _build(path: Path, rows) -> Path:
    connection = sqlite3.connect(path)
    connection.executescript(SCHEMA)
    connection.execute("INSERT INTO palaces VALUES (1, 'Synthetic')")
    connection.executemany(
        "INSERT INTO review_unit_states VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    connection.commit()
    connection.close()
    return path


def test_detects_a_region_restarted_after_its_mark_was_removed(tmp_path):
    """Same region, same identity, retired with earned progress, re-created at 0."""
    uids = [f"node{index:03d}" for index in range(8)]
    db = _build(
        tmp_path / "damaged.db",
        [
            _row("retired", uids, stage=6, passed=True, active=False),
            _row("restarted", uids, stage=0, passed=False, active=True),
        ],
    )

    report = scan(db)

    assert report["suspect_count"] == 1
    suspect = report["suspects"][0]
    assert suspect["unit_id"] == "restarted"
    assert suspect["suggested_stage_index"] == 6
    assert suspect["confidence"] == "exact_identity"


def test_ignores_incidental_overlap_with_an_unrelated_retired_unit(tmp_path):
    """One shared uid is contact, not a restart: do not credit unearned progress."""
    retired = ["shared", *[f"old{index}" for index in range(6)]]
    current = ["shared", *[f"new{index}" for index in range(9)]]
    db = _build(
        tmp_path / "incidental.db",
        [
            _row("retired", retired, stage=5, passed=True, active=False),
            _row("current", current, stage=0, passed=False, active=True),
        ],
    )

    report = scan(db)

    assert report["suspect_count"] == 0


def test_ignores_a_healthy_unit_that_kept_its_progress(tmp_path):
    uids = [f"node{index:03d}" for index in range(5)]
    db = _build(
        tmp_path / "healthy.db",
        [_row("healthy", uids, stage=4, passed=True, active=True)],
    )

    report = scan(db)

    assert report["suspect_count"] == 0
