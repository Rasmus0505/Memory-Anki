"""Repair helpers for study time records.

Currently:
- Restore freestyle unit-review durations that were zeroed by mistake
  (original_effective_seconds backup in summary_json).

Usage:
  python tools/repair_time_record_artifacts.py           # dry-run
  python tools/repair_time_record_artifacts.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
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
    parser = argparse.ArgumentParser(description="Repair study time record artifacts")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default is dry-run)",
    )
    args = parser.parse_args()

    app_home = _ensure_app_home()
    print(f"MEMORY_ANKI_HOME={app_home}")
    print(f"db={app_home / 'data' / 'memory_palace.db'}")

    from memory_anki.infrastructure.db._tables import get_session
    from memory_anki.modules.session.application.study_session_bridge import (
        restore_nested_freestyle_review_time_durations,
    )

    with get_session() as session:
        restored = restore_nested_freestyle_review_time_durations(session)
        if args.apply:
            session.commit()
        else:
            session.rollback()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] restored_nested_freestyle_reviews={restored}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
