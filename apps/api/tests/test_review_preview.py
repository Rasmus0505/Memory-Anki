from __future__ import annotations

from memory_anki.modules.content.application.review_preview import (
    build_review_preview_payload,
)


def test_review_preview_counts_editor_nodes_and_suggests_top_level_segments():
    editor_doc = {
        "root": {
            "data": {"text": "Root", "uid": "root"},
            "children": [
                {"data": {"text": "Short", "uid": "a"}, "children": []},
                {
                    "data": {"text": "Branch", "uid": "b"},
                    "children": [
                        {"data": {"text": "Leaf one", "uid": "b1"}, "children": []},
                        {"data": {"text": "Leaf two", "uid": "b2"}, "children": []},
                    ],
                },
            ],
        }
    }

    preview = build_review_preview_payload(editor_doc=editor_doc)

    assert preview["node_count"] == 4
    assert preview["estimated_review_seconds"] == 180
    assert preview["estimated_review_time"] == {
        "min_seconds": 120,
        "max_seconds": 240,
        "min_minutes": 2,
        "max_minutes": 4,
    }
    assert preview["suggested_segments"]["count"] == 2
    assert preview["suggested_segments"]["items"][0] == {
        "title": "Short",
        "node_count": 1,
        "estimated_review_seconds": 60,
        "uid": "a",
    }
    assert preview["suggested_segments"]["list"] == preview["suggested_segments"]["items"]
    assert preview["difficulty_distribution"] == {"easy": 3, "medium": 1, "hard": 0}
    assert preview["warnings"] == []


def test_review_preview_falls_back_to_source_tree_and_warns_for_hard_nodes():
    source_tree = {
        "title": "Imported",
        "children": [
            {
                "text": "Dense branch",
                "children": [
                    {
                        "text": (
                            "This imported item is intentionally long enough to be "
                            "classified as hard for review planning heuristics, with "
                            "extra context that pushes it past the threshold."
                        ),
                        "children": [],
                    },
                    {
                        "text": (
                            "Another imported item is intentionally long enough to be "
                            "classified as hard for review planning heuristics, with "
                            "extra context that pushes it past the threshold."
                        ),
                        "children": [],
                    },
                ],
            },
            {
                "text": "Second dense branch",
                "children": [
                    {
                        "text": (
                            "A third imported item is intentionally long enough to be "
                            "classified as hard for review planning heuristics, with "
                            "extra context that pushes it past the threshold."
                        ),
                        "children": [],
                    }
                ],
            },
        ],
    }

    preview = build_review_preview_payload(source_tree=source_tree)

    assert preview["node_count"] == 5
    assert preview["difficulty_distribution"]["hard"] == 3
    assert preview["suggested_segments"]["count"] == 2
    assert "hard_node_heavy_tree" in preview["warnings"]


def test_review_preview_returns_empty_payload_for_missing_tree():
    preview = build_review_preview_payload()

    assert preview["node_count"] == 0
    assert preview["estimated_review_seconds"] == 0
    assert preview["suggested_segments"] == {"count": 0, "items": [], "list": []}
    assert preview["warnings"] == ["missing_review_tree"]
