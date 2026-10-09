"""Bubble-only lookup hints stay on the words drawn on the map."""

from memory_anki.modules.content.application.mindmap_bubble_search import (
    first_matching_bubble_text,
)


def test_first_bubble_is_top_to_bottom_and_ignores_article_and_title() -> None:
    doc = {
        "root": {
            "data": {
                "text": "英国教育",
                "articleBody": "不该先命中文章里的初等教育法",
            },
            "children": [
                {
                    "data": {"text": "<b>1870年颁布《初等教育法》</b>", "note": "备注"},
                    "children": [],
                },
                {"data": {"text": "后面的初等教育法"}, "children": []},
            ],
        }
    }

    assert first_matching_bubble_text(doc, "初等教育法", skip_equal_to="英国教育") == (
        "1870年颁布《初等教育法》"
    )
    assert first_matching_bubble_text(doc, "英国", skip_equal_to="英国教育") is None
