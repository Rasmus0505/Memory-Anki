"""Startup prepares the text once. Later reads do not build it again."""

from types import SimpleNamespace

import pytest

from memory_anki.modules.content.application.study_text_library_cache import (
    configure_study_text_library_builder,
    prepare_study_text_library,
    read_prepared_study_text_library,
    remember_prepared_editor,
    reset_study_text_library_cache_for_test,
    session_changes_study_text,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    reset_study_text_library_cache_for_test()
    yield
    reset_study_text_library_cache_for_test()


def _payload(mark: str) -> dict:
    return {"editors": [{"palace": {"id": 7, "title": mark}}], "grouped": {"mark": mark}}


def test_prepare_builds_once_and_later_reads_do_not_build_again():
    calls = {"count": 0}

    def builder():
        calls["count"] += 1
        return _payload("first")

    configure_study_text_library_builder(builder)

    first = prepare_study_text_library(force=False)
    second = read_prepared_study_text_library()
    third = prepare_study_text_library(force=True, max_age_seconds=15)

    assert calls["count"] == 1
    assert second["editors"][0]["palace"]["title"] == "first"
    assert third["prepared_at"] == first["prepared_at"]


def test_forced_prepare_rebuilds_after_the_launch_window():
    calls = {"count": 0}

    def builder():
        calls["count"] += 1
        return _payload(str(calls["count"]))

    configure_study_text_library_builder(builder)
    prepare_study_text_library(force=False)
    prepare_study_text_library(force=True, max_age_seconds=0)

    assert calls["count"] == 2


def test_saved_editor_is_visible_without_rebuilding():
    configure_study_text_library_builder(lambda: _payload("old"))
    prepare_study_text_library(force=False)

    remember_prepared_editor(7, {"palace": {"id": 7, "title": "刚改的"}, "editor_doc": {}})

    assert read_prepared_study_text_library()["editors"][0]["palace"]["title"] == "刚改的"


def test_rating_tables_do_not_count_as_text_edits():
    palace = SimpleNamespace(__table__=SimpleNamespace(name="palaces"))
    rating = SimpleNamespace(__table__=SimpleNamespace(name="review_unit_states"))

    assert session_changes_study_text(SimpleNamespace(new=[palace], dirty=[], deleted=[]))
    assert not session_changes_study_text(SimpleNamespace(new=[], dirty=[rating], deleted=[]))
