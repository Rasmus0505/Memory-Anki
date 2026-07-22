"""Repair FSRS cards that got short Good/Easy intervals (learning steps).

Before ensure_strong_rating_due, rating 记得 on Learning cards could schedule
~1 hour later. Those nodes stay due forever relative to multi-day policy.

Usage:
  python tools/repair_short_good_intervals.py
  python tools/repair_short_good_intervals.py --palace-id 14
  python tools/repair_short_good_intervals.py --apply
  python tools/repair_short_good_intervals.py --apply --palace-id 14 --no-backup
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "apps" / "api" / "src"
if _API_SRC.is_dir():
    sys.path.insert(0, str(_API_SRC))


def _ensure_app_home() -> Path:
    if not os.environ.get("MEMORY_ANKI_HOME"):
        from memory_anki.core.local_config import load_local_runtime_config

        config = load_local_runtime_config()
        os.environ["MEMORY_ANKI_HOME"] = str(config.local_app_home)
    return Path(os.environ["MEMORY_ANKI_HOME"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Floor short Good/Easy FSRS intervals to product minimums"
    )
    parser.add_argument("--apply", action="store_true", help="Write changes (default dry-run)")
    parser.add_argument("--palace-id", type=int, default=None, help="Limit to one palace")
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip full backup before --apply",
    )
    parser.add_argument(
        "--max-interval-hours",
        type=float,
        default=23.0,
        help="Treat intervals shorter than this as under-floored (default 23h)",
    )
    args = parser.parse_args()

    app_home = _ensure_app_home()
    print(f"MEMORY_ANKI_HOME={app_home}")
    print(f"db={app_home / 'data' / 'memory_palace.db'}")

    from memory_anki.infrastructure.db._tables import get_session
    from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
    from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
    from memory_anki.modules.reviews.application.fsrs_runtime import (
        STRONG_EASY_MIN_INTERVAL,
        STRONG_GOOD_MIN_INTERVAL,
    )

    if args.apply and not args.no_backup:
        from memory_anki.modules.backups.application.backup_lifecycle import (
            create_full_backup,
        )

        backup_path = create_full_backup("repair-short-good-intervals")
        print(f"backup={backup_path}")

    threshold = timedelta(hours=float(args.max_interval_hours))
    by_palace: dict[int, int] = defaultdict(int)
    changed = 0
    scanned = 0

    with get_session() as session:
        query = session.query(ReviewNodeState).filter(
            ReviewNodeState.last_review_at.is_not(None),
            ReviewNodeState.due_at.is_not(None),
        )
        if args.palace_id is not None:
            query = query.filter(ReviewNodeState.palace_id == args.palace_id)
        rows = query.all()
        for row in rows:
            scanned += 1
            assert row.last_review_at is not None and row.due_at is not None
            interval = row.due_at - row.last_review_at
            if interval >= threshold:
                continue
            # Prefer latest recall event for this node when available.
            event = (
                session.query(MindMapRecallEvent)
                .filter(
                    MindMapRecallEvent.palace_id == row.palace_id,
                    MindMapRecallEvent.node_uid == row.node_uid,
                )
                .order_by(
                    MindMapRecallEvent.occurred_at.desc(),
                    MindMapRecallEvent.created_at.desc(),
                )
                .first()
            )
            rating = int(event.rating) if event is not None else 3
            # Map legacy 5 -> good if present.
            if rating == 5:
                rating = 3
            if rating not in (3, 4):
                # Weak ratings intentionally use short caps; leave them alone.
                continue
            floor = STRONG_EASY_MIN_INTERVAL if rating == 4 else STRONG_GOOD_MIN_INTERVAL
            target_due = row.last_review_at + floor
            if row.due_at >= target_due:
                continue
            by_palace[int(row.palace_id)] += 1
            changed += 1
            if args.apply:
                row.due_at = target_due

        if args.apply and changed:
            session.commit()

    print(f"scanned={scanned} candidates={changed} apply={bool(args.apply)}")
    for palace_id, count in sorted(by_palace.items(), key=lambda item: (-item[1], item[0])):
        print(f"  palace_id={palace_id} nodes={count}")
    if not args.apply and changed:
        print("Dry-run only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
