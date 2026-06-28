from __future__ import annotations

from memory_anki.modules.palace_quiz.application.manual_text_quiz_parser import (
    parse_manual_text_quiz_pairs,
)


def test_parse_inline_four_options_in_one_line():
    parsed, warnings = parse_manual_text_quiz_pairs(
        question_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1. 下列说法正确的是()",
                "A. 甲 B. 乙 C. 丙 D. 丁",
            ]
        ),
        answer_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1.【答案】C 丙是正确答案。",
            ]
        ),
    )

    assert warnings == []
    assert len(parsed) == 1
    assert [option["id"] for option in parsed[0].options] == ["A", "B", "C", "D"]
    assert [option["text"] for option in parsed[0].options] == ["甲", "乙", "丙", "丁"]
    assert parsed[0].answer == "C"


def test_parse_inline_two_options_per_line():
    parsed, warnings = parse_manual_text_quiz_pairs(
        question_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1. 下列说法正确的是()",
                "A. 甲 B. 乙",
                "C. 丙 D. 丁",
            ]
        ),
        answer_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1.【答案】D 丁是正确答案。",
            ]
        ),
    )

    assert warnings == []
    assert len(parsed) == 1
    assert [option["id"] for option in parsed[0].options] == ["A", "B", "C", "D"]
    assert [option["text"] for option in parsed[0].options] == ["甲", "乙", "丙", "丁"]
    assert parsed[0].answer == "D"


def test_parse_one_option_per_line_still_works():
    parsed, warnings = parse_manual_text_quiz_pairs(
        question_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1. 下列说法正确的是()",
                "A. 甲",
                "B. 乙",
                "C. 丙",
                "D. 丁",
            ]
        ),
        answer_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1.【答案】A 甲是正确答案。",
            ]
        ),
    )

    assert warnings == []
    assert len(parsed) == 1
    assert [option["id"] for option in parsed[0].options] == ["A", "B", "C", "D"]
    assert [option["text"] for option in parsed[0].options] == ["甲", "乙", "丙", "丁"]


def test_residual_inline_marker_is_rejected_when_answer_cannot_match_split_options():
    parsed, warnings = parse_manual_text_quiz_pairs(
        question_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1. 下列说法正确的是()",
                "A. 甲",
                "补充说明 B. 乙",
                "C. 丙",
                "D. 丁",
            ]
        ),
        answer_text="\n".join(
            [
                "第一节 教育思想",
                "单项选择题",
                "1.【答案】C 丙是正确答案。",
            ]
        ),
    )

    assert parsed == []
    assert any("没有匹配到答案" in warning or "已跳过" in warning for warning in warnings)
