from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from memory_anki.infrastructure.time_ledger_store import (
    append_revision,
    delete_intervals,
    patch_interval,
    read_intervals,
)
from memory_anki.modules.session.domain.time_ledger import TimeLedgerInterval, TimeLedgerUpload


def test_ledger_writes_immutable_revision_and_deduplicates(tmp_path: Path):
    start = datetime.now(UTC) - timedelta(minutes=5)
    interval = TimeLedgerInterval(
        interval_id="session-1:0:1", session_id="session-1",
        started_at=start, ended_at=start + timedelta(seconds=60), kind="english_reading",
    )
    upload = TimeLedgerUpload(intervals=[interval])
    first = append_revision(upload, app_home=tmp_path, device_id="device-a")
    second = append_revision(upload, app_home=tmp_path, device_id="device-a")
    assert first["revision_id"] != second["revision_id"]
    rows = read_intervals(app_home=tmp_path)
    assert len(rows) == 1
    assert rows[0]["effective_seconds"] == 60
    assert rows[0]["device_id"] == "device-a"


def test_ledger_keeps_distinct_devices_and_extended_interval_as_union(tmp_path: Path):
    start = datetime(2026, 1, 1, 23, 59, 30, tzinfo=UTC)
    first = TimeLedgerInterval(
        interval_id="device-a:1", session_id="a", started_at=start,
        ended_at=start + timedelta(seconds=90), kind="review",
    )
    extended = TimeLedgerInterval(
        interval_id="device-a:2", session_id="a", started_at=start,
        ended_at=start + timedelta(seconds=150), kind="review",
    )
    other = TimeLedgerInterval(
        interval_id="device-b:1", session_id="b", started_at=start + timedelta(seconds=30),
        ended_at=start + timedelta(seconds=120), kind="english_reading",
    )
    append_revision(TimeLedgerUpload(intervals=[first]), app_home=tmp_path, device_id="device-a")
    append_revision(TimeLedgerUpload(intervals=[extended]), app_home=tmp_path, device_id="device-a")
    append_revision(TimeLedgerUpload(intervals=[other]), app_home=tmp_path, device_id="device-b")
    rows = read_intervals(app_home=tmp_path)
    assert {row["device_id"] for row in rows} == {"device-a", "device-b"}
    assert {row["interval_id"] for row in rows} == {"device-a:1", "device-a:2", "device-b:1"}
    assert max(row["effective_seconds"] for row in rows) == 150


def test_patch_replaces_growing_group_and_delete_stays_deleted(tmp_path: Path):
    start = datetime.now(UTC) - timedelta(minutes=5)
    short = TimeLedgerInterval(interval_id="s:1:60", session_id="s", started_at=start,
                               ended_at=start + timedelta(seconds=60), kind="review")
    long = TimeLedgerInterval(interval_id="s:1:120", session_id="s", started_at=start,
                              ended_at=start + timedelta(seconds=120), kind="review")
    append_revision(TimeLedgerUpload(intervals=[short]), app_home=tmp_path, device_id="d")
    append_revision(TimeLedgerUpload(intervals=[long]), app_home=tmp_path, device_id="d")
    patched = patch_interval("s:1:120", {"title": "edited"}, app_home=tmp_path, device_id="d")
    assert patched is not None
    visible = read_intervals(app_home=tmp_path)
    assert len(visible) == 1
    assert visible[0]["title"] == "edited"
    patched_again = patch_interval("s:1:120", {"title": "edited twice"}, app_home=tmp_path, device_id="d")
    assert patched_again is not None
    assert read_intervals(app_home=tmp_path)[0]["title"] == "edited twice"
    assert delete_intervals(["s:1:120"], app_home=tmp_path, device_id="d") == 1
    assert read_intervals(app_home=tmp_path) == []
    assert read_intervals(app_home=tmp_path, include_deleted=True)


def test_naive_interval_timestamps_are_rejected(tmp_path: Path):
    """An offset-less instant cannot be placed on a calendar; guessing shifted records."""
    naive_start = datetime(2026, 1, 1, 12, 0, 0)
    interval = TimeLedgerInterval(
        interval_id="naive", session_id="naive", started_at=naive_start,
        ended_at=naive_start + timedelta(seconds=60), kind="review",
    )
    with pytest.raises(ValueError, match="UTC offset"):
        interval.normalized()


def test_explicitly_offset_interval_is_accepted_and_normalised_to_utc():
    local = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone(timedelta(hours=8)))
    interval = TimeLedgerInterval(
        interval_id="offset", session_id="offset", started_at=local,
        ended_at=local + timedelta(seconds=60), kind="review",
    )
    normalised = interval.normalized()
    assert normalised.started_at == datetime(2026, 1, 1, 4, 0, 0, tzinfo=UTC)
    assert normalised.effective_seconds == 60


def test_invalid_group_operation_revision_is_ignored_atomically(tmp_path: Path):
    start = datetime.now(UTC) - timedelta(minutes=5)
    interval = TimeLedgerInterval(interval_id="valid", session_id="valid", started_at=start,
                                  ended_at=start + timedelta(seconds=30), kind="review")
    append_revision(TimeLedgerUpload(intervals=[interval]), app_home=tmp_path, device_id="d")
    revisions = list((tmp_path / "学习数据" / "time-ledger" / "devices" / "d" / "revisions").glob("*.json"))
    payload = {
        "schema_version": 1,
        "revision_id": "bad-revision",
        "device_id": "d",
        "created_at": datetime.now(UTC).isoformat(),
        "intervals": [],
        "tombstones": ["valid"],
        "group_operations": [
            {"group": json.dumps(["valid", start.isoformat()], separators=(",", ":")), "deleted": True},
            {"group": "invalid-replacement", "replacement": {"started_at": "not-a-date"}},
        ],
    }
    (revisions[0].parent / "bad-revision.json").write_text(json.dumps(payload), encoding="utf-8")
    rows = read_intervals(app_home=tmp_path)
    assert [row["interval_id"] for row in rows] == ["valid"]
