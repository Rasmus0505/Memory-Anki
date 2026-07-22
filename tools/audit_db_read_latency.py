"""Local latency / payload audit for hot DB read paths.

Measures freestyle feed, FSRS queue, palace list, and dashboard against the
configured app-home database (USB or local). Does not start HTTP.

Usage:
  python tools/audit_db_read_latency.py
  python tools/audit_db_read_latency.py --rounds 5 --json
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

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


@dataclass
class PathSample:
    name: str
    latency_ms: list[float]
    bytes: int
    meta: dict[str, Any]
    select_count: int | None = None
    error: str | None = None


def _json_bytes(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))


def _count_selects(engine, fn: Callable[[], Any]) -> tuple[Any, int]:
    from sqlalchemy import event

    statements: list[str] = []

    def record(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return result, len(statements)


def _run_timed(fn: Callable[[], Any], rounds: int) -> tuple[Any, list[float]]:
    last: Any = None
    samples: list[float] = []
    for _ in range(rounds):
        started = time.perf_counter()
        last = fn()
        samples.append(round((time.perf_counter() - started) * 1000, 2))
    return last, samples


def _summarize(samples: list[float]) -> dict[str, float]:
    return {
        "min_ms": min(samples),
        "max_ms": max(samples),
        "mean_ms": round(statistics.mean(samples), 2),
        "median_ms": round(statistics.median(samples), 2),
        "p95_ms": round(sorted(samples)[max(0, int(len(samples) * 0.95) - 1)], 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit freestyle/queue/list DB read latency")
    parser.add_argument("--rounds", type=int, default=3, help="timed rounds per path (default 3)")
    parser.add_argument("--json", action="store_true", help="emit JSON only")
    parser.add_argument(
        "--include-dashboard",
        action="store_true",
        default=True,
        help="include dashboard payload (default on)",
    )
    args = parser.parse_args()
    rounds = max(1, int(args.rounds))

    app_home = _ensure_app_home()
    from memory_anki.core.config import APP_HOME, DB_PATH
    from memory_anki.infrastructure.db._tables._base import engine, get_session
    from memory_anki.modules.dashboard.application.service import build_dashboard_payload
    from memory_anki.modules.practice.application.feed_service import build_freestyle_feed
    from memory_anki.modules.content.application.palace_serializer import (
        batch_palace_due_rollups,
        palace_json,
    )
    from memory_anki.modules.content.application.palace_service import (
        count_palaces,
        list_palaces,
    )
    from memory_anki.modules.content.application.title_sync_service import (
        get_explicit_chapter_ids_by_palace,
    )
    from memory_anki.modules.memory.application.formal_review_service import (
        get_fsrs_queue_payload,
    )

    db_path = Path(DB_PATH)
    report: dict[str, Any] = {
        "app_home": str(APP_HOME),
        "resolved_app_home": str(app_home),
        "db_path": str(db_path),
        "db_exists": db_path.exists(),
        "db_size_bytes": db_path.stat().st_size if db_path.exists() else None,
        "rounds": rounds,
        "paths": [],
    }
    if not db_path.exists():
        report["error"] = f"database not found: {db_path}"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    session = get_session()
    try:
        # One cold warmup connection / schema touch.
        session.connection().exec_driver_sql("SELECT 1")

        def measure(name: str, fn: Callable[[], Any], meta_fn: Callable[[Any], dict[str, Any]]):
            try:
                # Statement count on a dedicated run (not mixed into latency average).
                payload_for_count, select_count = _count_selects(engine, fn)
                payload, latencies = _run_timed(fn, rounds)
                # Prefer meta from final timed payload; fall back to count run.
                meta_source = payload if payload is not None else payload_for_count
                sample = PathSample(
                    name=name,
                    latency_ms=latencies,
                    bytes=_json_bytes(meta_source),
                    meta=meta_fn(meta_source),
                    select_count=select_count,
                )
            except Exception as exc:  # noqa: BLE001 - audit continues
                sample = PathSample(
                    name=name,
                    latency_ms=[],
                    bytes=0,
                    meta={},
                    error=repr(exc),
                )
            report["paths"].append(
                {
                    **asdict(sample),
                    "stats": _summarize(sample.latency_ms) if sample.latency_ms else None,
                }
            )

        def freestyle():
            return build_freestyle_feed(session)

        def freestyle_meta(payload: dict[str, Any]) -> dict[str, Any]:
            cards = payload.get("cards") or []
            by_type: dict[str, int] = {}
            for card in cards:
                key = str(card.get("content_type") or card.get("type") or "unknown")
                by_type[key] = by_type.get(key, 0) + 1
            return {
                "card_count": len(cards),
                "counts": payload.get("counts") or {},
                "by_content_type": by_type,
            }

        def queue():
            return get_fsrs_queue_payload(
                session,
                include_stats=True,
                include_items=True,
            )

        def queue_meta(payload: dict[str, Any]) -> dict[str, Any]:
            return {
                "due_count": payload.get("due_count"),
                "later_today_count": payload.get("later_today_count"),
                "overdue_count": payload.get("overdue_count"),
                "review_items": len(payload.get("reviews") or []),
                "later_items": len(payload.get("later_today_reviews") or []),
            }

        def palace_list():
            palaces = list_palaces(session)
            explicit = get_explicit_chapter_ids_by_palace(session, [p.id for p in palaces])
            memory = batch_palace_due_rollups(session, palaces)
            items = [
                palace_json(
                    p,
                    session,
                    precomputed_explicit_chapter_ids=explicit.get(p.id, set()),
                    precomputed_memory_projection=memory.get(p.id),
                    include_heavy_collections=False,
                )
                for p in palaces
            ]
            return {
                "items": items,
                "total": count_palaces(session),
            }

        def palace_list_meta(payload: dict[str, Any]) -> dict[str, Any]:
            items = payload.get("items") or []
            due = sum(1 for item in items if item.get("has_due_review"))
            return {
                "palace_count": len(items),
                "total": payload.get("total"),
                "due_palace_count": due,
            }

        def dashboard():
            return build_dashboard_payload(session)

        def dashboard_meta(payload: dict[str, Any]) -> dict[str, Any]:
            return {
                "due_count": payload.get("due_count"),
                "review_items": len(payload.get("reviews") or []),
                "recent_palaces": len(payload.get("recent_palaces") or []),
                "today_new_palaces": payload.get("today_new_palace_count"),
            }

        measure("freestyle_feed", freestyle, freestyle_meta)
        measure("fsrs_queue", queue, queue_meta)
        measure("palace_list", palace_list, palace_list_meta)
        if args.include_dashboard:
            measure("dashboard", dashboard, dashboard_meta)
    finally:
        session.close()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    print(f"APP_HOME: {report['app_home']}")
    print(f"DB:       {report['db_path']} ({report['db_size_bytes']} bytes)")
    print(f"rounds:   {rounds}")
    print()
    for path in report["paths"]:
        print(f"== {path['name']} ==")
        if path.get("error"):
            print(f"  ERROR: {path['error']}")
            continue
        stats = path.get("stats") or {}
        print(
            f"  latency: mean {stats.get('mean_ms')} ms | "
            f"median {stats.get('median_ms')} ms | "
            f"min {stats.get('min_ms')} / max {stats.get('max_ms')} | "
            f"samples {path['latency_ms']}"
        )
        print(f"  payload: {path['bytes']:,} bytes ({path['bytes'] / 1024:.1f} KiB)")
        print(f"  SELECT:  {path.get('select_count')}")
        print(f"  meta:    {json.dumps(path.get('meta') or {}, ensure_ascii=False)}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
