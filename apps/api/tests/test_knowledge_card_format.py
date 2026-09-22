"""The importer's card and quiz shaping, exercised on the real functions."""

from memory_anki.modules.produce.application.mindmap_import.knowledge_card_format import (
    bind_text_for_question,
    format_continuous_block,
    format_knowledge_tree,
    prepare_quiz_import,
    prepare_quiz_rows_with_subjective_twins,
)


def test_numbered_label_drops_index_and_trailing_period() -> None:
    tree = format_knowledge_tree(
        {"title": "示例", "children": [{"text": "（1）相同点。", "children": []}]}
    )
    assert tree["children"] == [{"text": "相同点", "children": []}]


def test_dash_joined_pair_splits_into_parent_and_child() -> None:
    tree = format_knowledge_tree(
        {
            "title": "示例",
            "children": [{"text": "相同点——开办西式学校", "children": []}],
        }
    )
    node = tree["children"][0]
    assert node["text"] == "相同点"
    assert node["children"] == [{"text": "开办西式学校", "children": []}]


def test_contrast_sentence_splits_and_keeps_a_mnemonic() -> None:
    raw = (
        "（2）不同点：洋务运动教育改革旨在保留封建教育的同时，兴办西式近代教育；"
        "明治维新教育改革以否定封建教育为前提，兴办西式近代教育。"
    )
    tree = format_knowledge_tree(
        {"title": "示例", "children": [{"text": raw, "children": []}]}
    )
    node = tree["children"][0]
    assert node["text"] == "不同点"
    texts = [child["text"] for child in node["children"]]
    assert texts[0] == "洋明"
    assert "洋务运动教育改革旨在保留封建教育的同时，兴办西式近代教育" in texts
    assert "明治维新教育改革以否定封建教育为前提，兴办西式近代教育" in texts


def test_parent_with_two_or_more_children_inserts_core_char_mnemonic() -> None:
    tree = format_knowledge_tree(
        {
            "title": "夸美纽斯",
            "children": [
                {
                    "text": "著作",
                    "children": [
                        {"text": "《大教学论》", "children": []},
                        {"text": "《母育学校》", "children": []},
                        {"text": "《世界图解》", "children": []},
                    ],
                }
            ],
        }
    )
    works = tree["children"][0]
    assert works["text"] == "著作"
    assert [child["text"] for child in works["children"]] == [
        "大母世",
        "《大教学论》",
        "《母育学校》",
        "《世界图解》",
    ]


def test_parent_phrase_is_trimmed_only_from_the_start_of_a_child() -> None:
    tree = format_knowledge_tree(
        {
            "title": "夸美纽斯",
            "children": [
                {
                    "text": "《大教学论》",
                    "children": [
                        {
                            "text": "《大教学论》的出版是教育学开始成为一门独立学科的标志，《大教学论》是西方第一本独立形态的教育学著作。",
                            "children": [],
                        }
                    ],
                }
            ],
        }
    )
    child = tree["children"][0]["children"][0]
    assert child["text"].startswith("出版是教育学开始成为一门独立学科的标志")
    assert "《大教学论》是西方第一本独立形态的教育学著作。" in child["text"]


def test_underline_substring_is_kept_and_missing_mark_is_dropped() -> None:
    tree = format_knowledge_tree(
        {
            "title": "示例",
            "children": [
                {
                    "text": "学在官府是西周教育制度最重要的特征。",
                    "children": [],
                    "emphasis_marks": [
                        {"kind": "highlight", "text": "学在官府"},
                        {"kind": "highlight", "text": "并不在节点里"},
                    ],
                }
            ],
        }
    )
    node = tree["children"][0]
    assert node["text"] == "学在官府是西周教育制度最重要的特征。"
    assert node["emphasis_marks"] == [{"kind": "highlight", "text": "学在官府"}]
    assert "**" not in node["text"]


def test_continuous_block_is_one_untitled_card() -> None:
    assert format_continuous_block("一段连续文字，不拆树。") == {
        "title": "图中全文",
        "children": [],
    }


