# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
KEY = {
    "基础练习": {
        1: "B", 2: "A", 3: "B", 4: "B", 5: "D", 6: "B", 7: "A", 8: "C", 9: "C", 10: "B",
        11: "A", 12: "D", 13: "B", 14: "B", 15: "A", 16: "C", 17: "A", 18: "A", 19: "C", 20: "D",
        21: "D", 22: "A", 23: "D", 24: "B", 25: "A", 26: "B", 27: "B", 28: "B", 29: "A", 30: "D",
        31: "C", 32: "D", 33: "A", 34: "B", 35: "A", 36: "D", 37: "A", 38: "A", 39: "A", 40: "A",
        41: "C", 42: "D", 43: "D", 44: "A", 45: "D",
    },
    "强化拔高": {
        1: "B", 2: "C", 3: "A", 4: "B", 5: "D", 6: "A", 7: "D", 8: "C", 9: "C", 10: "B",
        11: "D", 12: "B", 13: "C", 14: "D", 15: "B", 16: "D", 17: "C", 18: "C", 19: "D", 20: "B",
        21: "A", 22: "C", 23: "D", 24: "C", 25: "C", 26: "A", 27: "D", 28: "C",
    },
}
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, palace_id, deleted_at, stem, options_json, answer_payload_json, source_meta_json
    FROM palace_quiz_questions
    WHERE palace_id BETWEEN 39 AND 45
       OR source_meta_json LIKE '%fg_ch07%'
    """
).fetchall()
found = {block: {} for block in KEY}
other = []
for qid, palace, deleted, stem, options, answer, meta in rows:
    try:
        meta_obj = json.loads(meta or "{}")
    except json.JSONDecodeError:
        meta_obj = {}
    manual = meta_obj.get("manual_import") or {}
    if manual.get("unit_id") != "fg_ch07":
        continue
    block = manual.get("block")
    number = manual.get("number")
    ans = json.loads(answer or "{}").get("correct_option_id")
    rec = {
        "id": qid,
        "palace": palace,
        "deleted": bool(deleted),
        "ans": ans,
        "stem": (stem or "")[:80],
    }
    found.setdefault(block, {}).setdefault(number, []).append(rec)

for block, answers in KEY.items():
    print(f"\n== {block} ==")
    missing = []
    for number, letter in answers.items():
        recs = [r for r in found.get(block, {}).get(number, []) if not r["deleted"]]
        deleted = [r for r in found.get(block, {}).get(number, []) if r["deleted"]]
        if not recs:
            missing.append((number, letter, deleted))
            continue
        for rec in recs:
            flag = "" if rec["ans"] == letter else f" ANSWER {rec['ans']} != {letter}"
            if flag:
                print(f"  DIFF #{number} Q{rec['id']} palace {rec['palace']}{flag} | {rec['stem']}")
    print("MISSING", [(n, letter, [(d['id'], d['palace']) for d in dels]) for n, letter, dels in missing])

print("\nEXTRA blocks", {b: sorted(v) for b, v in found.items() if b not in KEY})
