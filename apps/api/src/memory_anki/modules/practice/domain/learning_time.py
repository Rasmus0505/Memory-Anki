"""Round-scoped freestyle learning time. Framework-free.

The closing card shows one round total and a separate quiz line. Flip time
stays inside unit dwell. Palace lookup during a quiz is not quiz time, but it
still belongs in the round total. Seconds live on the round plan so an
unfinished round keeps yesterday after a restart or a device switch.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

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
    return {
        "unit_seconds": _nonneg(source.get("unit_seconds")),
        "quiz_seconds": _nonneg(source.get("quiz_seconds")),
        "lookup_seconds": _nonneg(source.get("lookup_seconds")),
        "backfilled": bool(source.get("backfilled")),
        "by_palace": palaces,
    }


def _copy(time: Mapping[str, Any]) -> dict[str, Any]:
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
