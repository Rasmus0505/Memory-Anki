# -*- coding: utf-8 -*-
"""题库去重 第 1 步：导出在世题目为 JSONL（只读）。"""
import json
import os
import sqlite3
import sys

sys.stdout.reconfigure(encoding="utf-8")
DB = os.environ.get("MEMORY_ANKI_DB", r"C:\MemoryAnki\memory anki data\学习数据\memory_palace.db")
OUT = os.path.join(os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__)), "questions.jsonl")

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = con.execute(
    """
    select q.id, q.palace_id, ps.subject_id, s.name subject_name, q.question_type, q.stem,
           q.options_json, q.answer_payload_json, q.analysis, q.attempt_count,
           q.correct_count, q.incorrect_count, q.created_at, q.source_meta_json,
           q.correct_count + q.incorrect_count as answered, p.title palace_title
    from palace_quiz_questions q
    join palace_subjects ps on ps.palace_id = q.palace_id
    join subjects s on s.id = ps.subject_id
    join palaces p on p.id = q.palace_id
    where q.deleted_at is null
    order by ps.subject_id, q.palace_id, q.sort_order, q.id
    """
).fetchall()

with open(OUT, "w", encoding="utf-8") as f:
    for r in rows:
        d = dict(r)
        d["source_kind"] = json.loads(d.pop("source_meta_json") or "{}").get("source_kind")
        f.write(json.dumps(d, ensure_ascii=False) + "\n")
print("exported", len(rows), "->", OUT)
con.close()