def test_duplicate_questions_keep_both_confirmed_years_once() -> None:
    item = {
        "stem": "学在官府形成的根本原因是（　　）。",
        "options": [
            {"id": "A", "text": "生产力发展水平低下"},
            {"id": "B", "text": "惟官有书，而民无书"},
        ],
        "correct_option_id": "A",
        "knowledge_point": "学在官府",
        "analysis": "根本原因是生产力。",
    }
    ready, skipped = prepare_quiz_import(
        [
            {**item, "sources": [{"teacher": "凯程老师", "kind": "333真题", "year": "2026版"}]},
            {**item, "sources": [{"teacher": "凯程老师", "kind": "333真题", "year": "2027版"}]},
        ]
    )
    assert skipped == []
    assert len(ready) == 1
    assert ready[0]["stem"].startswith("【凯程老师｜333真题｜2026版】【凯程老师｜333真题｜2027版】")
    assert ready[0]["correct_option_id"] == "A"
    assert ready[0]["options"][0]["text"] == "生产力发展水平低下"


def test_unconfirmed_source_is_omitted_not_guessed() -> None:
    ready, skipped = prepare_quiz_import(
        [
            {
                "stem": "六艺的中心是（　　）。",
                "options": [{"id": "A", "text": "礼乐"}],
                "correct_option_id": "A",
                "knowledge_point": "六艺",
                "sources": [{"teacher": "", "kind": "", "year": ""}],
            }
        ]
    )
    assert skipped == []
    assert ready[0]["stem"] == "六艺的中心是（　　）。"
    assert ready[0]["source_meta"]["sources"] == []


def test_later_chapters_and_unreadable_items_are_not_imported() -> None:
    ready, skipped = prepare_quiz_import(
        [
            {
                "stem": "蔡元培提出的教育方针是（　　）。",
                "options": [{"id": "A", "text": "五育并举"}],
                "correct_option_id": "A",
                "knowledge_point": "蔡元培",
                "chapter_title": "近代教育体制的变革",
                "sources": [{"teacher": "丹丹老师", "kind": "自命题"}],
            },
            {
                "stem": "看不清的题干",
                "options": [{"id": "A", "text": "甲"}],
                "knowledge_point": "学在官府",
                "sources": [{"teacher": "冬青老师", "kind": "333选择题", "year": "2027版"}],
            },
        ]
    )
    assert ready == []
    assert {item["skip_reason"] for item in skipped} == {"out_of_scope_chapter", "unreadable"}


def test_question_binds_to_the_node_that_states_the_knowledge_point() -> None:
    ready, _skipped = prepare_quiz_import(
        [
            {
                "stem": "学在官府的原因包括（　　）。",
                "options": [{"id": "A", "text": "惟官有书"}],
                "correct_option_id": "A",
                "knowledge_point": "惟官有书，而民无书",
                "sources": [{"teacher": "冬青老师", "kind": "333选择题", "year": "2027版"}],
            }
        ]
    )
    nodes = format_knowledge_tree(
        {
            "title": "第一节 西周的教育制度",
            "children": [
                {
                    "text": "知识点一 学在官府",
                    "children": [
                        {"text": "1. 惟官有书，而民无书", "children": []},
                        {"text": "2. 惟官有器，而民无器", "children": []},
                    ],
                }
            ],
        }
    )
    assert ready[0]["stem"].startswith("【冬青老师｜333选择题｜2027版】")
    assert bind_text_for_question(ready[0], nodes["children"]) == "惟官有书，而民无书"


