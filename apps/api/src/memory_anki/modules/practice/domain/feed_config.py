"""Freestyle immersive feed configuration validation."""

from __future__ import annotations

from typing import Any

DEFAULT_MINDMAP_WEIGHT = 2
DEFAULT_ANKI_WEIGHT = 2
DEFAULT_QUIZ_WEIGHT = 1
DEFAULT_NODE_LIMIT = 12
DEFAULT_QUEUE_LENGTH = 20
DEFAULT_SEED = 17
DEFAULT_MIX_RATIO_MINDMAP = 2
DEFAULT_MIX_RATIO_QUIZ = 1

DUE_POLICY_DUE_FIRST = "due_first_then_expand"
DUE_POLICY_DUE_ONLY = "due_only"
DUE_POLICY_ALL_WEIGHTED = "all_content_due_weighted"

PALACE_ORDER_SEQUENTIAL = "finish_palace_then_next"
PALACE_ORDER_INTERLEAVE = "interleave_palaces"

WITHIN_PALACE_TREE = "tree_order"
WITHIN_PALACE_SHUFFLE = "deterministic_shuffle"

MIX_MODE_MINDMAP_ONLY = "mindmap_only"
MIX_MODE_QUIZ_ONLY = "quiz_only"
MIX_MODE_SEQUENTIAL_MAP_QUIZ = "sequential_map_quiz"
MIX_MODE_SEQUENTIAL_QUIZ_MAP = "sequential_quiz_map"
MIX_MODE_RATIO = "ratio"
MIX_MODE_RANDOM = "random"

BOUND_QUIZ_FOLLOW_UNIT = "follow_unit"
BOUND_QUIZ_INTO_MIX = "into_mix"
BOUND_QUIZ_STREAM = "quiz_stream"

DUE_POLICIES = {
    DUE_POLICY_DUE_FIRST,
    DUE_POLICY_DUE_ONLY,
    DUE_POLICY_ALL_WEIGHTED,
}

MIX_MODES = {
    MIX_MODE_MINDMAP_ONLY,
    MIX_MODE_QUIZ_ONLY,
    MIX_MODE_SEQUENTIAL_MAP_QUIZ,
    MIX_MODE_SEQUENTIAL_QUIZ_MAP,
    MIX_MODE_RATIO,
    MIX_MODE_RANDOM,
}

BOUND_QUIZ_PLACEMENTS = {
    BOUND_QUIZ_FOLLOW_UNIT,
    BOUND_QUIZ_INTO_MIX,
    BOUND_QUIZ_STREAM,
}

# Freestyle progress buckets (must match memory projection progress_bucket values).
PROGRESS_SCOPE_OVERDUE = "overdue"
PROGRESS_SCOPE_DUE = "due"
PROGRESS_SCOPE_CALENDAR_TODAY = "calendar_today"
PROGRESS_SCOPE_REINFORCEMENT = "reinforcement"
PROGRESS_SCOPE_NEW = "new"

# Stable order for API / preference echo.
PROGRESS_SCOPE_ORDER = (
    PROGRESS_SCOPE_OVERDUE,
    PROGRESS_SCOPE_DUE,
    PROGRESS_SCOPE_CALENDAR_TODAY,
    PROGRESS_SCOPE_REINFORCEMENT,
    PROGRESS_SCOPE_NEW,
)

PROGRESS_SCOPES = frozenset(PROGRESS_SCOPE_ORDER)

# Default: clock-due formal + same-day restudy + first-learn; calendar_today opt-in.
DEFAULT_PROGRESS_SCOPES: tuple[str, ...] = (
    PROGRESS_SCOPE_OVERDUE,
    PROGRESS_SCOPE_DUE,
    PROGRESS_SCOPE_REINFORCEMENT,
    PROGRESS_SCOPE_NEW,
)

PALACE_ORDERS = {
    PALACE_ORDER_SEQUENTIAL,
    PALACE_ORDER_INTERLEAVE,
}

WITHIN_PALACE_ORDERS = {
    WITHIN_PALACE_TREE,
    WITHIN_PALACE_SHUFFLE,
}

QUESTION_TYPES = {
    "all",
    "multiple_choice",
    "true_false",
    "fill_blank",
    "matching",
    "ordering",
    "categorization",
    "short_answer",
}


