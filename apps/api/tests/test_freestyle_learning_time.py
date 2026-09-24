"""Pure domain tests for round-scoped freestyle learning time."""

from memory_anki.modules.practice.domain.learning_time import (
    MAX_ADD_SECONDS,
    MAX_SEGMENT_SECONDS,
    add_learning_seconds,
    apply_learning_adds,
    attribute_unassigned_unit_seconds,
    empty_learning_time,
    fold_freestyle_segment,
    normalize_learning_time,
    route_matches_workspace,
    single_palace_weight,
)
from memory_anki.modules.practice.domain.round_plan import normalize_plan


def test_normalize_learning_time_drops_unknown_keys_and_keeps_positive_palaces() -> None:
    normalized = normalize_learning_time(
        {
            "unit_seconds": -5,
            "quiz_seconds": 3,
            "lookup_seconds": "nope",
            "backfilled": 1,
            "extra": "drop",
            "by_palace": {
                "11": {
                    "unit_seconds": 2,
                    "quiz_seconds": -4,
                    "lookup_seconds": 0,
                    "noise": 9,
                },
                "12": {"unit_seconds": 0, "quiz_seconds": 0, "lookup_seconds": 0},
                "13": {"unit_seconds": -8, "quiz_seconds": -1, "lookup_seconds": -2},
                "0": {"unit_seconds": 8},
                "-3": {"quiz_seconds": 4},
                "bad": {"unit_seconds": 9},
                "14": "not-a-mapping",
                "15": {"lookup_seconds": 1},
            },
        }
    )

    assert set(normalized) == {
        "unit_seconds",
        "quiz_seconds",
        "lookup_seconds",
        "backfilled",
        "by_palace",
    }
    assert normalized["unit_seconds"] == 0
    assert normalized["quiz_seconds"] == 3
    assert normalized["lookup_seconds"] == 0
    assert normalized["backfilled"] is True
    assert set(normalized["by_palace"]) == {"11", "15"}
    assert normalized["by_palace"]["11"] == {
        "unit_seconds": 2,
        "quiz_seconds": 0,
        "lookup_seconds": 0,
    }
    assert normalized["by_palace"]["15"] == {
        "unit_seconds": 0,
        "quiz_seconds": 0,
        "lookup_seconds": 1,
    }


def test_add_learning_seconds_caps_live_adds_and_ignores_unknown_buckets() -> None:
    added = add_learning_seconds(None, bucket="unit", seconds=4000, palace_id=7)
    ignored = add_learning_seconds(added, bucket="dwell", seconds=50, palace_id=7)

    assert MAX_ADD_SECONDS == 3600
    assert added["unit_seconds"] == 3600
    assert added["quiz_seconds"] == 0
    assert added["by_palace"] == {
        "7": {"unit_seconds": 3600, "quiz_seconds": 0, "lookup_seconds": 0},
    }
    assert ignored == added


def test_apply_learning_adds_caps_live_adds_records_palace_and_skips_unknown() -> None:
    added = apply_learning_adds(
        {"unit_seconds": 4},
        [
            {"bucket": "quiz", "seconds": 5000, "palace_id": 11},
            {"bucket": "nope", "seconds": 20, "palace_id": 11},
            "not-a-mapping",
        ],
    )

    assert added["unit_seconds"] == 4
    assert added["quiz_seconds"] == MAX_ADD_SECONDS
    assert added["lookup_seconds"] == 0
    assert added["by_palace"] == {
        "11": {"unit_seconds": 0, "quiz_seconds": MAX_ADD_SECONDS, "lookup_seconds": 0},
    }


def test_fold_freestyle_segment_classifies_primary_workspace_routes() -> None:
    unit = fold_freestyle_segment(
        None,
        {
            "routePath": "/freestyle",
            "scene": "freestyle",
            "effectiveSeconds": 100,
            "palaceId": 11,
        },
        workspace="primary",
    )
    quiz = fold_freestyle_segment(
        None,
        {
            "routePath": "/freestyle",
            "scene": "quiz",
            "title": "做题",
            "palaceId": 11,
            "effectiveSeconds": 40,
        },
        workspace="primary",
    )
    lookup = fold_freestyle_segment(
        None,
        {
            "routePath": "/freestyle",
            "scene": "quiz",
            "title": "查看宫殿",
            "palaceId": 11,
            "effectiveSeconds": 25,
        },
        workspace="primary",
    )
    secondary_route = {
        "routePath": "/freestyle-2",
        "scene": "freestyle",
        "effectiveSeconds": 80,
        "palaceId": 11,
    }
    palace_quiz_route = {
        "routePath": "/palaces/11/quiz",
        "scene": "quiz",
        "title": "做题",
        "palaceId": 11,
        "effectiveSeconds": 40,
    }

    assert unit["unit_seconds"] == 100
    assert unit["quiz_seconds"] == 0
    assert unit["lookup_seconds"] == 0
    assert unit["by_palace"] == {}
    assert quiz["quiz_seconds"] == 40
    assert quiz["unit_seconds"] == 0
    assert quiz["by_palace"] == {
        "11": {"unit_seconds": 0, "quiz_seconds": 40, "lookup_seconds": 0},
    }
    assert lookup["lookup_seconds"] == 25
    assert lookup["quiz_seconds"] == 0
    assert lookup["by_palace"]["11"]["lookup_seconds"] == 25
    assert lookup["by_palace"]["11"]["quiz_seconds"] == 0
    assert fold_freestyle_segment(None, secondary_route, workspace="primary") == empty_learning_time()
    assert fold_freestyle_segment(None, palace_quiz_route, workspace="primary") == empty_learning_time()


