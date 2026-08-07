"""Freestyle immersive feed configuration validation."""

from __future__ import annotations

from typing import Any

DEFAULT_MINDMAP_WEIGHT = 2
DEFAULT_ANKI_WEIGHT = 2
DEFAULT_QUIZ_WEIGHT = 1
DEFAULT_QUEUE_LENGTH = 20
DEFAULT_SEED = 17
DEFAULT_MIX_RATIO_MINDMAP = 2
DEFAULT_MIX_RATIO_QUIZ = 1

DUE_POLICY_DUE_FIRST = "due_first_then_expand"
DUE_POLICY_DUE_ONLY = "due_only"
DUE_POLICY_ALL_WEIGHTED = "all_content_due_weighted"

PALACE_ORDER_SEQUENTIAL = "finish_palace_then_next"
PALACE_ORDER_INTERLEAVE = "interleave_palaces"

MIX_MODE_MINDMAP_ONLY = "mindmap_only"
MIX_MODE_QUIZ_ONLY = "quiz_only"
MIX_MODE_SEQUENTIAL_MAP_QUIZ = "sequential_map_quiz"
MIX_MODE_SEQUENTIAL_QUIZ_MAP = "sequential_quiz_map"
MIX_MODE_RATIO = "ratio"
MIX_MODE_RANDOM = "random"

BOUND_QUIZ_FOLLOW_UNIT = "follow_unit"
BOUND_QUIZ_INTO_MIX = "into_mix"
BOUND_QUIZ_STREAM = "quiz_stream"

QUIZ_SCOPE_CROSS = "cross_palace_random"
QUIZ_SCOPE_SINGLE = "single_palace_random"

QUIZ_MASTERY_UNSEEN = "unseen"
QUIZ_MASTERY_WEAK = "weak"
QUIZ_MASTERY_REINFORCE = "reinforce"
QUIZ_MASTERY_STABLE = "stable"

DEFAULT_QUIZ_MASTERY_BUCKETS = [
    QUIZ_MASTERY_UNSEEN,
    QUIZ_MASTERY_WEAK,
    QUIZ_MASTERY_REINFORCE,
]

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

