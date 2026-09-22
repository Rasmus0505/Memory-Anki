# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
out = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_db.json")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = con.execute(
    """
    SELECT id, palace_id, lifecycle_status, question_type, stem,
           options_json, answer_payload_json, analysis, source_meta_json, deleted_at
    FROM palace_quiz_questions
    WHERE palace_id BETWEEN 39 AND 45
    ORDER BY palace_id, id
    """
).fetchall()
items = []
for row in rows:
    item = dict(row)
    items.append(item)
out.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
active = [i for i in items if not i["deleted_at"]]
print("rows", len(items), "active", len(active))
from collections import Counter
print("by palace", Counter(i["palace_id"] for i in active))
print("lifecycle", Counter(i["lifecycle_status"] for i in active))
