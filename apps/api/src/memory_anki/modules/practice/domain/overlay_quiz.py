"""Freestyle toolbar 做题 overlay. Framework-free.

Progress is not wiped when the learner changes subject/palace scope. A new round
starts overlay 已做 empty. Out-of-scope answered questions stay in `parked` and
return when that palace is in scope again. Overlay progress for the round's review
palaces is dropped only after the learner confirms clear on the settlement page,
once the configured queue is fully handled. Scoring one palace does not ask.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from .feed_config import (
    DEFAULT_OVERLAY_QUESTION_KINDS,
    OVERLAY_KIND_SUBJECTIVE,
    OVERLAY_NESTING_PALACE_THEN_TYPE,
    OVERLAY_NESTING_TYPE_THEN_PALACE,
    OVERLAY_TYPE_ORDER_INTERLEAVE,
    OVERLAY_TYPE_ORDER_OBJECTIVE_FIRST,
    OVERLAY_TYPE_ORDER_SUBJECTIVE_FIRST,
    QUIZ_SCOPE_CROSS,
    QUIZ_SCOPE_SINGLE,
    QUIZ_SCOPES,
)
from .quiz_stream import deterministic_shuffle, order_quiz_stream_by_scope

OverlayQuiz = dict[str, Any]

# Why a palace this round scheduled is not contributing questions to 做题.
SCOPE_REASON_NO_QUESTIONS = "no_questions"
SCOPE_REASON_KINDS_FILTERED = "kinds_filtered"
# The learner took every card of this palace out of the queue (移除本队列).
SCOPE_REASON_PALACE_REMOVED = "palace_removed"

# Sentinel for "this round has not rated that knowledge point yet". The card
# shows words, never a fabricated score. Kept as a value rather than an absent
# key so the frontend can tell "not rated this round" from "question has no
# bound knowledge point at all".
QUESTION_RATING_NONE = 0


def empty_scope_palaces() -> dict[str, Any]:
    return {"scheduled_count": 0, "in_pool_count": 0, "question_count": 0, "palaces": []}


def build_scope_palaces(
    *,
    scheduled_palace_ids: Sequence[int],
    counts_by_palace: Mapping[int, Mapping[str, int]],
    titles: Mapping[int, str],
    in_pool_palace_ids: Sequence[int] = (),
    removed_palace_ids: Sequence[int] = (),
    no_questions_reason: str = SCOPE_REASON_NO_QUESTIONS,
    kinds_filtered_reason: str = SCOPE_REASON_KINDS_FILTERED,
    palace_removed_reason: str = SCOPE_REASON_PALACE_REMOVED,
) -> dict[str, Any]:
    """Authoritative per-palace 做题 scope report for the UI to render.

    The dialog must show this instead of re-deriving membership from the round
    plan and the config: two derivations of one scope let the header claim
    "8 palaces" while the pool was empty, with nothing explaining why.

    ``scheduled_palace_ids`` is the round's review set. There is deliberately no
    "not in current config" reason: a palace this round scheduled stays in scope
    even when today's 随心 config would no longer pick it. But a palace whose
    cards were all 移除本队列 (``removed_palace_ids``) does leave — the learner
    explicitly took it out of this round.

    Reason priority is `palace_removed` → `no_questions` → `kinds_filtered`:
    the most actionable, learner-caused explanation wins, so a removed palace
    never reads as "no questions" when it actually has plenty.

    Reasons are stable codes; the frontend owns their Chinese copy.
    """
    live = {int(item) for item in in_pool_palace_ids}
    removed = {int(item) for item in removed_palace_ids}
    rows: list[dict[str, Any]] = []
    total = 0
    in_pool_count = 0
    for raw_palace_id in scheduled_palace_ids:
        palace_id = int(raw_palace_id)
        counts = counts_by_palace.get(palace_id) or {}
        objective = max(0, int(counts.get("objective") or 0))
        subjective = max(0, int(counts.get("subjective") or 0))
        question_count = objective + subjective
        total += question_count
        if palace_id in removed:
            reason = palace_removed_reason
        elif question_count <= 0:
            reason = no_questions_reason
        elif palace_id not in live:
            # In scope with questions, but every one is of an unselected kind.
            reason = kinds_filtered_reason
        else:
            reason = ""
        contributes = not reason
        if contributes:
            in_pool_count += 1
        rows.append(
            {
                "palace_id": palace_id,
                "title": str(titles.get(palace_id) or "") or f"宫殿 {palace_id}",
                "question_count": question_count,
                "objective": objective,
                "subjective": subjective,
                "in_pool": contributes,
                "reason": reason,
            }
        )
    return {
        "scheduled_count": len(rows),
        "in_pool_count": in_pool_count,
        "question_count": total,
        "palaces": rows,
    }


def pick_question_node_rating(
    bound_node_uids: Sequence[str],
    rating_by_node_uid: Mapping[str, int],
) -> int | None:
    """Weakest this-round rating among a question's bound knowledge points.

    Returns ``None`` when the question binds no knowledge point at all (nothing
    to show), and ``QUESTION_RATING_NONE`` when it does bind nodes but this round
    has not rated any of them. The two must stay distinct: the first hides the
    badge, the second shows 「本轮尚未复习」.

    Lowest wins. A question binding several nodes is judged by its weakest one,
    which is the actionable signal before answering; an average would point at
    no particular knowledge point.
    """
    uids = [str(item) for item in bound_node_uids if str(item).strip()]
    if not uids:
        return None
    found = [
        int(rating_by_node_uid[uid])
        for uid in uids
        if uid in rating_by_node_uid and int(rating_by_node_uid[uid]) in {1, 2, 3, 4}
    ]
    if not found:
        return QUESTION_RATING_NONE
    return min(found)


def normalize_question_node_ratings(raw: Any) -> dict[str, int]:
    """Persist/restore the per-question badge map; it is display data."""
    data = raw if isinstance(raw, Mapping) else {}
    result: dict[str, int] = {}
    for key, value in data.items():
        question_id = _as_int(key, 0)
        if question_id <= 0:
            continue
        rating = _as_int(value, -1)
        # Absent means "no bound knowledge point"; only real scores are stored.
        if rating in {1, 2, 3, 4}:
            result[str(question_id)] = rating
    return result


def normalize_scope_palaces(raw: Any) -> dict[str, Any]:
    """Persist/restore the scope report verbatim; it is display data, not state."""
    data = raw if isinstance(raw, Mapping) else None
    if data is None:
        return empty_scope_palaces()
    rows: list[dict[str, Any]] = []
    raw_rows = data.get("palaces")
    if isinstance(raw_rows, Sequence) and not isinstance(raw_rows, str | bytes):
        for item in list(raw_rows)[:400]:
            if not isinstance(item, Mapping):
                continue
            palace_id = _as_int(item.get("palace_id"), 0)
            if palace_id <= 0:
                continue
            objective = max(0, _as_int(item.get("objective"), 0))
            subjective = max(0, _as_int(item.get("subjective"), 0))
            rows.append(
                {
                    "palace_id": palace_id,
                    "title": str(item.get("title") or "").strip()[:80] or f"宫殿 {palace_id}",
                    "question_count": max(0, _as_int(item.get("question_count"), objective + subjective)),
                    "objective": objective,
                    "subjective": subjective,
                    "in_pool": bool(item.get("in_pool")),
                    "reason": str(item.get("reason") or "").strip()[:40],
                }
            )
    return {
        "scheduled_count": max(0, _as_int(data.get("scheduled_count"), len(rows))),
        "in_pool_count": max(0, _as_int(data.get("in_pool_count"), 0)),
        "question_count": max(0, _as_int(data.get("question_count"), 0)),
        "palaces": rows,
    }


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
        "kind_counts": empty_kind_counts(),
        "scope_palaces": empty_scope_palaces(),
        "question_node_ratings": {},
        "parked": empty_parked_overlay(),
        "excluded_ids": [],
    }


def overlay_question_kind(question_type: str | None) -> str:
    return (
        OVERLAY_KIND_SUBJECTIVE
        if str(question_type or "").strip() == "short_answer"
        else "objective"
    )


def empty_kind_counts() -> dict[str, int]:
    return {"objective": 0, "subjective": 0}


def overlay_quiz_scope_signature(
    palace_ids: Sequence[int],
    quiz_scope: str,
    question_type: str = "all",
    mastery_buckets: Sequence[str] = (),
    weak_priority: bool = False,
    overlay_question_range: str = "all",
    overlay_question_kinds: Sequence[str] = (),
    overlay_type_order: str = OVERLAY_TYPE_ORDER_INTERLEAVE,
    overlay_type_palace_nesting: str = OVERLAY_NESTING_PALACE_THEN_TYPE,
) -> str:
    # Feed question_type, mastery buckets, weak priority, and due/all range
    # no longer change overlay membership. Overlay kinds and type order do.
    del question_type, mastery_buckets, weak_priority, overlay_question_range
    kinds = [kind for kind in DEFAULT_OVERLAY_QUESTION_KINDS if kind in set(overlay_question_kinds)]
    if not kinds:
        kinds = list(DEFAULT_OVERLAY_QUESTION_KINDS)
    type_order = str(overlay_type_order or OVERLAY_TYPE_ORDER_INTERLEAVE)
    if type_order not in {
        OVERLAY_TYPE_ORDER_INTERLEAVE,
        OVERLAY_TYPE_ORDER_OBJECTIVE_FIRST,
        OVERLAY_TYPE_ORDER_SUBJECTIVE_FIRST,
    }:
        type_order = OVERLAY_TYPE_ORDER_INTERLEAVE
    nesting = str(overlay_type_palace_nesting or OVERLAY_NESTING_PALACE_THEN_TYPE)
    if nesting not in {OVERLAY_NESTING_PALACE_THEN_TYPE, OVERLAY_NESTING_TYPE_THEN_PALACE}:
        nesting = OVERLAY_NESTING_PALACE_THEN_TYPE
    return json.dumps(
        {
            "palace_ids": sorted({int(item) for item in palace_ids if int(item) > 0}),
            "quiz_scope": str(quiz_scope or QUIZ_SCOPE_CROSS),
            "overlay_question_kinds": kinds,
            "overlay_type_order": type_order,
            "overlay_type_palace_nesting": nesting,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def order_overlay_questions(
    cards: Sequence[Mapping[str, Any]],
    palace_ids: Sequence[int],
    *,
    quiz_scope: str,
    type_order: str,
    nesting: str,
    seed: int,
) -> list[dict[str, Any]]:
    """Order overlay cards by palace draw and 客观/主观 mix or sequential rules."""
    items = [dict(card) for card in cards]
    by_palace: dict[int, list[dict[str, Any]]] = {int(palace_id): [] for palace_id in palace_ids}
    for card in items:
        palace_id = int(card.get("palace_id") or 0)
        if palace_id not in by_palace:
            by_palace[palace_id] = []
        by_palace[palace_id].append(card)
    sequential = type_order in {
        OVERLAY_TYPE_ORDER_OBJECTIVE_FIRST,
        OVERLAY_TYPE_ORDER_SUBJECTIVE_FIRST,
    }
    present_kinds = {str(card.get("kind") or "objective") for card in items}
    if not sequential or len(present_kinds) < 2:
        return order_quiz_stream_by_scope(
            by_palace,
            palace_ids,
            quiz_scope=quiz_scope,
            seed=seed,
        )
    first_kind = (
        "subjective"
        if type_order == OVERLAY_TYPE_ORDER_SUBJECTIVE_FIRST
        else "objective"
    )
    second_kind = "objective" if first_kind == "subjective" else "subjective"
    kind_order = (first_kind, second_kind)
    if quiz_scope == QUIZ_SCOPE_SINGLE and nesting == OVERLAY_NESTING_PALACE_THEN_TYPE:
        result: list[dict[str, Any]] = []
        for palace_id in palace_ids:
            for kind in kind_order:
                palace_cards = [
                    card
                    for card in by_palace.get(palace_id, ())
                    if str(card.get("kind") or "objective") == kind
                ]
                result.extend(
                    deterministic_shuffle(
                        palace_cards,
                        seed=seed,
                        salt=f"palace:{palace_id}:{kind}",
                    )
                )
        return result
    result = []
    for kind in kind_order:
        kind_by_palace = {
            palace_id: [
                card
                for card in by_palace.get(palace_id, ())
                if str(card.get("kind") or "objective") == kind
            ]
            for palace_id in palace_ids
        }
        result.extend(
            order_quiz_stream_by_scope(
                kind_by_palace,
                palace_ids,
                quiz_scope=quiz_scope,
                seed=seed,
            )
        )
    return result


def normalize_overlay_quiz(raw: Mapping[str, Any] | None) -> OverlayQuiz:
    data = dict(raw or {})
    quiz_scope = str(data.get("quiz_scope") or QUIZ_SCOPE_CROSS)
    if quiz_scope not in QUIZ_SCOPES:
        quiz_scope = QUIZ_SCOPE_CROSS
    excluded_ids = _unique_positive_ids(data.get("excluded_ids"))
    excluded = set(excluded_ids)
    question_ids = [
        item for item in _unique_positive_ids(data.get("question_ids")) if item not in excluded
    ]
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
        "kind_counts": _normalize_kind_counts(data.get("kind_counts")),
        "scope_palaces": normalize_scope_palaces(data.get("scope_palaces")),
        "question_node_ratings": normalize_question_node_ratings(
            data.get("question_node_ratings")
        ),
        "parked": parked,
        "excluded_ids": excluded_ids,
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
    kind_counts: Mapping[str, Any] | None = None,
    scope_palaces: Mapping[str, Any] | None = None,
    question_node_ratings: Mapping[str, Any] | None = None,
) -> OverlayQuiz:
    previous = normalize_overlay_quiz(existing)
    excluded = set(previous["excluded_ids"])
    ordered = [item for item in _unique_positive_ids(question_ids) if item not in excluded]
    incoming_palace_ids = _normalize_palace_ids(question_palace_ids)
    palace_ids = {**previous["question_palace_ids"], **incoming_palace_ids}
    counts = (
        _normalize_kind_counts(kind_counts)
        if kind_counts is not None
        else previous["kind_counts"]
    )
    # The scope report always comes from the current pack: it describes the
    # scope right now, unlike question_ids which may keep the learner's order.
    scopes = (
        normalize_scope_palaces(scope_palaces)
        if scope_palaces is not None
        else previous["scope_palaces"]
    )
    # The badge map also comes from the current pack: it is this round's rating
    # state right now, which changes as the learner rates more units.
    badge_ratings = (
        normalize_question_node_ratings(question_node_ratings)
        if question_node_ratings is not None
        else previous["question_node_ratings"]
    )
    same_scope = (
        previous["scope_signature"] == str(scope_signature or "")
        and previous["quiz_scope"] == (quiz_scope if quiz_scope in QUIZ_SCOPES else QUIZ_SCOPE_CROSS)
        and int(previous["seed"]) == max(0, int(seed))
    )
    # Membership is the session identity. A pack that only shuffles the same
    # questions, or drops ids already recorded in excluded_ids, keeps the
    # learner's current order instead of pulling completed items to the front.
    same_session = same_scope and set(previous["question_ids"]) == set(ordered)
    if same_session:
        return normalize_overlay_quiz(
            {
                **previous,
                "limit_reached": bool(limit_reached),
                "candidate_count": max(0, int(candidate_count)),
                "question_palace_ids": palace_ids,
                "kind_counts": counts,
                "excluded_ids": previous["excluded_ids"],
                "scope_palaces": scopes,
                "question_node_ratings": badge_ratings,
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
            "kind_counts": counts,
            "excluded_ids": previous["excluded_ids"],
            "scope_palaces": scopes,
            "question_node_ratings": badge_ratings,
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
    """Union peer completed ids + answer states in this overlay pack. Do not move the index."""
    current = normalize_overlay_quiz(overlay)
    peer = normalize_overlay_quiz(peer_overlay)
    peer_completed = _unique_positive_ids([*peer["completed_ids"], *peer["parked"]["completed_ids"]])
    peer_states = {**peer["parked"]["states"], **peer["states"]}
    allowed = set(current["question_ids"])
    parked_allowed = set(current["parked"]["question_ids"])
    for question_id in peer_completed:
        state = peer_states.get(str(question_id))
        if question_id in allowed:
            if question_id not in current["completed_ids"]:
                current["completed_ids"].append(question_id)
            if isinstance(state, Mapping) and str(question_id) not in current["states"]:
                current["states"][str(question_id)] = dict(state)
        elif question_id in parked_allowed:
            parked = current["parked"]
            if question_id not in parked["completed_ids"]:
                parked["completed_ids"].append(question_id)
            if isinstance(state, Mapping) and str(question_id) not in parked["states"]:
                parked["states"][str(question_id)] = dict(state)
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


def _normalize_kind_counts(raw: Any) -> dict[str, int]:
    source = raw if isinstance(raw, Mapping) else {}
    return {
        "objective": max(0, _as_int(source.get("objective"), 0)),
        "subjective": max(0, _as_int(source.get("subjective"), 0)),
    }


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
    "QUESTION_RATING_NONE",
    "SCOPE_REASON_KINDS_FILTERED",
    "SCOPE_REASON_NO_QUESTIONS",
    "SCOPE_REASON_PALACE_REMOVED",
    "apply_overlay_progress",
    "build_scope_palaces",
    "drop_overlay_for_palaces",
    "empty_kind_counts",
    "empty_overlay_quiz",
    "empty_parked_overlay",
    "empty_scope_palaces",
    "inherit_overlay_completed",
    "merge_overlay_quiz",
    "normalize_overlay_quiz",
    "normalize_question_node_ratings",
    "normalize_scope_palaces",
    "order_overlay_questions",
    "overlay_question_kind",
    "overlay_quiz_scope_signature",
    "pick_question_node_rating",
]
