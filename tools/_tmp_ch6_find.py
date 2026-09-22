# -*- coding: utf-8 -*-
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
needles = [
    "自然人",
    "道德教育的内容",
    "女子教育",
    "贤妻良母",
    "谨慎、节制",
    "刚毅",
    "自食其力",
    "教育要适应自然，主要",
    "自然教育的核心",
    "儿童对同伴",
    "生产劳动相结合\"思想的教育家",
    "提出“教育与生产劳动相结合”",
    "欧文",
]
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, palace_id, stem, options_json
    FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND palace_id BETWEEN 39 AND 45
    """
).fetchall()
for needle in needles:
    hits = [r for r in rows if needle in (r[2] or "") or needle in (r[3] or "")]
    print(f"== {needle} {len(hits)}")
    for r in hits:
        print(" ", r[0], (r[2] or "")[:80].replace("\n", " "))
