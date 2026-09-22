# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
needles = ["公共游戏场所", "付诸实践", "目的", "人为的教育", "人为教育", "人力完全不能控制", "最简单"]
rows = con.execute(
    """
    SELECT id, palace_id, deleted_at, stem, options_json, answer_payload_json
    FROM palace_quiz_questions
    WHERE palace_id BETWEEN 39 AND 45
    """
).fetchall()
for needle in needles:
    print("\n####", needle)
    for qid, palace, deleted, stem, options, answer in rows:
        blob = (stem or "") + (options or "")
        if needle in blob and not deleted:
            ans = json.loads(answer or "{}").get("correct_option_id")
            print(f"Q{qid} p{palace} ans {ans} | {(stem or '')[:90]}")
