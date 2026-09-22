# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
for qid in (897, 881, 898, 508, 498, 327):
    row = con.execute(
        "SELECT id, stem, options_json, answer_payload_json, substr(analysis,1,220) FROM palace_quiz_questions WHERE id=?",
        (qid,),
    ).fetchone()
    if not row:
        print("missing", qid)
        continue
    print("\n====", row[0])
    print(row[1])
    for opt in json.loads(row[2] or "[]"):
        print(f"  {opt.get('id')}. {opt.get('text')}")
    print(" ANS", row[3])
    print(" ANA", row[4])
