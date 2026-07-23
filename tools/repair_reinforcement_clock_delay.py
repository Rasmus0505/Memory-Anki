"""Promote legacy clock-delayed 忘记/困难 restudy into immediate batch availability.

Before batch restudy, weak ratings parked on same_day_reinforcement waves with
``available_at = now + 20/60m`` and node ``due_at`` / item ``frozen_effective_due_at``
aligned to that delay (schedule_reason like ``reinforcement_r2_60m``).

Product rule now: weak ratings are immediately available for the next restudy
pass (end of queue / auto-chain). This tool clears residual future timestamps
so those nodes appear in the current freestyle/formal restudy batch.

Usage:
  python tools/repair_reinforcement_clock_delay.py
  python tools/repair_reinforcement_clock_delay.py --palace-id 27
  python tools/repair_reinforcement_clock_delay.py --apply
  python tools/repair_reinforcement_clock_delay.py --apply --palace-id 38 --no-backup
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "apps" / "api" / "src"
if _API_SRC.is_dir():
    sys.path.insert(0, str(_API_SRC))

_LEGACY_REASON = re.compile(r"^reinforcement_r([12])_\d+m$")
_OPEN_WAVE_STATUSES = ("scheduled", "active", "paused")
_PENDING_ITEM_STATUSES = ("pending", "pending_reinforcement")


def _ensure_app_home() -> Path:
    if not os.environ.get("MEMORY_ANKI_HOME"):
        from memory_anki.core.local_config import load_local_runtime_config

        config = load_local_runtime_config()
        os.environ["MEMORY_ANKI_HOME"] = str(config.local_app_home)
    return Path(os.environ["MEMORY_ANKI_HOME"])


def _batch_reason(reason: str | None) -> str | None:
    if not reason:
        return None
    match = _LEGACY_REASON.match(reason)
    if match is None:
        return None
    return f"reinforcement_r{match.group(1)}_batch"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clear legacy 20/60m reinforcement delays for immediate restudy"
    )
    parser.add_argument("--apply", action="store_true", help="Write changes (default dry-run)")
    parser.add_argument("--palace-id", type=int, default=None, help="Limit to one palace")
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip full backup before --apply",
    )
    args = parser.parse_args()

    app_home = _ensure_app_home()
    print(f"MEMORY_ANKI_HOME={app_home}")
    print(f"db={app_home / 'data' / 'memory_palace.db'}")

    from memory_anki.core.time import utc_now_naive
    from memory_anki.infrastructure.db._tables import get_session
    from memory_anki.infrastructure.db._tables.reviews import (
        ReviewNodeState,
        ReviewWave,
        ReviewWaveItem,
    )

    if args.apply and not args.no_backup:
        from memory_anki.modules.backups.application.backup_lifecycle import (
            create_full_backup,
        )

        backup_path = create_full_backup("repair-reinforcement-clock-delay")
        print(f"backup={backup_path}")

    now = utc_now_naive()
    waves_fixed = 0
    nodes_due_fixed = 0
    nodes_reason_fixed = 0
    items_fixed = 0
    by_palace: dict[int, dict[str, int]] = defaultdict(
        lambda: {"waves": 0, "nodes_due": 0, "nodes_reason": 0, "items": 0}
    )

    with get_session() as session:
        wave_query = session.query(ReviewWave).filter(
            ReviewWave.wave_type == "same_day_reinforcement",
            ReviewWave.status.in_(_OPEN_WAVE_STATUSES),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at > now,
        )
        if args.palace_id is not None:
            wave_query = wave_query.filter(ReviewWave.palace_id == args.palace_id)
        for wave in wave_query.all():
            waves_fixed += 1
            by_palace[int(wave.palace_id)]["waves"] += 1
            if args.apply:
                wave.available_at = now
                wave.updated_at = now

        node_query = session.query(ReviewNodeState).filter(
            ReviewNodeState.schedule_source == "reinforcement",
        )
        if args.palace_id is not None:
            node_query = node_query.filter(ReviewNodeState.palace_id == args.palace_id)
        for row in node_query.all():
            palace_id = int(row.palace_id)
            if row.due_at is not None and row.due_at > now:
                nodes_due_fixed += 1
                by_palace[palace_id]["nodes_due"] += 1
                if args.apply:
                    row.due_at = now
                    row.updated_at = now
            batch = _batch_reason(row.schedule_reason)
            if batch is not None and batch != row.schedule_reason:
                nodes_reason_fixed += 1
                by_palace[palace_id]["nodes_reason"] += 1
                if args.apply:
                    row.schedule_reason = batch
                    row.updated_at = now

        item_query = (
            session.query(ReviewWaveItem)
            .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
            .filter(
                ReviewWave.wave_type == "same_day_reinforcement",
                ReviewWave.status.in_(_OPEN_WAVE_STATUSES),
                ReviewWaveItem.status.in_(_PENDING_ITEM_STATUSES),
                ReviewWaveItem.frozen_effective_due_at.is_not(None),
                ReviewWaveItem.frozen_effective_due_at > now,
            )
        )
        if args.palace_id is not None:
            item_query = item_query.filter(ReviewWaveItem.palace_id == args.palace_id)
        for item in item_query.all():
            items_fixed += 1
            by_palace[int(item.palace_id)]["items"] += 1
            if args.apply:
                item.frozen_effective_due_at = now
                item.updated_at = now

        if args.apply and (
            waves_fixed or nodes_due_fixed or nodes_reason_fixed or items_fixed
        ):
            session.commit()

    print(
        "scanned_apply="
        f"{bool(args.apply)} waves_future={waves_fixed} "
        f"nodes_future_due={nodes_due_fixed} "
        f"nodes_legacy_reason={nodes_reason_fixed} "
        f"items_future_effective={items_fixed}"
    )
    for palace_id, counts in sorted(by_palace.items(), key=lambda item: item[0]):
        print(
            f"  palace_id={palace_id} "
            f"waves={counts['waves']} "
            f"nodes_due={counts['nodes_due']} "
            f"nodes_reason={counts['nodes_reason']} "
            f"items={counts['items']}"
        )
    if not args.apply and (
        waves_fixed or nodes_due_fixed or nodes_reason_fixed or items_fixed
    ):
        print("Dry-run only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