def test_jiaoyuan_fixture_shapes_cards_and_both_question_rows() -> None:
    """教原-shaped card rules plus a choice row and its subjective twin."""
    tree = format_knowledge_tree(
        {
            "title": "教学",
            "children": [
                {"text": "（1）相同点。", "children": []},
                {"text": "相同点——启发诱导", "children": []},
                {
                    "text": "（2）不同点：夸美纽斯强调班级授课；杜威强调从做中学。",
                    "children": [],
                },
                {
                    "text": "著作",
                    "children": [
                        {"text": "《大教学论》", "children": []},
                        {"text": "《母育学校》", "children": []},
                        {"text": "《世界图解》", "children": []},
                    ],
                },
                {
                    "text": "《大教学论》",
                    "children": [
                        {
                            "text": "《大教学论》的出版是教育学开始成为一门独立学科的标志。",
                            "children": [],
                            "emphasis_marks": [
                                {"kind": "highlight", "text": "独立学科"},
                                {"kind": "highlight", "text": "并不在这句话里"},
                            ],
                        }
                    ],
                },
            ],
        }
    )
    labels = [child["text"] for child in tree["children"]]
    assert labels[0] == "相同点"
    assert tree["children"][1]["text"] == "相同点"
    assert tree["children"][1]["children"][0]["text"] == "启发诱导"
    contrast = next(child for child in tree["children"] if child["text"] == "不同点")
    contrast_texts = [child["text"] for child in contrast["children"]]
    assert contrast_texts[0] == "夸杜"
    assert "夸美纽斯强调班级授课" in contrast_texts
    assert "杜威强调从做中学" in contrast_texts
    works = next(child for child in tree["children"] if child["text"] == "著作")
    assert [child["text"] for child in works["children"]][0] == "大母世"
    trimmed = next(child for child in tree["children"] if child["text"] == "《大教学论》")
    body = trimmed["children"][0]
    assert body["text"].startswith("出版是教育学开始成为一门独立学科的标志")
    assert body["emphasis_marks"] == [{"kind": "highlight", "text": "独立学科"}]
    assert "**" not in body["text"]

    choice = {
        "stem": "下列关于启发式教学的表述中，不正确的是",
        "options": [
            {"id": "A", "text": "引导学生思考"},
            {"id": "B", "text": "只要求学生记结论"},
        ],
        "correct_option_id": "B",
        "knowledge_point": "启发式教学",
        "chapter_title": "教学",
        "analysis": "不正确的是只记结论。",
    }
    native = {
        "question_type": "short_answer",
        "stem": "简述教育的本质。",
        "reference_answer": "有目的地培养人的社会活动",
        "knowledge_point": "教育的本质",
        "chapter_title": "教育及其产生与发展",
        "sources": [{"teacher": "丹丹老师", "kind": "自命题"}],
    }
    ready, skipped = prepare_quiz_rows_with_subjective_twins(
        [
            {**choice, "sources": [{"teacher": "凯程老师", "kind": "333真题", "year": "2026版"}]},
            {**choice, "sources": [{"teacher": "凯程老师", "kind": "333真题", "year": "2025版"}]},
            {
                **choice,
                "stem": "下列哪一项是教育的本质属性",
                "options": [{"id": "A", "text": "有目的地培养人"}],
                "correct_option_id": "A",
                "knowledge_point": "教育的本质属性",
                "sources": [{"teacher": "", "kind": "", "year": ""}],
            },
            native,
        ]
    )
    assert skipped == []
    choice_rows = [row for row in ready if row["question_type"] == "multiple_choice"]
    answer_rows = [row for row in ready if row["question_type"] == "short_answer"]
    heuristic = next(row for row in choice_rows if "启发式教学" in row["stem"])
    assert heuristic["stem"].startswith("【凯程老师｜333真题｜2026版】【凯程老师｜333真题｜2025版】")
    assert heuristic["correct_option_id"] == "B"
    assert len([row for row in choice_rows if "启发式教学" in row["stem"]]) == 1
    twin = next(row for row in answer_rows if row["source_meta"].get("subjective_of") == "multiple_choice" and "启发式" in row["stem"])
    assert twin["stem"].endswith("启发式教学有哪些")
    assert twin["reference_answer"] == "引导学生思考"
    assert twin["options"] == []
    assert twin["source_meta"]["knowledge_point"] == "启发式教学"
    assert bind_text_for_question(twin, [{"text": "启发式教学", "children": []}]) == "启发式教学"
    unconfirmed = next(row for row in choice_rows if "教育的本质属性" in row["stem"])
    assert unconfirmed["stem"] == "下列哪一项是教育的本质属性"
    assert unconfirmed["source_meta"]["sources"] == []
    identity = next(row for row in answer_rows if row["stem"].endswith("教育的本质属性是什么"))
    assert identity["reference_answer"] == "有目的地培养人"
    assert not identity["stem"].startswith("【")
    essay = next(row for row in answer_rows if "简述教育的本质" in row["stem"])
    assert essay["stem"] == "【丹丹老师｜自命题】简述教育的本质。"
    assert essay["reference_answer"] == "有目的地培养人的社会活动"
    assert essay["question_type"] == "short_answer"
    assert "options" not in essay or essay["options"] == []


