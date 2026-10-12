"""The open-time text snapshot groups owned and chapter questions without media."""

from memory_anki.modules.content.application.study_text_library import (
    group_bindings_by_palace,
    group_questions_by_palace,
)
from memory_anki.modules.content.presentation import study_text_library_router


def test_summary_scope_keeps_the_shelf_and_drops_per_palace_text(monkeypatch):
    prepared = {
        "editors": [{"palace": {"id": 7, "title": "宫殿"}}],
        "questions_by_palace": {"7": [{"id": 1, "palace_id": 7}]},
        "bindings_by_palace": {"7": [{"node_uid": "n1"}]},
        "grouped": {"groups": [{"palace_id": 7}]},
        "subjects": {"subjects": [{"name": "学科"}]},
        "prepared_at": "2026-10-12T00:00:00",
    }
    monkeypatch.setattr(
        study_text_library_router, "read_prepared_study_text_library", lambda: prepared
    )

    summary = study_text_library_router.api_study_text_library(scope="summary")

    assert summary["grouped"] == prepared["grouped"]
    assert summary["subjects"] == prepared["subjects"]
    assert summary["prepared_at"] == prepared["prepared_at"]
    assert summary["editors"] == []
    assert summary["questions_by_palace"] == {}
    assert summary["bindings_by_palace"] == {}


def test_full_scope_returns_the_prepared_payload_untouched(monkeypatch):
    prepared = {
        "editors": [{"palace": {"id": 7, "title": "宫殿"}}],
        "questions_by_palace": {"7": [{"id": 1, "palace_id": 7}]},
        "bindings_by_palace": {"7": [{"node_uid": "n1"}]},
        "grouped": {"groups": [{"palace_id": 7}]},
        "subjects": {"subjects": [{"name": "学科"}]},
        "prepared_at": "2026-10-12T00:00:00",
    }
    monkeypatch.setattr(
        study_text_library_router, "read_prepared_study_text_library", lambda: prepared
    )

    assert study_text_library_router.api_study_text_library(scope="full") is prepared


def test_group_questions_includes_owned_and_minimal_chapter_questions_once():
    questions = [
        {"id": 1, "palace_id": 7, "source_chapter_id": 3, "stem": "owned"},
        {"id": 2, "palace_id": 9, "source_chapter_id": 3, "stem": "chapter"},
        {"id": 2, "palace_id": 9, "classified_chapter_id": 3, "stem": "chapter"},
    ]

    grouped = group_questions_by_palace(questions, {7: [3]})

    assert [item["id"] for item in grouped["7"]] == [1, 2]
    assert grouped["9"][0]["stem"] == "chapter"


def test_group_bindings_adds_labels_from_the_loaded_editor():
    editors = [
        {
            "palace": {"id": 7, "title": "宫殿"},
            "editor_doc": {
                "root": {"data": {"uid": "n1", "text": "节点"}},
            },
        }
    ]
    bindings = [
        {
            "palace_id": 7,
            "question_owner_palace_id": 7,
            "node_uid": "n1",
        }
    ]

    grouped = group_bindings_by_palace(bindings, editors)

    assert grouped["7"][0]["node_text"] == "节点"
    assert grouped["7"][0]["target_palace_title"] == "宫殿"
    assert grouped["7"][0]["question_owner_palace_title"] == "宫殿"
