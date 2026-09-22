# -*- coding: utf-8 -*-
import json
import re
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
MISSING = {
    "基础练习": [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43],
    "强化拔高": [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26],
}
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, palace_id, deleted_at, stem, answer_payload_json, source_meta_json
    FROM palace_quiz_questions
    WHERE source_meta_json LIKE '%fg_ch07%'
    """
).fetchall()


def norm(text: str) -> str:
    text = re.sub(r"\s+", "", text or "")
    text = text.replace("（", "(").replace("）", ")")
    return text


active_stems = []
by_key = {}
for qid, palace, deleted, stem, answer, meta in rows:
    meta_obj = json.loads(meta or "{}")
    manual = meta_obj.get("manual_import") or {}
    key = (manual.get("block"), manual.get("number"))
    ans = json.loads(answer or "{}").get("correct_option_id")
    rec = {"id": qid, "palace": palace, "deleted": bool(deleted), "ans": ans, "stem": stem or ""}
    by_key.setdefault(key, []).append(rec)
    if not deleted:
        active_stems.append(rec)

# all active ch6 stems, not only dongqing tagged
all_active = con.execute(
    """
    SELECT id, palace_id, stem
    FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND palace_id BETWEEN 39 AND 45
    """
).fetchall()

print("DELETED whose number is in the gap, and nearest active stem")
for block, numbers in MISSING.items():
    for number in numbers:
        recs = by_key.get((block, number), [])
        deleted = [r for r in recs if r["deleted"]]
        active = [r for r in recs if not r["deleted"]]
        if active:
            print(f"\n{block} #{number} HAS ACTIVE", [(a["id"], a["ans"]) for a in active])
            continue
        for rec in deleted:
            stem_n = norm(rec["stem"])
            # fingerprint: strip year tags and punctuation, take 18 chars from middle
            core = re.sub(r"[【】\[\]0-9年月日,，。、“”\"'（）()\s]", "", rec["stem"])
            core = core[:24]
            hits = []
            for qid, palace, stem in all_active:
                if core and core in re.sub(r"[【】\[\]0-9年月日,，。、“”\"'（）()\s]", "", stem or ""):
                    hits.append((qid, palace, (stem or "")[:70]))
            print(f"\n{block} #{number} deleted Q{rec['id']} palace {rec['palace']} ans {rec['ans']}")
            print("  STEM:", rec["stem"][:120])
            if hits:
                print("  ACTIVE HIT", hits[:3])
            else:
                print("  NO ACTIVE HIT for core:", core)
