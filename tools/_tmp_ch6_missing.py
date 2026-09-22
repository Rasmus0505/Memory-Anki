# -*- coding: utf-8 -*-
"""Find whether the 12 冬青 items already exist under a slightly different stem."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
NEEDLES = [
    "教育要适应自然，主要是指",
    "自然教育的核心",
    "德育最基本的要素",
    "教育与生产劳动相结合",
    "综合教学",
    "创造性实践",
    "开创性实践",
    "最简单的要素",
    "泛智",
    "人力完全不能控制",
    "目的—手段",
    "目的-手段",
    "人为教育、事物教育",
    "这种思想的核心",
    "事物的教育、人为的教育",
    "训诫",
    "训育",
    "教育阶段论",
    "教学阶段论",
    "需要阶段",
    "要求阶段",
    "求知欲",
    "青年男女",
    "男女青年",
]
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, palace_id, question_type, stem, options_json, answer_payload_json,
           substr(analysis,1,80) AS analysis
    FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND palace_id BETWEEN 39 AND 45
    """
).fetchall()
print("rows", len(rows))
for needle in NEEDLES:
    hits = [r for r in rows if needle in (r[3] or "") or needle in (r[4] or "")]
    print(f"\n== {needle} hits {len(hits)}")
    for r in hits:
        print(r[0], "p", r[1], (r[3] or "")[:70].replace("\n", " "))

# sample source_meta and a binding
meta = con.execute(
    "SELECT id, source_meta_json FROM palace_quiz_questions WHERE id=879"
).fetchone()
print("\nMETA879", (meta[1] or "")[:800])
binds = con.execute(
    """
    SELECT question_id, palace_id, node_uid
    FROM palace_quiz_question_node_bindings
    WHERE question_id IN (879, 911, 921, 904) AND deleted_at IS NULL
    """
).fetchall()
print("BINDS", binds)
