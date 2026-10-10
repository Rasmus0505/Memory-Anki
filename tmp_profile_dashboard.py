import os
import sys
import time
from pathlib import Path

repo = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(repo / "apps" / "api" / "src"))
os.chdir(repo)

from memory_anki.core.local_config import load_local_runtime_config

home = load_local_runtime_config().local_app_home
os.environ["MEMORY_ANKI_HOME"] = str(home)
print("HOME", home, flush=True)

from memory_anki.infrastructure.db._tables import get_session
from memory_anki.modules.dashboard.application.service import build_dashboard_payload
from memory_anki.modules.memory.public.queries import (
    get_review_queue_summary,
    get_unit_review_weekly_stats,
)
from memory_anki.modules.session.public.queries import (
    build_time_record_read_model,
    current_month_bounds,
    current_week_bounds,
    get_english_study_stats,
    get_time_record_duration_seconds,
    get_today_palace_learning_breakdown,
)


def timed(name, fn):
    session = get_session()
    started = time.perf_counter()
    try:
        result = fn(session)
        elapsed_ms = (time.perf_counter() - started) * 1000
        extra = ""
        if isinstance(result, dict):
            extra = " keys=" + ",".join(list(result)[:8])
            if "reviews" in result:
                extra += f" reviews={len(result.get('reviews') or [])}"
            if "due_count" in result:
                extra += f" due={result.get('due_count')}"
        elif isinstance(result, list):
            extra = f" n={len(result)}"
        print(f"OK {name} {elapsed_ms:.0f}ms{extra}", flush=True)
        return result
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        print(f"FAIL {name} {elapsed_ms:.0f}ms {type(exc).__name__}: {exc}", flush=True)
        return None
    finally:
        session.close()


timed("queue", lambda session: get_review_queue_summary(session))
timed("weekly_stats", lambda session: get_unit_review_weekly_stats(session))
timed("today_time", lambda session: build_time_record_read_model(session, range_mode="today", limit=1))
timed(
    "today_review_time",
    lambda session: build_time_record_read_model(session, range_mode="today", kind="review", limit=1),
)
month = current_month_bounds()
week = current_week_bounds()
timed(
    "month_review_dur",
    lambda session: get_time_record_duration_seconds(session, start=month[0], end=month[1], kind="review"),
)
timed(
    "week_review_dur",
    lambda session: get_time_record_duration_seconds(session, start=week[0], end=week[1], kind="review"),
)
timed(
    "week_all_dur",
    lambda session: get_time_record_duration_seconds(session, start=week[0], end=week[1]),
)
timed("english", lambda session: get_english_study_stats(session))
timed("today_learning", lambda session: get_today_palace_learning_breakdown(session))
timed("dashboard", lambda session: build_dashboard_payload(session))
