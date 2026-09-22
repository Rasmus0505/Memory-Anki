# -*- coding: utf-8 -*-
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
needles = ["趋同", "2022年311真题27", "2022年311", "人为的教育、事物的教育要配合"]
for needle in needles:
    rows = con.execute(
        """
        SELECT id, palace_id, deleted_at IS NOT NULL, substr(stem,1,80)
        FROM palace_quiz_questions
        WHERE stem LIKE ? OR options_json LIKE ?
        """,
        (f"%{needle}%", f"%{needle}%"),
    ).fetchall()
    print("==", needle, len(rows))
    for row in rows:
        print(" ", row)