def test_edu_psych_snippet_shapes_cards_tags_and_twins() -> None:
    """教心 snippet: the same shaper the importer calls, not a reimplementation."""
    tree = format_knowledge_tree(
        {
            "title": "认知发展理论与教育",
            "children": [
                {"text": "（1）相同点。", "children": []},
                {"text": "相同点——同化与顺应", "children": []},
                {
                    "text": "（2）不同点：皮亚杰强调个体与环境的相互作用；维果茨基强调社会文化对认知发展的作用。",
                    "children": [],
                },
                {
                    "text": "知识点一 基本概念",
                    "children": [
                        {"text": "《大教学论》", "children": []},
                        {"text": "《母育学校》", "children": []},
                        {"text": "《世界图解》", "children": []},
                    ],
                },
                {
                    "text": "图式",
                    "children": [
                        {
                            "text": "图式是皮亚杰理论中的核心概念，是认知系统的组织结构。",
                            "children": [],
                            "emphasis_marks": [
                                {"kind": "highlight", "text": "核心概念"},
                                {"kind": "highlight", "text": "并不在这句话里"},
                            ],
                        }
                    ],
                },
            ],
        }
    )
    labels = [child["text"] for child in tree["children"]]
    assert labels[0] == "相同点"
    assert "（1）" not in labels[0]
    pair = tree["children"][1]
    assert pair["text"] == "相同点"
    assert pair["children"][0]["text"] == "同化与顺应"
    contrast = next(child for child in tree["children"] if child["text"] == "不同点")
    contrast_texts = [child["text"] for child in contrast["children"]]
    assert contrast_texts[0] == "皮维"
    assert "皮亚杰强调个体与环境的相互作用" in contrast_texts
    assert "维果茨基强调社会文化对认知发展的作用" in contrast_texts
    concepts = next(child for child in tree["children"] if child["text"] == "基本概念")
    assert [child["text"] for child in concepts["children"]][0] == "大母世"
    schema = next(child for child in tree["children"] if child["text"] == "图式")
    body = schema["children"][0]
    assert body["text"].startswith("皮亚杰理论中的核心概念")
    assert body["emphasis_marks"] == [{"kind": "highlight", "text": "核心概念"}]
    assert "**" not in body["text"]
    assert not any(child["text"].startswith(("知识点", "（1）", "第一，")) for child in tree["children"])

    choice = {
        "stem": "下列关于图式的表述中，不正确的是",
        "options": [
            {"id": "A", "text": "图式是认知系统的组织结构"},
            {"id": "B", "text": "图式一旦形成就再也不能变化"},
        ],
        "correct_option_id": "B",
        "knowledge_point": "图式",
        "chapter_title": "心理发展与教育",
        "analysis": "图式会通过同化和顺应变化。",
    }
    native = {
        "question_type": "short_answer",
        "stem": "简述图式。",
        "reference_answer": "图式是认知系统的组织结构。",
        "knowledge_point": "图式的含义",
        "chapter_title": "心理发展与教育",
        "sources": [{"teacher": "丹丹老师", "kind": "自命题"}],
    }
    ready, skipped = prepare_quiz_rows_with_subjective_twins(
        [
            {**choice, "sources": [{"teacher": "凯程老师", "kind": "333真题", "year": "2026版"}]},
            {**choice, "sources": [{"teacher": "冬青老师", "kind": "333选择题", "year": "2027版"}]},
            {
                "stem": "下列哪一项属于同化",
                "options": [{"id": "A", "text": "把新事物纳入已有图式"}],
                "correct_option_id": "A",
                "knowledge_point": "同化",
                "chapter_title": "心理发展与教育",
                "sources": [{"teacher": "", "kind": "", "year": ""}],
            },
            native,
        ]
    )
    assert skipped == []
    choices = [row for row in ready if row["question_type"] == "multiple_choice"]
    answers = [row for row in ready if row["question_type"] == "short_answer"]
    merged = next(row for row in choices if "图式" in row["stem"] and "不正确" in row["stem"])
    assert merged["stem"].startswith("【凯程老师｜333真题｜2026版】【冬青老师｜333选择题｜2027版】")
    assert len([row for row in choices if "不正确" in row["stem"]]) == 1
    twin = next(
        row
        for row in answers
        if row["source_meta"].get("subjective_of") == "multiple_choice" and "图式" in row["stem"]
    )
    assert twin["stem"].endswith("图式有哪些")
    assert twin["reference_answer"] == "图式是认知系统的组织结构"
    assert twin["options"] == []
    blank = next(row for row in choices if "同化" in row["stem"])
    assert blank["stem"] == "下列哪一项属于同化"
    assert blank["source_meta"]["sources"] == []
    essay = next(row for row in answers if "简述图式" in row["stem"])
    assert essay["question_type"] == "short_answer"
    assert essay["stem"] == "【丹丹老师｜自命题】简述图式。"
    assert essay["reference_answer"] == "图式是认知系统的组织结构。"
    assert essay["source_meta"].get("subjective_of") != "multiple_choice"
    assert bind_text_for_question(merged, tree["children"]) == "图式"
