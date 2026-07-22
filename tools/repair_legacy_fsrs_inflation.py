"""Repair FSRS mastery inflation caused by overdue legacy_estimate seeds.

Usage:
  python tools/repair_legacy_fsrs_inflation.py              # dry-run
  python tools/repair_legacy_fsrs_inflation.py --palace-id 12
  python tools/repair_legacy_fsrs_inflation.py --apply
  python tools/repair_legacy_fsrs_inflation.py --apply --palace-id 12 --no-backup
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "apps" / "api" / "src"
if _API_SRC.is_dir():
    sys.path.insert(0, str(_API_SRC))


def _ensure_app_home() -> Path:
    """Set MEMORY_ANKI_HOME before any DB engine is constructed."""
    if not os.environ.get("MEMORY_ANKI_HOME"):
        from memory_anki.core.local_config import load_local_runtime_config

        config = load_local_runtime_config()
        os.environ["MEMORY_ANKI_HOME"] = str(config.local_app_home)
    return Path(os.environ["MEMORY_ANKI_HOME"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repair inflated FSRS node stability from overdue legacy_estimate seeds"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default is dry-run)",
    )
    parser.add_argument("--palace-id", type=int, default=None, help="Limit to one palace")
    parser.add_argument(
        "--no-normalize-legacy-clocks",
        action="store_true",
        help="Skip rewriting due/last_review on remaining legacy_estimate rows",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip full backup before --apply",
    )
    args = parser.parse_args()

    app_home = _ensure_app_home()
    print(f"MEMORY_ANKI_HOME={app_home}")
    print(f"db={app_home / 'data' / 'memory_palace.db'}")

    # Import DB stack only after MEMORY_ANKI_HOME is set (engine binds at import).
    from memory_anki.infrastructure.db._tables import get_session
    from memory_anki.modules.memory.application.legacy_fsrs_repair import (
        repair_legacy_fsrs_inflation,
    )

    if args.apply and not args.no_backup:
        from memory_anki.modules.backups.application.backup_lifecycle import (
            create_full_backup,
        )

        backup_path = create_full_backup("repair-legacy-fsrs-inflation")
        print(f"backup={backup_path}")

    with get_session() as session:
        report = repair_legacy_fsrs_inflation(
            session,
            palace_id=args.palace_id,
            apply=bool(args.apply),
            normalize_legacy_clocks=not args.no_normalize_legacy_clocks,
        )

    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"[{mode}] still_inflated={report.get('nodes_still_inflated')} "
        f"already_ok={report.get('nodes_already_ok')} "
        f"repaired={report.get('nodes_repaired')} "
        f"ops_undo={report['operations_marked_undone']} "
        f"legacy_clocks={report['legacy_clocks_normalized']}/{report['legacy_clock_candidates']} "
        f"receipts={report['receipts_rewritten']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