PALACE_ORDERS = {
    PALACE_ORDER_SEQUENTIAL,
    PALACE_ORDER_INTERLEAVE,
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

QUIZ_MASTERY_BUCKETS = {
    QUIZ_MASTERY_UNSEEN,
    QUIZ_MASTERY_WEAK,
    QUIZ_MASTERY_REINFORCE,
    QUIZ_MASTERY_STABLE,
}

QUIZ_SCOPES = {
    QUIZ_SCOPE_CROSS,
    QUIZ_SCOPE_SINGLE,
}

SUBJECT_SCOPES = {"all", "english", "non_english"}

TRAINING_MODES = {"memory_palace", "quiz", "english", "mixed"}
TRAINING_STREAMS = {"memory_palace", "quiz", "english"}
UNIT_ORDERS = {"structured", "random"}
MIX_STRATEGIES = {"ratio", "random", "sequential"}


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


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
    # Previous default: weighted interleave approx ratio.
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
    """Missing placement defaults to into_mix so bound quizzes join mix_ratio."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return BOUND_QUIZ_INTO_MIX
    key = str(value).strip()
    if key in BOUND_QUIZ_PLACEMENTS:
        return key
    return BOUND_QUIZ_INTO_MIX


def _as_quiz_scope(value: Any) -> str:
    key = str(value or "").strip()
    if key in QUIZ_SCOPES:
        return key
    return QUIZ_SCOPE_CROSS


def _as_subject_scope(value: Any) -> str:
    key = str(value or "").strip()
    return key if key in SUBJECT_SCOPES else "all"


def _as_training_mode(value: Any, fallback: str) -> str:
    key = str(value or "").strip()
    return key if key in TRAINING_MODES else fallback


def _as_unit_order(value: Any) -> str:
    key = str(value or "").strip()
    return key if key in UNIT_ORDERS else "structured"


def _as_mix_strategy(value: Any) -> str:
    key = str(value or "").strip()
    return key if key in MIX_STRATEGIES else "ratio"


def _stream_scope(value: Any, *, ids: list[int], subject_scope: str) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    return {
        "specific_palace_ids": _as_positive_ids(raw.get("specific_palace_ids", ids)),
        "subject_scope": _as_subject_scope(raw.get("subject_scope", subject_scope)),
    }


def _infer_training_mode(
    raw_mode: Any,
    raw_mix_mode: Any,
    *,
    mindmap_enabled: bool,
    quiz_enabled: bool,
    subject_scope: str,
) -> str:
    explicit = _as_training_mode(raw_mode, "")
    if explicit:
        return explicit
    legacy_mix = str(raw_mix_mode or "").strip()
    if legacy_mix == MIX_MODE_QUIZ_ONLY:
        return "quiz"
    if legacy_mix == MIX_MODE_MINDMAP_ONLY:
        return "english" if subject_scope == "english" else "memory_palace"
    if mindmap_enabled and not quiz_enabled:
        return "english" if subject_scope == "english" else "memory_palace"
    if quiz_enabled and not mindmap_enabled:
        return "quiz"
    return "mixed"


def _sanitize_mixed_modes(value: Any, fallback: list[str]) -> list[str]:
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            key = str(item or "").strip()
            if key in TRAINING_STREAMS and key not in result:
                result.append(key)
        if result:
            return result
    return list(fallback)


def _as_quiz_mastery_buckets(
    value: Any,
    *,
    due_policy: str,
    has_explicit_field: bool,
) -> list[str]:
    if isinstance(value, list):
        result: list[str] = []
        seen: set[str] = set()
        for item in value:
            key = str(item or "").strip()
            if key not in QUIZ_MASTERY_BUCKETS or key in seen:
                continue
            seen.add(key)
            result.append(key)
        if result:
            return result
    # Legacy expand policies implied "also pull stable / fill" quizzes.
    if not has_explicit_field and due_policy in {
        DUE_POLICY_DUE_FIRST,
        DUE_POLICY_ALL_WEIGHTED,
    }:
        return [*DEFAULT_QUIZ_MASTERY_BUCKETS, QUIZ_MASTERY_STABLE]
    return list(DEFAULT_QUIZ_MASTERY_BUCKETS)


def sanitize_feed_config(raw: Any) -> dict[str, Any]:
    data = _as_dict(raw)
    raw_content = data.get("content")
    content: dict[str, Any] = raw_content if isinstance(raw_content, dict) else {}
    legacy_mindmap = _as_bool(content.get("mindmap_branch"), True)
    legacy_quiz = _as_bool(content.get("quiz_question"), True)
    legacy_subject = _as_subject_scope(data.get("subject_scope"))
    legacy_mode = _infer_training_mode(
        data.get("training_mode"),
        data.get("mix_mode"),
        mindmap_enabled=legacy_mindmap,
        quiz_enabled=legacy_quiz,
        subject_scope=legacy_subject,
    )
    legacy_ids = _as_positive_ids(data.get("specific_palace_ids"))
    legacy_due = str(data.get("due_policy") or DUE_POLICY_DUE_FIRST)
    if legacy_due not in DUE_POLICIES:
        legacy_due = DUE_POLICY_DUE_FIRST
    legacy_order = str(data.get("palace_order") or PALACE_ORDER_SEQUENTIAL)
    if legacy_order not in PALACE_ORDERS:
        legacy_order = PALACE_ORDER_SEQUENTIAL

    raw_streams = _as_dict(data.get("streams"))
    has_new_config = "training_mode" in data or "streams" in data
    raw_memory = _as_dict(raw_streams.get("memory_palace"))
    raw_quiz = _as_dict(raw_streams.get("quiz"))
    raw_english = _as_dict(raw_streams.get("english"))

    memory = {
        **_stream_scope(
            raw_memory,
            ids=[] if legacy_subject == "english" else legacy_ids,
            subject_scope="non_english",
        ),
        "due_policy": str(raw_memory.get("due_policy") or legacy_due),
        "palace_order": str(raw_memory.get("palace_order") or legacy_order),
        "unit_order": _as_unit_order(raw_memory.get("unit_order")),
    }
    if memory["due_policy"] not in DUE_POLICIES:
        memory["due_policy"] = DUE_POLICY_DUE_FIRST
    if memory["palace_order"] not in PALACE_ORDERS:
        memory["palace_order"] = PALACE_ORDER_SEQUENTIAL
    memory["subject_scope"] = "non_english" if memory["subject_scope"] == "english" else memory["subject_scope"]

    english = {
        **_stream_scope(
            raw_english,
            ids=legacy_ids if legacy_subject == "english" else [],
            subject_scope="english",
        ),
        "due_policy": str(raw_english.get("due_policy") or legacy_due),
        "palace_order": str(raw_english.get("palace_order") or legacy_order),
        "unit_order": _as_unit_order(raw_english.get("unit_order")),
    }
    english["subject_scope"] = "english"
    if english["due_policy"] not in DUE_POLICIES:
        english["due_policy"] = DUE_POLICY_DUE_FIRST
    if english["palace_order"] not in PALACE_ORDERS:
        english["palace_order"] = PALACE_ORDER_SEQUENTIAL

    quiz = {
        **_stream_scope(raw_quiz, ids=legacy_ids, subject_scope=legacy_subject),
        "question_type": str(raw_quiz.get("question_type") or data.get("question_type") or "all"),
        "mastery_buckets": _as_quiz_mastery_buckets(
            raw_quiz.get("mastery_buckets", data.get("quiz_mastery_buckets")),
            due_policy=memory["due_policy"],
            has_explicit_field=(
                has_new_config
                or not data
                or "due_policy" not in data
                or "mastery_buckets" in raw_quiz
                or "quiz_mastery_buckets" in data
            ),
        ),
        "quiz_scope": _as_quiz_scope(raw_quiz.get("quiz_scope", data.get("quiz_scope"))),
        "weak_priority": _as_bool(raw_quiz.get("weak_priority", data.get("weak_quiz_priority")), True),
    }
    if quiz["question_type"] not in QUESTION_TYPES:
        quiz["question_type"] = "all"

    fallback_modes = (
        ["memory_palace", "quiz"]
        if legacy_mode == "mixed"
        else ["english" if legacy_mode == "english" else "quiz" if legacy_mode == "quiz" else "memory_palace"]
    )
    training_mode = _as_training_mode(data.get("training_mode"), legacy_mode)
    mixed_modes = _sanitize_mixed_modes(data.get("mixed_modes"), fallback_modes)
    if training_mode != "mixed":
        mixed_modes = [training_mode]
    if training_mode == "mixed" and len(mixed_modes) < 2:
        training_mode = mixed_modes[0] if mixed_modes else "memory_palace"
        mixed_modes = [training_mode]

    raw_mix = _as_dict(data.get("mix"))
    raw_ratios = _as_dict(raw_mix.get("ratios"))
    stream_ratios: dict[str, int] = {
        "memory_palace": _as_int(raw_ratios.get("memory_palace"), 2, minimum=1, maximum=10),
        "quiz": _as_int(raw_ratios.get("quiz"), 1, minimum=1, maximum=10),
        "english": _as_int(raw_ratios.get("english"), 1, minimum=1, maximum=10),
    }
    mix: dict[str, Any] = {
        "strategy": _as_mix_strategy(raw_mix.get("strategy")),
        "ratios": stream_ratios,
    }

    has_memory = training_mode == "memory_palace" or (training_mode == "mixed" and "memory_palace" in mixed_modes)
    has_english = training_mode == "english" or (training_mode == "mixed" and "english" in mixed_modes)
    has_quiz = training_mode == "quiz" or (training_mode == "mixed" and "quiz" in mixed_modes)
    map_ratio = sum(stream_ratios[item] for item in mixed_modes if item in {"memory_palace", "english"})
    quiz_ratio = stream_ratios["quiz"] if has_quiz else 0
    first_map = next((item for item in mixed_modes if item in {"memory_palace", "english"}), None)
    if training_mode == "quiz":
        mix_mode = MIX_MODE_QUIZ_ONLY
    elif training_mode in {"memory_palace", "english"} or not has_quiz:
        mix_mode = MIX_MODE_MINDMAP_ONLY
    elif mix["strategy"] == "random":
        mix_mode = MIX_MODE_RANDOM
    elif mix["strategy"] == "sequential":
        mix_mode = MIX_MODE_SEQUENTIAL_MAP_QUIZ if first_map else MIX_MODE_SEQUENTIAL_QUIZ_MAP
    else:
        mix_mode = MIX_MODE_RATIO

    legacy_specific_ids = list(dict.fromkeys([
        *(memory["specific_palace_ids"] if has_memory else []),
        *(english["specific_palace_ids"] if has_english else []),
        *(quiz["specific_palace_ids"] if has_quiz else []),
    ]))
    legacy_scope = (
        "english" if training_mode == "english"
        else memory["subject_scope"] if training_mode == "memory_palace"
        else quiz["subject_scope"] if training_mode == "quiz"
        else "all"
    )
    map_due = memory["due_policy"] if has_memory else english["due_policy"]
    map_order = memory["palace_order"] if has_memory else english["palace_order"]
    mindmap_weight = max(1, map_ratio or 2) if has_memory or has_english else 0
    quiz_weight = max(1, quiz_ratio or 1) if has_quiz else 0

    return {
        "training_mode": training_mode,
        "mixed_modes": mixed_modes,
        "streams": {"memory_palace": memory, "quiz": quiz, "english": english},
        "mix": mix,
        "queue_length": _as_int(data.get("queue_length"), DEFAULT_QUEUE_LENGTH, minimum=5, maximum=100),
        "seed": _as_int(data.get("seed"), DEFAULT_SEED, minimum=1, maximum=2_147_483_647),
        "content": {
            "mindmap_branch": has_memory or has_english,
            "anki_card": False,
            "quiz_question": has_quiz,
        },
        "weights": {
            "mindmap_branch": mindmap_weight,
            "anki_card": 0,
            "quiz_question": quiz_weight,
        },
        "mix_mode": mix_mode,
        "mix_ratio": {"mindmap": mindmap_weight or 2, "quiz": quiz_weight or 1},
        "bound_quiz_placement": _as_bound_placement(data.get("bound_quiz_placement")),
        "palace_order": map_order,
        "due_policy": map_due,
        "quiz_mastery_buckets": quiz["mastery_buckets"],
        "quiz_scope": quiz["quiz_scope"],
        "specific_palace_ids": legacy_specific_ids,
        "subject_scope": legacy_scope,
        "question_type": quiz["question_type"],
        "weak_quiz_priority": quiz["weak_priority"],
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
    "DEFAULT_QUEUE_LENGTH",
    "DEFAULT_QUIZ_MASTERY_BUCKETS",
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
    "QUESTION_TYPES",
    "QUIZ_MASTERY_REINFORCE",
    "QUIZ_MASTERY_BUCKETS",
    "QUIZ_MASTERY_STABLE",
    "QUIZ_MASTERY_UNSEEN",
    "QUIZ_MASTERY_WEAK",
    "QUIZ_SCOPE_CROSS",
    "QUIZ_SCOPE_SINGLE",
    "QUIZ_SCOPES",
    "sanitize_feed_config",
]