def _as_bool(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _as_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _as_positive_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        result.append(number)
    return result


def _as_progress_scopes(value: Any, *, include_calendar_today_due: bool) -> list[str]:
    """Sanitize multi-select progress scopes; empty/invalid → defaults.

    Legacy ``include_calendar_today_due=True`` injects calendar_today when the
    raw scopes list is missing or when the flag is set without that scope.
    """
    if isinstance(value, list):
        selected: list[str] = []
        seen: set[str] = set()
        for item in value:
            key = str(item or "").strip()
            if key not in PROGRESS_SCOPES or key in seen:
                continue
            seen.add(key)
            selected.append(key)
        if include_calendar_today_due and PROGRESS_SCOPE_CALENDAR_TODAY not in seen:
            selected.append(PROGRESS_SCOPE_CALENDAR_TODAY)
        if selected:
            # Stable canonical order for equality / storage.
            return [key for key in PROGRESS_SCOPE_ORDER if key in set(selected)]
    # No valid list: start from product default, then legacy calendar flag.
    scopes = list(DEFAULT_PROGRESS_SCOPES)
    if include_calendar_today_due and PROGRESS_SCOPE_CALENDAR_TODAY not in scopes:
        scopes = [
            key
            for key in PROGRESS_SCOPE_ORDER
            if key in set(scopes) | {PROGRESS_SCOPE_CALENDAR_TODAY}
        ]
    return scopes


def _infer_mix_mode(
    raw_mode: Any,
    *,
    mindmap_enabled: bool,
    anki_enabled: bool,
    quiz_enabled: bool,
) -> str:
    mode = str(raw_mode or "").strip()
    if mode in MIX_MODES:
        return mode
    map_on = mindmap_enabled or anki_enabled
    if map_on and not quiz_enabled:
        return MIX_MODE_MINDMAP_ONLY
    if not map_on and quiz_enabled:
        return MIX_MODE_QUIZ_ONLY
    # Previous default: weighted interleave ≈ ratio.
    return MIX_MODE_RATIO


def _as_mix_ratio(
    value: Any,
    *,
    mindmap_weight: int,
    anki_weight: int,
    quiz_weight: int,
    has_explicit_weights: bool,
) -> dict[str, int]:
    if isinstance(value, dict):
        return {
            "mindmap": _as_int(
                value.get("mindmap"),
                DEFAULT_MIX_RATIO_MINDMAP,
                minimum=1,
                maximum=10,
            ),
            "quiz": _as_int(
                value.get("quiz"),
                DEFAULT_MIX_RATIO_QUIZ,
                minimum=1,
                maximum=10,
            ),
        }
    if has_explicit_weights:
        map_weight = max(0, mindmap_weight) + max(0, anki_weight)
        return {
            "mindmap": min(10, max(1, map_weight or DEFAULT_MIX_RATIO_MINDMAP)),
            "quiz": min(10, max(1, max(0, quiz_weight) or DEFAULT_MIX_RATIO_QUIZ)),
        }
    return {
        "mindmap": DEFAULT_MIX_RATIO_MINDMAP,
        "quiz": DEFAULT_MIX_RATIO_QUIZ,
    }


def _as_bound_placement(value: Any) -> str:
    key = str(value or "").strip()
    if key in BOUND_QUIZ_PLACEMENTS:
        return key
    return BOUND_QUIZ_FOLLOW_UNIT


def sanitize_feed_config(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    raw_content = data.get("content")
    content: dict[str, Any] = raw_content if isinstance(raw_content, dict) else {}
    raw_weights = data.get("weights")
    weights: dict[str, Any] = raw_weights if isinstance(raw_weights, dict) else {}
    mindmap_enabled = _as_bool(content.get("mindmap_branch"), True)
    anki_enabled = _as_bool(content.get("anki_card"), True)
    quiz_enabled = _as_bool(content.get("quiz_question"), True)
    if not mindmap_enabled and not anki_enabled and not quiz_enabled:
        mindmap_enabled = True
        anki_enabled = True
        quiz_enabled = True

    mindmap_weight = _as_int(
        weights.get("mindmap_branch"),
        DEFAULT_MINDMAP_WEIGHT,
        minimum=0,
        maximum=20,
    )
    anki_weight = _as_int(
        weights.get("anki_card"),
        DEFAULT_ANKI_WEIGHT,
        minimum=0,
        maximum=20,
    )
    quiz_weight = _as_int(
        weights.get("quiz_question"),
        DEFAULT_QUIZ_WEIGHT,
        minimum=0,
        maximum=20,
    )

    palace_order = str(data.get("palace_order") or PALACE_ORDER_SEQUENTIAL)
    if palace_order not in PALACE_ORDERS:
        palace_order = PALACE_ORDER_SEQUENTIAL

    within_palace_order = str(data.get("within_palace_order") or WITHIN_PALACE_TREE)
    if within_palace_order not in WITHIN_PALACE_ORDERS:
        within_palace_order = WITHIN_PALACE_TREE

    # Default due_only: freestyle mind-map cards are formal FSRS units only
    # (no zero-due practice fill). Expand policies still only emit due mindmaps.
    due_policy = str(data.get("due_policy") or DUE_POLICY_DUE_ONLY)
    if due_policy not in DUE_POLICIES:
        due_policy = DUE_POLICY_DUE_ONLY

    question_type = str(data.get("question_type") or "all")
    if question_type not in QUESTION_TYPES:
        question_type = "all"

    mix_mode = _infer_mix_mode(
        data.get("mix_mode"),
        mindmap_enabled=mindmap_enabled,
        anki_enabled=anki_enabled,
        quiz_enabled=quiz_enabled,
    )
    mix_ratio = _as_mix_ratio(
        data.get("mix_ratio"),
        mindmap_weight=mindmap_weight,
        anki_weight=anki_weight,
        quiz_weight=quiz_weight,
        has_explicit_weights=isinstance(raw_weights, dict) and bool(raw_weights),
    )
    bound_quiz_placement = _as_bound_placement(data.get("bound_quiz_placement"))

    # Legacy weights stay independent; mix_ratio is the interleave source of truth.
    # Zero out disabled content streams for older weight readers.
    synced_mindmap = mindmap_weight if mindmap_enabled else 0
    synced_anki = anki_weight if anki_enabled else 0
    synced_quiz = quiz_weight if quiz_enabled else 0

    # Legacy bool (default off). Kept as derived mirror of progress_scopes for
    # older clients; progress_scopes is the source of truth after sanitize.
    include_calendar_today_due = _as_bool(data.get("include_calendar_today_due"), False)
    progress_scopes = _as_progress_scopes(
        data.get("progress_scopes"),
        include_calendar_today_due=include_calendar_today_due,
    )
    include_calendar_today_due = PROGRESS_SCOPE_CALENDAR_TODAY in progress_scopes

    return {
        "content": {
            "mindmap_branch": mindmap_enabled,
            "anki_card": anki_enabled,
            "quiz_question": quiz_enabled,
        },
        "weights": {
            "mindmap_branch": synced_mindmap if mindmap_enabled else 0,
            "anki_card": synced_anki if anki_enabled else 0,
            "quiz_question": synced_quiz if quiz_enabled else 0,
        },
        "mix_mode": mix_mode,
        "mix_ratio": mix_ratio,
        "bound_quiz_placement": bound_quiz_placement,
        "palace_order": palace_order,
        "within_palace_order": within_palace_order,
        "due_policy": due_policy,
        "node_limit": _as_int(data.get("node_limit"), DEFAULT_NODE_LIMIT, minimum=3, maximum=50),
        "queue_length": _as_int(
            data.get("queue_length"), DEFAULT_QUEUE_LENGTH, minimum=5, maximum=100
        ),
        "specific_palace_ids": _as_positive_ids(data.get("specific_palace_ids")),
        "question_type": question_type,
        "weak_quiz_priority": _as_bool(data.get("weak_quiz_priority"), True),
        "progress_scopes": progress_scopes,
        # Derived mirror of progress_scopes (calendar_today membership).
        "include_calendar_today_due": include_calendar_today_due,
        "seed": _as_int(data.get("seed"), DEFAULT_SEED, minimum=1, maximum=2_147_483_647),
    }


__all__ = [
    "BOUND_QUIZ_FOLLOW_UNIT",
    "BOUND_QUIZ_INTO_MIX",
    "BOUND_QUIZ_PLACEMENTS",
    "BOUND_QUIZ_STREAM",
    "DEFAULT_ANKI_WEIGHT",
    "DEFAULT_MINDMAP_WEIGHT",
    "DEFAULT_MIX_RATIO_MINDMAP",
    "DEFAULT_MIX_RATIO_QUIZ",
    "DEFAULT_NODE_LIMIT",
    "DEFAULT_QUEUE_LENGTH",
    "DEFAULT_QUIZ_WEIGHT",
    "DEFAULT_SEED",
    "DUE_POLICIES",
    "DUE_POLICY_ALL_WEIGHTED",
    "DUE_POLICY_DUE_FIRST",
    "DUE_POLICY_DUE_ONLY",
    "MIX_MODE_MINDMAP_ONLY",
    "MIX_MODE_QUIZ_ONLY",
    "MIX_MODE_RANDOM",
    "MIX_MODE_RATIO",
    "MIX_MODE_SEQUENTIAL_MAP_QUIZ",
    "MIX_MODE_SEQUENTIAL_QUIZ_MAP",
    "MIX_MODES",
    "PALACE_ORDER_INTERLEAVE",
    "PALACE_ORDER_SEQUENTIAL",
    "PALACE_ORDERS",
    "DEFAULT_PROGRESS_SCOPES",
    "PROGRESS_SCOPE_CALENDAR_TODAY",
    "PROGRESS_SCOPE_DUE",
    "PROGRESS_SCOPE_NEW",
    "PROGRESS_SCOPE_ORDER",
    "PROGRESS_SCOPE_OVERDUE",
    "PROGRESS_SCOPE_REINFORCEMENT",
    "PROGRESS_SCOPES",
    "QUESTION_TYPES",
    "WITHIN_PALACE_ORDERS",
    "WITHIN_PALACE_SHUFFLE",
    "WITHIN_PALACE_TREE",
    "sanitize_feed_config",
]