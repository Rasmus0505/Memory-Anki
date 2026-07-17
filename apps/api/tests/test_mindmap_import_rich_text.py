from __future__ import annotations

from memory_anki.modules.palaces.application.mindmap_import.normalization import (
    build_editor_doc,
    source_node_to_editor_node,
)
from memory_anki.modules.palaces.application.mindmap_import.rich_text import (
    apply_emphasis_marks_to_html,
    normalize_emphasis_marks,
    normalize_rich_text_html,
    sanitize_rich_text_html,
)


def test_normalize_emphasis_marks_maps_legacy_kinds_to_highlight() -> None:
    marks = normalize_emphasis_marks(
        [
            {"kind": "underline", "text": "重点甲"},
            {"kind": "wavy-underline", "text": "重点乙"},
            {"kind": "highlight", "text": "重点丙"},
            {"kind": "unknown", "text": "忽略"},
            {"kind": "highlight", "text": "  "},
        ]
    )
    assert marks == [
        {"kind": "highlight", "text": "重点甲"},
        {"kind": "highlight", "text": "重点乙"},
        {"kind": "highlight", "text": "重点丙"},
    ]


def test_apply_emphasis_marks_to_html_uses_yellow_highlight() -> None:
    html = apply_emphasis_marks_to_html(
        "细胞膜由磷脂双分子层构成",
        [{"kind": "underline", "text": "磷脂双分子层"}],
        preserve_line_breaks=False,
    )
    assert 'data-emphasis="highlight"' in html
    assert "background-color:#fef08c" in html
    assert "color:inherit" in html
    assert "磷脂双分子层" in html
    assert "<u>" not in html


def test_normalize_rich_text_html_empty_when_no_marks() -> None:
    assert (
        normalize_rich_text_html(
            None,
            text="普通节点",
            emphasis_marks=[],
            preserve_line_breaks=False,
        )
        == ""
    )


def test_sanitize_rich_text_html_strips_scripts() -> None:
    cleaned = sanitize_rich_text_html(
        '<div>安全<span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">'
        "重点</span><script>alert(1)</script></div>"
    )
    assert "script" not in cleaned.lower()
    assert "重点" in cleaned
    assert 'data-emphasis="highlight"' in cleaned


def test_source_node_to_editor_node_applies_emphasis_marks() -> None:
    node = source_node_to_editor_node(
        {
            "text": "细胞膜由磷脂双分子层构成",
            "emphasis_marks": [{"kind": "highlight", "text": "磷脂双分子层"}],
            "children": [],
        },
        preserve_line_breaks=False,
    )
    assert node["data"]["richText"] is True
    assert 'data-emphasis="highlight"' in node["data"]["text"]
    assert "磷脂双分子层" in node["data"]["text"]


def test_source_node_to_editor_node_plain_without_marks() -> None:
    node = source_node_to_editor_node(
        {"text": "普通知识点", "children": []},
        preserve_line_breaks=False,
    )
    assert node["data"]["text"] == "普通知识点"
    assert "richText" not in node["data"]


def test_build_editor_doc_preserves_highlights() -> None:
    doc = build_editor_doc(
        {
            "title": "测试章节",
            "children": [
                {
                    "text": "定义：磷脂双分子层",
                    "emphasis_marks": [{"kind": "highlight", "text": "磷脂双分子层"}],
                    "children": [],
                }
            ],
        },
        fallback_title="回退",
        preserve_line_breaks=False,
    )
    child = doc["root"]["children"][0]
    assert child["data"]["richText"] is True
    assert 'data-emphasis="highlight"' in child["data"]["text"]
