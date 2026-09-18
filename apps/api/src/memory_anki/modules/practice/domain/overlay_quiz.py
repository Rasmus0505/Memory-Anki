"""Freestyle toolbar 做题 overlay. Framework-free.

Progress is not wiped when the learner changes subject/palace scope. A new round
starts overlay 已做 empty. Out-of-scope answered questions stay in `parked` and
return when that palace is in scope again. A palace's overlay progress is dropped
only after its review units in the current round are all scored.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from .feed_config import QUIZ_SCOPE_CROSS, QUIZ_SCOPE_SINGLE, QUIZ_SCOPES

OverlayQuiz = dict[str, Any]


def empty_parked_overlay() -> dict[str, Any]:
    return {
        "question_ids": [],
        "completed_ids": [],
        "states": {},
    }


def empty_overlay_quiz() -> OverlayQuiz:
    return {
        "scope_signature": "",
        "quiz_scope": QUIZ_SCOPE_CROSS,
        "seed": 0,
        "question_ids": [],
        "current_index": 0,
        "completed_ids": [],
        "states": {},
        "limit_reached": False,
        "candidate_count": 0,
        "question_palace_ids": {},
        "parked": empty_parked_overlay(),
    }


def overlay_quiz_scope_signature(
    palace_ids: Sequence[int],
    quiz_scope: str,
    question_type: str,
    mastery_buckets: Sequence[str],
    weak_priority: bool,
    overlay_question_range: str = "all",
) -> str:
    return json.dumps(
        {
            "palace_ids": sorted({int(item) for item in palace_ids if int(item) > 0}),
            "quiz_scope": str(quiz_scope or QUIZ_SCOPE_CROSS),
            "question_type": str(question_type or "all"),
            "mastery_buckets": sorted({str(item) for item in mastery_buckets if str(item).strip()}),
            "weak_priority": bool(weak_priority),
            "overlay_question_range": str(overlay_question_range or "all"),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def normalize_overlay_quiz(raw: Mapping[str, Any] | None) -> OverlayQuiz:
    data = dict(raw or {})
    quiz_scope = str(data.get("quiz_scope") or QUIZ_SCOPE_CROSS)
    if quiz_scope not in QUIZ_SCOPES:
        quiz_scope = QUIZ_SCOPE_CROSS
    question_ids = _unique_positive_ids(data.get("question_ids"))
    completed_ids = [
        item for item in _unique_positive_ids(data.get("completed_ids")) if item in set(question_ids)
    ]
    current_index = _as_int(data.get("current_index"), 0)
    if question_ids:
        current_index = max(0, min(current_index, len(question_ids) - 1))
    else:
        current_index = 0
    parked = _normalize_parked(data.get("parked"), visible_ids=question_ids)
    palace_ids = _normalize_palace_ids(data.get("question_palace_ids"))
    known_ids = set(question_ids) | set(parked["question_ids"])
    palace_ids = {
        question_id: palace_id
        for question_id, palace_id in palace_ids.items()
        if _as_int(question_id, 0) in known_ids
    }
    return {
        "scope_signature": str(data.get("scope_signature") or ""),
        "quiz_scope": quiz_scope,
        "seed": max(0, _as_int(data.get("seed"), 0)),
        "question_ids": question_ids,
        "current_index": current_index,
        "completed_ids": completed_ids,
        "states": _normalize_states(data.get("states"), question_ids),
        "limit_reached": bool(data.get("limit_reached")),
        "candidate_count": max(0, _as_int(data.get("candidate_count"), 0)),
        "question_palace_ids": palace_ids,
        "parked": parked,
    }


def merge_overlay_quiz(
    existing: Mapping[str, Any] | None,
    *,
    question_ids: Sequence[int],
    quiz_scope: str,
    seed: int,
    scope_signature: str,
    limit_reached: bool,
    candidate_count: int,
    question_palace_ids: Mapping[str, Any] | None = None,
) -> OverlayQuiz:
    previous = normalize_overlay_quiz(existing)
    ordered = _unique_positive_ids(question_ids)
    incoming_palace_ids = _normalize_palace_ids(question_palace_ids)
    palace_ids = {**previous["question_palace_ids"], **incoming_palace_ids}
    same_session = (
        previous["scope_signature"] == str(scope_signature or "")
        and previous["quiz_scope"] == (quiz_scope if quiz_scope in QUIZ_SCOPES else QUIZ_SCOPE_CROSS)
        and int(previous["seed"]) == max(0, int(seed))
        and previous["question_ids"] == ordered
    )
    if same_session:
        return normalize_overlay_quiz(
            {
                **previous,
                "limit_reached": bool(limit_reached),
                "candidate_count": max(0, int(candidate_count)),
                "question_palace_ids": palace_ids,
            }
        )

    previous_parked = previous["parked"]
    all_completed = _unique_positive_ids(
        [*previous_parked["completed_ids"], *previous["completed_ids"]]
    )
    all_states = {**previous_parked["states"], **previous["states"]}
    ordered_set = set(ordered)
    in_scope_completed = [item for item in all_completed if item in ordered_set]
    unstarted = [item for item in ordered if item not in set(in_scope_completed)]
    merged_ids = in_scope_completed + unstarted
    visible_states = {
        str(question_id): value
        for question_id, value in all_states.items()
        if _as_int(question_id, 0) in set(merged_ids)
    }
    progressed = set(all_completed) | {
        _as_int(question_id, 0) for question_id in all_states if _as_int(question_id, 0) > 0
    }
    previous_known = _unique_positive_ids(
        [*previous_parked["question_ids"], *previous["question_ids"]]
    )
    parked_ids = [item for item in previous_known if item not in ordered_set and item in progressed]
    parked_completed = [item for item in all_completed if item in set(parked_ids)]
    parked_states = {
        str(question_id): value
        for question_id, value in all_states.items()
        if _as_int(question_id, 0) in set(parked_ids)
    }
    current_index = 0
    in_scope_completed_set = set(in_scope_completed)
    for index, question_id in enumerate(merged_ids):
        if question_id not in in_scope_completed_set:
            current_index = index
            break
    return normalize_overlay_quiz(
        {
            "scope_signature": str(scope_signature or ""),
            "quiz_scope": quiz_scope if quiz_scope in QUIZ_SCOPES else QUIZ_SCOPE_CROSS,
            "seed": max(0, int(seed)),
            "question_ids": merged_ids,
            "current_index": current_index,
            "completed_ids": in_scope_completed,
            "states": visible_states,
            "limit_reached": bool(limit_reached),
            "candidate_count": max(0, int(candidate_count)),
            "question_palace_ids": palace_ids,
            "parked": {
                "question_ids": parked_ids,
                "completed_ids": parked_completed,
                "states": parked_states,
            },
        }
    )


def inherit_overlay_completed(
    overlay: Mapping[str, Any] | None,
    peer_overlay: Mapping[str, Any] | None,
) -> OverlayQuiz:
    """Union peer completed question ids that are in this overlay pack. Do not move the index."""
    current = normalize_overlay_quiz(overlay)
    peer = normalize_overlay_quiz(peer_overlay)
    peer_completed = _unique_positive_ids([*peer["completed_ids"], *peer["parked"]["completed_ids"]])
    allowed = set(current["question_ids"])
    parked_allowed = set(current["parked"]["question_ids"])
    for question_id in peer_completed:
        if question_id in allowed:
            if question_id not in current["completed_ids"]:
                current["completed_ids"].append(question_id)
        elif question_id in parked_allowed:
            parked = current["parked"]
            if question_id not in parked["completed_ids"]:
                parked["completed_ids"].append(question_id)
    return normalize_overlay_quiz(current)


def apply_overlay_progress(
    overlay: Mapping[str, Any] | None,
    *,
    current_index: int,
    completed_ids: Sequence[int],
    states: Mapping[str, Any] | None,
) -> OverlayQuiz:
    current = normalize_overlay_quiz(overlay)
    allowed = set(current["question_ids"])
    next_completed = [item for item in _unique_positive_ids(completed_ids) if item in allowed]
    current["completed_ids"] = next_completed
    current["states"] = _normalize_states(states, current["question_ids"])
    current["current_index"] = _as_int(current_index, current["current_index"])
    return normalize_overlay_quiz(current)


def drop_overlay_for_palaces(
    overlay: Mapping[str, Any] | None,
    palace_ids: Sequence[int] | set[int],
) -> OverlayQuiz:
    current = normalize_overlay_quiz(overlay)
    drop_palaces = {int(item) for item in palace_ids if int(item) > 0}
    if not drop_palaces:
        return current
    drop_qids = {
        _as_int(question_id, 0)
        for question_id, palace_id in current["question_palace_ids"].items()
        if palace_id in drop_palaces
    }
    if not drop_qids:
        return current

    def _keep(ids: Sequence[int]) -> list[int]:
        return [item for item in ids if item not in drop_qids]

    question_ids = _keep(current["question_ids"])
    parked = current["parked"]
    parked_ids = _keep(parked["question_ids"])
    current_index = current["current_index"]
    if question_ids:
        current_index = max(0, min(current_index, len(question_ids) - 1))
        if current["question_ids"] and current["question_ids"][current["current_index"]] in drop_qids:
            current_index = 0
            completed = set(_keep(current["completed_ids"]))
            for index, question_id in enumerate(question_ids):
                if question_id not in completed:
                    current_index = index
                    break
    else:
        current_index = 0
    palace_map = {
        question_id: palace_id
        for question_id, palace_id in current["question_palace_ids"].items()
        if _as_int(question_id, 0) not in drop_qids
    }
    return normalize_overlay_quiz(
        {
            **current,
            "question_ids": question_ids,
            "current_index": current_index,
            "completed_ids": _keep(current["completed_ids"]),
            "states": _normalize_states(current["states"], question_ids),
            "question_palace_ids": palace_map,
            "parked": {
                "question_ids": parked_ids,
                "completed_ids": _keep(parked["completed_ids"]),
                "states": _normalize_states(parked["states"], parked_ids),
            },
        }
    )


def _normalize_parked(raw: Any, *, visible_ids: Sequence[int]) -> dict[str, Any]:
    data = raw if isinstance(raw, Mapping) else {}
    visible = set(visible_ids)
    question_ids = [item for item in _unique_positive_ids(data.get("question_ids")) if item not in visible]
    completed_ids = [
        item for item in _unique_positive_ids(data.get("completed_ids")) if item in set(question_ids)
    ]
    return {
        "question_ids": question_ids,
        "completed_ids": completed_ids,
        "states": _normalize_states(data.get("states"), question_ids),
    }


def _normalize_palace_ids(raw: Any) -> dict[str, int]:
    source = raw if isinstance(raw, Mapping) else {}
    result: dict[str, int] = {}
    for key, value in source.items():
        question_id = _as_int(key, 0)
        palace_id = _as_int(value, 0)
        if question_id <= 0 or palace_id <= 0:
            continue
        result[str(question_id)] = palace_id
    return result


def _unique_positive_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        number = _as_int(item, 0)
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        result.append(number)
    return result


def _normalize_states(raw: Any, question_ids: Sequence[int]) -> dict[str, dict[str, Any]]:
    allowed = {int(item) for item in question_ids}
    source = raw if isinstance(raw, Mapping) else {}
    result: dict[str, dict[str, Any]] = {}
    for key, value in source.items():
        question_id = _as_int(key, 0)
        if question_id <= 0 or question_id not in allowed or not isinstance(value, Mapping):
            continue
        result[str(question_id)] = dict(value)
    return result


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


__all__ = [
    "QUIZ_SCOPE_CROSS",
    "QUIZ_SCOPE_SINGLE",
    "apply_overlay_progress",
    "drop_overlay_for_palaces",
    "empty_overlay_quiz",
    "empty_parked_overlay",
    "inherit_overlay_completed",
    "merge_overlay_quiz",
    "normalize_overlay_quiz",
    "overlay_quiz_scope_signature",
]
