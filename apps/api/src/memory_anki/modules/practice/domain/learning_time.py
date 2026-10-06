"""Round-scoped freestyle learning time. Framework-free.

The closing card shows one round total and a separate quiz line. Flip time
stays inside unit dwell. Palace lookup during a quiz is not quiz time, but it
still belongs in the round total. Seconds live on the round plan so an
unfinished round keeps yesterday after a restart or a device switch.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from memory_anki.modules.practice.domain.workspace import is_palace_review_workspace

BUCKETS = ("unit", "quiz", "lookup")
QUIZ_TITLES = {"做题", "关联题目"}
LOOKUP_TITLE = "查看宫殿"
MAX_ADD_SECONDS = 3600
MAX_SEGMENT_SECONDS = 12 * 3600


def empty_learning_time() -> dict[str, Any]:
    return {
        "unit_seconds": 0,
        "quiz_seconds": 0,
        "lookup_seconds": 0,
        "backfilled": False,
        "by_palace": {},
    }


def _nonneg(value: Any, cap: int | None = None) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    if number < 0:
        return 0
    if cap is not None and number > cap:
        return cap
    return number


def _palace_id(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _bucket(value: Any) -> str | None:
    name = str(value or "").strip()
    return name if name in BUCKETS else None


def _palace_bucket(raw: Mapping[str, Any] | None) -> dict[str, int]:
    source = raw or {}
    return {
        "unit_seconds": _nonneg(source.get("unit_seconds")),
        "quiz_seconds": _nonneg(source.get("quiz_seconds")),
        "lookup_seconds": _nonneg(source.get("lookup_seconds")),
    }


def normalize_learning_time(raw: Mapping[str, Any] | None) -> dict[str, Any]:
    source = raw or {}
    palaces: dict[str, dict[str, int]] = {}
    raw_palaces = source.get("by_palace")
    if isinstance(raw_palaces, Mapping):
        for key, value in raw_palaces.items():
            palace_id = _palace_id(key)
            if palace_id is None or not isinstance(value, Mapping):
                continue
            bucket = _palace_bucket(value)
            if bucket["unit_seconds"] or bucket["quiz_seconds"] or bucket["lookup_seconds"]:
                palaces[str(palace_id)] = bucket
    result = {
        "unit_seconds": _nonneg(source.get("unit_seconds")),
        "quiz_seconds": _nonneg(source.get("quiz_seconds")),
        "lookup_seconds": _nonneg(source.get("lookup_seconds")),
        "backfilled": bool(source.get("backfilled")),
        "by_palace": palaces,
    }
    intervals = _normalize_stored_intervals(source.get("intervals"))
    if intervals:
        result["intervals"] = intervals
    return result


def _copy(time: Mapping[str, Any] | None) -> dict[str, Any]:
    return normalize_learning_time(time)


def _bump_palace(time: dict[str, Any], palace_id: int, bucket: str, seconds: int) -> None:
    key = str(palace_id)
    palaces = time["by_palace"]
    current = palaces.get(key) or {
        "unit_seconds": 0,
        "quiz_seconds": 0,
        "lookup_seconds": 0,
    }
    field = f"{bucket}_seconds"
    current[field] = _nonneg(current.get(field)) + seconds
    palaces[key] = current


def add_learning_seconds(
    time: Mapping[str, Any] | None,
    *,
    bucket: str,
    seconds: int,
    palace_id: int | None = None,
    cap: int = MAX_ADD_SECONDS,
) -> dict[str, Any]:
    """Add one observed slice. Live flushes cap at one hour; dwell segments cap higher."""
    name = _bucket(bucket)
    amount = _nonneg(seconds, cap)
    next_time = _copy(time)
    if name is None or amount <= 0:
        return next_time
    field = f"{name}_seconds"
    next_time[field] = _nonneg(next_time.get(field)) + amount
    resolved_palace = _palace_id(palace_id)
    if resolved_palace is not None:
        _bump_palace(next_time, resolved_palace, name, amount)
    return next_time


def apply_learning_adds(
    time: Mapping[str, Any] | None,
    adds: Sequence[Mapping[str, Any]] | None,
) -> dict[str, Any]:
    next_time = _copy(time)
    for item in adds or ():
        if not isinstance(item, Mapping):
            continue
        next_time = add_learning_seconds(
            next_time,
            bucket=str(item.get("bucket") or ""),
            seconds=_nonneg(item.get("seconds"), MAX_ADD_SECONDS),
            palace_id=_palace_id(item.get("palace_id")),
        )
    return next_time


def route_matches_workspace(route: str, workspace: str) -> bool:
    path = str(route or "").split("?", 1)[0].rstrip("/") or "/"
    if is_palace_review_workspace(workspace):
        return path == f"/palaces/{workspace[1:]}/review"
    if workspace == "secondary":
        return path == "/freestyle-2" or path.startswith("/freestyle-2/")
    return path == "/freestyle" or (
        path.startswith("/freestyle/") and not path.startswith("/freestyle-2")
    )


def segment_in_workspace(segment: Mapping[str, Any], workspace: str) -> bool:
    route = str(segment.get("routePath") or segment.get("route_path") or "")
    if route:
        return route_matches_workspace(route, workspace)
    title = str(segment.get("title") or "")
    scene = str(segment.get("scene") or "")
    if is_palace_review_workspace(workspace):
        return scene == "freestyle" and title == "宫殿复习"
    if workspace == "secondary":
        return scene == "freestyle" and title == "随心 2"
    return scene == "freestyle" and title == "随心"


def classify_freestyle_segment(segment: Mapping[str, Any], workspace: str) -> str | None:
    """Map one dwell segment onto unit, quiz, or lookup for this workspace."""
    if not segment_in_workspace(segment, workspace):
        return None
    title = str(segment.get("title") or "")
    scene = str(segment.get("scene") or "")
    if title == LOOKUP_TITLE:
        return "lookup"
    if scene == "quiz" or title in QUIZ_TITLES:
        return "quiz"
    if scene == "freestyle":
        return "unit"
    return None


def fold_freestyle_segment(
    time: Mapping[str, Any] | None,
    segment: Mapping[str, Any],
    *,
    workspace: str,
) -> dict[str, Any]:
    bucket = classify_freestyle_segment(segment, workspace)
    if bucket is None:
        return _copy(time)
    seconds = _nonneg(
        segment.get("effectiveSeconds") if segment.get("effectiveSeconds") is not None else segment.get("effective_seconds"),
        MAX_SEGMENT_SECONDS,
    )
    palace = _palace_id(segment.get("palaceId") if segment.get("palaceId") is not None else segment.get("palace_id"))
    # Card dwell rarely carries a palace on the route fragment. Quiz and lookup do.
    if bucket == "unit":
        palace = None
    return add_learning_seconds(
        _copy(time),
        bucket=bucket,
        seconds=seconds,
        palace_id=palace,
        cap=MAX_SEGMENT_SECONDS,
    )


def attribute_unassigned_unit_seconds(
    time: Mapping[str, Any] | None,
    weights: Mapping[int, int] | None,
) -> dict[str, Any]:
    """Split unit seconds that have no palace onto palaces by observed weights.

    Does not change the round total. Weights are encounter focus seconds, or a
    single-palace round. Empty weights leave the seconds on the headline only.
    """
    next_time = _copy(time)
    assigned = 0
    for palace in next_time["by_palace"].values():
        assigned += _nonneg(palace.get("unit_seconds"))
    leftover = max(0, _nonneg(next_time.get("unit_seconds")) - assigned)
    positive = {
        int(palace_id): _nonneg(weight)
        for palace_id, weight in (weights or {}).items()
        if _palace_id(palace_id) is not None and _nonneg(weight) > 0
    }
    if leftover <= 0 or not positive:
        return next_time
    total = sum(positive.values())
    shares: list[tuple[float, int, int]] = []
    given = 0
    for palace_id, weight in positive.items():
        raw = leftover * weight / total
        whole = int(raw)
        shares.append((raw - whole, palace_id, whole))
        given += whole
    shares.sort(key=lambda item: (-item[0], item[1]))
    remainder = leftover - given
    for index in range(remainder):
        fraction, palace_id, whole = shares[index]
        shares[index] = (fraction, palace_id, whole + 1)
    for _, palace_id, whole in shares:
        if whole <= 0:
            continue
        _bump_palace(next_time, palace_id, "unit", whole)
    return next_time


def single_palace_weight(plan: Mapping[str, Any] | None) -> dict[int, int]:
    ids: list[int] = []
    for card in (plan or {}).get("original_cards") or []:
        if not isinstance(card, Mapping):
            continue
        palace_id = _palace_id(card.get("palace_id"))
        if palace_id is None or palace_id in ids:
            continue
        ids.append(palace_id)
    if len(ids) == 1:
        return {ids[0]: 1}
    return {}


MAX_INTERVALS = 500
_FUTURE_SKEW = timedelta(seconds=5)


def _parse_aware(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def _public_interval(raw: Mapping[str, Any]) -> dict[str, Any]:
    fact = {
        "interval_id": str(raw.get("interval_id") or "")[:160],
        "session_id": str(raw.get("session_id") or "")[:160],
        "started_at": str(raw.get("started_at") or ""),
        "ended_at": str(raw.get("ended_at") or ""),
        "bucket": raw.get("bucket"),
    }
    palace_id = _palace_id(raw.get("palace_id"))
    if palace_id is not None:
        fact["palace_id"] = palace_id
    source = str(raw.get("client_source") or "unknown")
    fact["client_source"] = source if source in {"desktop", "pwa", "unknown"} else "unknown"
    return fact


def _normalize_stored_intervals(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, Sequence) or isinstance(raw, str | bytes):
        return []
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        fact = normalize_learning_interval(item, allow_future=True)
        if fact is None or fact["interval_id"] in seen:
            continue
        seen.add(fact["interval_id"])
        kept.append(_public_interval(fact))
        if len(kept) >= MAX_INTERVALS:
            break
    return kept


def normalize_learning_interval(raw: Any, *, allow_future: bool = False) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    interval_id = str(raw.get("interval_id") or "").strip()
    if not interval_id or len(interval_id) > 160:
        return None
    started = _parse_aware(raw.get("started_at"))
    ended = _parse_aware(raw.get("ended_at"))
    if started is None or ended is None or ended <= started:
        return None
    if not allow_future and ended > datetime.now(UTC) + _FUTURE_SKEW:
        return None
    seconds = int((ended - started).total_seconds())
    if seconds <= 0 or seconds > MAX_SEGMENT_SECONDS:
        return None
    bucket = _bucket(raw.get("bucket"))
    if bucket is None:
        return None
    fact = _public_interval({**raw, "interval_id": interval_id, "bucket": bucket})
    fact["started_at"] = started.isoformat()
    fact["ended_at"] = ended.isoformat()
    return fact


def _merge_spans(spans: Sequence[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    ordered = sorted((start, end) for start, end in spans if end > start)
    merged: list[list[datetime]] = []
    for start, end in ordered:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(start, end) for start, end in merged]


def _uncovered_seconds(
    start: datetime,
    end: datetime,
    spans: Sequence[tuple[datetime, datetime]],
) -> int:
    covered = 0
    for span_start, span_end in _merge_spans(spans):
        overlap_start = max(start, span_start)
        overlap_end = min(end, span_end)
        if overlap_end > overlap_start:
            covered += int((overlap_end - overlap_start).total_seconds())
    return max(0, int((end - start).total_seconds()) - covered)


def apply_learning_intervals(
    time: Mapping[str, Any] | None,
    intervals: Sequence[Mapping[str, Any]] | None,
) -> dict[str, Any]:
    """Add only the wall time that no stored interval already covers.

    Replaying an interval id is a no-op. Overlapping intervals from two devices
    count once, assigned to whichever fact arrived first.
    """
    current = _copy(time)
    stored = list(current.get("intervals") or [])
    known = {str(item.get("interval_id")) for item in stored}
    spans: list[tuple[datetime, datetime]] = []
    for item in stored:
        started = _parse_aware(item.get("started_at"))
        ended = _parse_aware(item.get("ended_at"))
        if started is not None and ended is not None:
            spans.append((started, ended))
    accepted: list[dict[str, Any]] = []
    for raw in list(intervals or [])[:MAX_INTERVALS]:
        fact = normalize_learning_interval(raw)
        if fact is None or fact["interval_id"] in known:
            continue
        if len(stored) + len(accepted) >= MAX_INTERVALS:
            break
        known.add(fact["interval_id"])
        started = _parse_aware(fact["started_at"])
        ended = _parse_aware(fact["ended_at"])
        if started is None or ended is None:
            continue
        seconds = _uncovered_seconds(started, ended, spans)
        spans.append((started, ended))
        accepted.append(fact)
        if seconds <= 0:
            continue
        current = add_learning_seconds(
            current,
            bucket=str(fact["bucket"]),
            seconds=seconds,
            palace_id=_palace_id(fact.get("palace_id")),
            cap=MAX_SEGMENT_SECONDS,
        )
    if accepted:
        current["intervals"] = stored + accepted
    return current
