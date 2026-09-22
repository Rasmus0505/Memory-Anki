# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, palace_id, stem, options_json, answer_payload_json, source_meta_json
    FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND source_meta_json LIKE '%fg_ch07%'
    ORDER BY id
    """
).fetchall()
items = []
for qid, palace, stem, options, answer, meta in rows:
    manual = (json.loads(meta).get("manual_import") or {})
    opts = json.loads(options or "[]")
    ans = json.loads(answer or "{}").get("correct_option_id")
    items.append((manual.get("block"), manual.get("number"), qid, palace, ans, stem, opts))
items.sort(key=lambda x: (0 if x[0] == "基础练习" else 1, x[1] or 0))
for block, number, qid, palace, ans, stem, opts in items:
    print(f"\n{block} #{number} Q{qid} p{palace} {ans}")
    print(stem)
    for opt in opts:
        print(f"  {opt.get('id')}. {opt.get('text')}")
print("\nCOUNT", len(items))
