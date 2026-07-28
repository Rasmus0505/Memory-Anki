"""Repair helpers for study time records.

Repairs (default dry-run; pass --apply to commit):
- Restore freestyle nested review durations zeroed by mistake
- Demote historical autosave checkpoints still marked completed
- Reclassify ghost formal-review timer rows to practice
- Cap or demote overnight / PWA background hang-up inflated sessions
- Abandon stale active/paused checkpoints

Usage:
  python tools/repair_time_record_artifacts.py --audit
  python tools/repair_time_record_artifacts.py                 # dry-run all repairs
  python tools/repair_time_record_artifacts.py --apply
  python tools/repair_time_record_artifacts.py --apply --max-seconds 14400
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
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Only print inflated/ghost/stale inventory (read-only)",
    )
    parser.add_argument(
        "--max-seconds",
        type=int,
        default=4 * 60 * 60,
        help="Trustworthy continuous study cap in seconds (default 4h)",
    )
    parser.add_argument(
        "--json-report",
        action="store_true",
        help="Emit machine-readable JSON summary",
    )
    parser.add_argument(
        "--backfill-client-source",
        action="store_true",
        help="Fill missing summary.client_source (default desktop; see --client-source)",
    )
    parser.add_argument(
        "--client-source",
        choices=("desktop", "pwa"),
        default="desktop",
        help="Value used by --backfill-client-source (default desktop)",
    )
    parser.add_argument(
        "--client-source-unit-review-only",
        action="store_true",
        help="With --backfill-client-source, only freestyle/formal unit review scenes",
    )
    args = parser.parse_args()

    app_home = _ensure_app_home()
    db_path = app_home / "data" / "memory_palace.db"
    print(f"MEMORY_ANKI_HOME={app_home}")
    print(f"db={db_path}")

    from memory_anki.infrastructure.db._tables import get_session
    from memory_anki.modules.session.application.study_session_bridge import (
        abandon_stale_active_study_sessions,
        audit_inflated_study_sessions,
        backfill_missing_client_source_on_study_sessions,
        demote_autosave_checkpoint_time_records,
        demote_inflated_hang_study_sessions,
        reclassify_ghost_formal_review_time_sessions,
        restore_nested_freestyle_review_time_durations,
    )

    with get_session() as session:
        audit = audit_inflated_study_sessions(
            session,
            max_trustworthy_seconds=args.max_seconds,
        )
        if args.audit:
            if args.json_report:
                print(json.dumps(audit, ensure_ascii=False, indent=2))
            else:
                print(
                    f"[AUDIT] inflated_completed={audit['inflated_completed_count']} "
                    f"(>{audit['max_trustworthy_seconds']}s) "
                    f"autosave_completed={audit['autosave_completed_count']} "
                    f"ghost_review={audit['ghost_review_count']} "
                    f"stale_active={audit['stale_active_count']}"
                )
                for sample in audit["inflated_samples"][:20]:
                    print(
                        "  - "
                        f"id={sample['id']} scene={sample['scene']} "
                        f"method={sample['completion_method']} "
                        f"effective={sample['effective_seconds']}s "
                        f"wall={sample['wall_seconds']} "
                        f"source={sample['client_source']} "
                        f"edited={sample['duration_edited']} "
                        f"title={sample['title']!r}"
                    )
            return 0

        restored = restore_nested_freestyle_review_time_durations(session)
        demoted_autosave = demote_autosave_checkpoint_time_records(session)
        reclassified = reclassify_ghost_formal_review_time_sessions(session)
        hang = demote_inflated_hang_study_sessions(
            session,
            max_trustworthy_seconds=args.max_seconds,
        )
        abandoned_stale = abandon_stale_active_study_sessions(session)
        backfilled_source = 0
        if args.backfill_client_source:
            backfilled_source = backfill_missing_client_source_on_study_sessions(
                session,
                default_source=args.client_source,
                only_unit_review=args.client_source_unit_review_only,
            )

        if args.apply:
            session.commit()
        else:
            session.rollback()

    mode = "APPLY" if args.apply else "DRY-RUN"
    report = {
        "mode": mode,
        "restored_nested_freestyle_reviews": restored,
        "demoted_autosave_checkpoints": demoted_autosave,
        "reclassified_ghost_reviews": reclassified,
        "inflated_capped": hang["capped"],
        "inflated_demoted": hang["demoted"],
        "inflated_skipped": hang["skipped"],
        "abandoned_stale_active": abandoned_stale,
        "backfilled_client_source": backfilled_source,
        "audit_before": audit,
    }
    if args.json_report:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            f"[{mode}] restored_nested_freestyle={restored} "
            f"demoted_autosave={demoted_autosave} "
            f"reclassified_ghost={reclassified} "
            f"inflated_capped={hang['capped']} "
            f"inflated_demoted={hang['demoted']} "
            f"inflated_skipped={hang['skipped']} "
            f"abandoned_stale={abandoned_stale} "
            f"backfilled_client_source={backfilled_source}"
        )
        print(
            f"[AUDIT-BEFORE] inflated_completed={audit['inflated_completed_count']} "
            f"autosave_completed={audit['autosave_completed_count']} "
            f"ghost_review={audit['ghost_review_count']} "
            f"stale_active={audit['stale_active_count']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