def test_fold_historical_segment_uses_twelve_hour_cap_not_live_hour_cap() -> None:
    historical = fold_freestyle_segment(
        None,
        {
            "routePath": "/freestyle",
            "scene": "freestyle",
            "effectiveSeconds": 5000,
        },
        workspace="primary",
    )
    over_cap = fold_freestyle_segment(
        None,
        {
            "routePath": "/freestyle",
            "scene": "freestyle",
            "effectiveSeconds": MAX_SEGMENT_SECONDS + 1,
        },
        workspace="primary",
    )

    assert MAX_SEGMENT_SECONDS == 12 * 3600
    assert historical["unit_seconds"] == 5000
    assert historical["unit_seconds"] > MAX_ADD_SECONDS
    assert over_cap["unit_seconds"] == MAX_SEGMENT_SECONDS


def test_attribute_unassigned_unit_seconds_splits_leftover_by_largest_remainder() -> None:
    split = attribute_unassigned_unit_seconds(
        {
            "unit_seconds": 14,
            "quiz_seconds": 0,
            "lookup_seconds": 0,
            "backfilled": False,
            "by_palace": {
                "5": {"unit_seconds": 4, "quiz_seconds": 0, "lookup_seconds": 0},
            },
        },
        {1: 1, 2: 1, 3: 1},
    )
    ranked = attribute_unassigned_unit_seconds(
        {"unit_seconds": 5, "by_palace": {}},
        {22: 2, 11: 1},
    )

    assert split["unit_seconds"] == 14
    assert split["by_palace"]["5"]["unit_seconds"] == 4
    assert split["by_palace"]["1"]["unit_seconds"] == 4
    assert split["by_palace"]["2"]["unit_seconds"] == 3
    assert split["by_palace"]["3"]["unit_seconds"] == 3
    assert ranked["unit_seconds"] == 5
    assert ranked["by_palace"]["11"]["unit_seconds"] == 2
    assert ranked["by_palace"]["22"]["unit_seconds"] == 3


def test_attribute_unassigned_unit_seconds_empty_weights_leave_by_palace() -> None:
    time = {
        "unit_seconds": 10,
        "quiz_seconds": 2,
        "lookup_seconds": 0,
        "backfilled": False,
        "by_palace": {
            "7": {"unit_seconds": 3, "quiz_seconds": 2, "lookup_seconds": 0},
        },
    }

    for weights in ({}, None):
        result = attribute_unassigned_unit_seconds(time, weights)
        assert result["unit_seconds"] == 10
        assert result["by_palace"] == time["by_palace"]


def test_single_palace_weight_requires_exactly_one_palace() -> None:
    assert single_palace_weight(
        {
            "original_cards": [
                {"card_id": "a"},
                {"card_id": "b", "palace_id": 9},
                {"card_id": "c", "palace_id": 9},
                "skip",
            ]
        }
    ) == {9: 1}
    assert single_palace_weight(
        {"original_cards": [{"palace_id": 9}, {"palace_id": 10}]}
    ) == {}
    assert single_palace_weight({"original_cards": [{"palace_id": 0}, {"palace_id": -1}]}) == {}
    assert single_palace_weight({"original_cards": []}) == {}
    assert single_palace_weight(None) == {}


def test_route_matches_workspace_separates_primary_and_secondary() -> None:
    assert route_matches_workspace("/freestyle", "primary") is True
    assert route_matches_workspace("/freestyle", "secondary") is False
    assert route_matches_workspace("/freestyle-2", "secondary") is True
    assert route_matches_workspace("/freestyle-2", "primary") is False


def test_normalize_plan_keeps_learning_time() -> None:
    plan = normalize_plan(
        {
            "original_cards": [{"card_id": "a"}],
            "learning_time": {
                "unit_seconds": 12,
                "quiz_seconds": 3,
                "lookup_seconds": 1,
                "backfilled": False,
                "mystery": "drop-me",
                "by_palace": {"11": {"quiz_seconds": 3}},
            },
            "unknown_sibling": {"drop": True},
        }
    )

    assert "unknown_sibling" not in plan
    assert plan["learning_time"] == {
        "unit_seconds": 12,
        "quiz_seconds": 3,
        "lookup_seconds": 1,
        "backfilled": False,
        "by_palace": {
            "11": {"unit_seconds": 0, "quiz_seconds": 3, "lookup_seconds": 0},
        },
    }
