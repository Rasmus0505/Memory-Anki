"""Read-only scan: review units that lost earned progress to a mark change.

Deleting the final permanent mark deactivates unit rows while keeping their
earned stage/due. Before the inheritance fix, re-adding a mark read only active
rows, found no overlap, and restarted the unit at first-learning. This script
reports the damage that fix did NOT retroactively repair.

It never writes. It only reports candidate units and the evidence for them, so a
human can decide whether each one is genuinely restarted or legitimately new.

Usage:
    python tools/scan_restarted_review_units.py [--json out.json]

Runtime path resolution follows the app's own local-config, so no machine's
drive letter is hard-coded here.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

# Both the current unit and the retired donor must be majority-covered by the
# shared nodes before the donor counts as evidence. Below this, the "overlap" is
# incidental contact between unrelated regions, not a restart.
MIN_OVERLAP = 0.5


def resolve_db_path() -> Path:
    """Locate the live SQLite database via the app's configured runtime home."""
    from memory_anki.core.runtime_paths import (  # noqa: PLC0415
        database_file_path,
        resolve_app_home,
        resolve_existing_database_file,
    )

    app_home = resolve_app_home().app_home
    existing = resolve_existing_database_file(app_home)
    if existing and Path(existing).exists():
        return Path(existing)
    preferred = database_file_path(app_home)
    if preferred.exists():
        return preferred
    raise SystemExit(
        f"Could not locate the runtime database under {app_home}. "
        "Set MEMORY_ANKI_HOME or fix local-config/memory-anki.local.json."
    )


def _members(raw: str | None) -> set[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return set()
    return {str(item) for item in value} if isinstance(value, list) else set()


def scan(db_path: Path) -> dict:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT id, palace_id, anchor_uid, unit_kind, node_uids_json,
                   stage_index, has_passed, due_date, revision, active,
                   created_at, updated_at
            FROM review_unit_states
            ORDER BY palace_id, topology_order
            """
        ).fetchall()
        palaces = {
            row["id"]: row
            for row in connection.execute(
                "SELECT id, title FROM palaces"
            ).fetchall()
        }
    finally:
        connection.close()

    by_palace: dict[int, list[sqlite3.Row]] = {}
    for row in rows:
        by_palace.setdefault(int(row["palace_id"]), []).append(row)

    suspects: list[dict] = []
    for palace_id, palace_rows in by_palace.items():
        active = [row for row in palace_rows if row["active"]]
        inactive = [row for row in palace_rows if not row["active"]]
        if not active or not inactive:
            continue

        for row in active:
            # A never-passed, first-learning unit is the signature of a restart.
            if row["has_passed"] or int(row["stage_index"]) != 0:
                continue
            member_set = _members(row["node_uids_json"])
            if not member_set:
                continue

            # Evidence: a retired row over the same region that had earned more.
            #
            # Overlap must be *substantial*, not incidental. A residual that
            # picked up one uid from an old cohort is mostly new work, and
            # crediting it with that cohort's stage would hand unearned progress
            # to nodes the learner has never seen. Requiring a majority of both
            # units keeps this report to genuine restarts.
            donors = []
            for other in inactive:
                other_members = _members(other["node_uids_json"])
                shared = other_members & member_set
                if not shared:
                    continue
                if not other["has_passed"] and int(other["stage_index"]) == 0:
                    continue
                if int(other["stage_index"]) <= int(row["stage_index"]):
                    continue
                coverage = len(shared) / max(1, len(member_set))
                donor_coverage = len(shared) / max(1, len(other_members))
                if coverage < MIN_OVERLAP or donor_coverage < MIN_OVERLAP:
                    continue
                donors.append(
                    {
                        "unit_id": other["id"],
                        "anchor_uid": other["anchor_uid"],
                        "unit_kind": other["unit_kind"],
                        "stage_index": int(other["stage_index"]),
                        "has_passed": bool(other["has_passed"]),
                        "due_date": other["due_date"],
                        "updated_at": other["updated_at"],
                        "overlap": sorted(shared),
                        "coverage_of_current": round(coverage, 3),
                        "coverage_of_donor": round(donor_coverage, 3),
                    }
                )
            if not donors:
                continue

            best = max(donors, key=lambda item: item["stage_index"])
            rebuildable = (
                best["anchor_uid"] == row["anchor_uid"]
                and best["unit_kind"] == row["unit_kind"]
            )
            suspects.append(
                {
                    "palace_id": palace_id,
                    "palace_title": (palaces.get(palace_id) or {"title": ""})["title"],
                    "unit_id": row["id"],
                    "anchor_uid": row["anchor_uid"],
                    "unit_kind": row["unit_kind"],
                    "current_stage_index": int(row["stage_index"]),
                    "current_due_date": row["due_date"],
                    "suggested_stage_index": best["stage_index"],
                    "suggested_due_date": best["due_date"],
                    "confidence": "exact_identity" if rebuildable else "overlap_only",
                    "donors": donors,
                }
            )

    return {
        "database": str(db_path),
        "scanned_at": date.today().isoformat(),
        "suspect_count": len(suspects),
        "suspects": suspects,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="write the full report as JSON")
    parser.add_argument("--db", type=Path, help="override the database path")
    args = parser.parse_args()

    db_path = args.db or resolve_db_path()
    report = scan(db_path)

    print(f"Database : {report['database']}")
    print(f"Suspects : {report['suspect_count']}")
    for item in report["suspects"]:
        print(
            f"\n  palace {item['palace_id']} ({item['palace_title'] or 'untitled'})"
            f"  unit {item['unit_id'][:8]}  {item['anchor_uid']}/{item['unit_kind']}"
        )
        print(
            f"    now: stage {item['current_stage_index']} due {item['current_due_date']}"
            f"   -> could be stage {item['suggested_stage_index']}"
            f" due {item['suggested_due_date']}   [{item['confidence']}]"
        )
        for donor in item["donors"]:
            print(
                f"      evidence: {donor['unit_id'][:8]} {donor['anchor_uid']}/"
                f"{donor['unit_kind']} stage {donor['stage_index']} "
                f"due {donor['due_date']} overlap={donor['overlap']}"
            )
    if args.json:
        args.json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\nFull report: {args.json}")
    if not report["suspects"]:
        print("\nNo restarted units detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
