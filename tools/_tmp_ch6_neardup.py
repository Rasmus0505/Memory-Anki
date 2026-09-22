# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
ids = [911, 921, 478, 498, 520, 479, 514, 903, 476, 477, 515, 510, 522, 521, 480, 945, 900]
# also search a few stems
extra = con.execute(
    """
    SELECT id, palace_id, stem FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND palace_id BETWEEN 39 AND 45
      AND (
        stem LIKE '%趋同%' OR stem LIKE '%12年%' OR stem LIKE '%2012%'
        OR stem LIKE '%母亲的爱%' OR stem LIKE '%最简单的要素%'
        OR stem LIKE '%自然教育的核心%' OR stem LIKE '%适应自然，主要%'
        OR options_json LIKE '%儿童对同伴的爱%'
        OR options_json LIKE '%儿童对母亲的爱%'
      )
    """
).fetchall()
print("EXTRA")
for row in extra:
    print(row[0], row[1], row[2][:90].replace("\n", " "))

for qid in ids:
    row = con.execute(
        "SELECT id, palace_id, stem, options_json, answer_payload_json FROM palace_quiz_questions WHERE id=?",
        (qid,),
    ).fetchone()
    print("\n====", row[0], "palace", row[1])
    print(row[2])
    opts = json.loads(row[3] or "[]")
    for opt in opts:
        print(f"  {opt.get('id')}. {opt.get('text')}")
    print("  ANS", row[4])
