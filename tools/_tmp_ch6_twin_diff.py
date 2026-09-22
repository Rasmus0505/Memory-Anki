# -*- coding: utf-8 -*-
import json
import re
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
PAIRS = [
    # deleted dongqing id, active id, label
    (912, 506, "basic22"),
    (885, 469, "basic23"),
    (924, 515, "basic24"),
    (913, 507, "basic25"),
    (886, 470, "basic26"),
    (887, 471, "basic27"),
    (901, 492, "basic28"),
    (888, 472, "basic29"),
    (914, 508, "basic30"),
    (925, 517, "basic31"),
    (938, 534, "basic32"),
    (926, 518, "basic33"),
    (889, 474, "basic34"),
    (927, 519, "basic35"),
    (915, 509, "basic36"),
    (890, 478, "basic37"),
    (916, 510, "basic38"),
    (902, 498, "basic39"),
    (947, 540, "basic40"),
    (928, 522, "basic41"),
    (940, 535, "basic43"),
    (932, 516, "hard11"),
    (891, 473, "hard12"),
    (906, 493, "hard13"),
    (907, 494, "hard14"),
    (943, 533, "hard15"),
    (892, 475, "hard16"),
    (893, 476, "hard17"),
    (894, 477, "hard18"),
    (933, 520, "hard19"),
    (908, 496, "hard20"),
    (909, 497, "hard21"),
    (895, 479, "hard22"),
    (934, 521, "hard23"),
    (919, 511, "hard25"),
    (896, 480, "hard26"),
]
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)


def load(qid):
    row = con.execute(
        "SELECT stem, options_json, answer_payload_json FROM palace_quiz_questions WHERE id=?",
        (qid,),
    ).fetchone()
    stem, options, answer = row
    opts = {o["id"]: o["text"] for o in json.loads(options or "[]")}
    ans = json.loads(answer or "{}").get("correct_option_id")
    return stem, opts, ans


def squash(text):
    return re.sub(r"[\s（）()【】\[\]，,。、“”\"']", "", text or "")


print("OPTION / ANSWER DIFFS (ignoring whitespace and year-tag style)")
for deleted_id, active_id, label in PAIRS:
    d_stem, d_opts, d_ans = load(deleted_id)
    a_stem, a_opts, a_ans = load(active_id)
    diffs = []
    if d_ans != a_ans:
        diffs.append(f"ANS deleted {d_ans} active {a_ans}")
    for key in "ABCD":
        if squash(d_opts.get(key, "")) != squash(a_opts.get(key, "")):
            diffs.append(f"{key} DQ[{d_opts.get(key)}] DB[{a_opts.get(key)}]")
    # stem body without leading year tag
    d_body = re.sub(r"^（?\d+年[^）]*）", "", d_stem)
    d_body = re.sub(r"^【[^】]*】", "", d_body)
    a_body = re.sub(r"^【[^】]*】", "", a_stem)
    a_body = re.sub(r"^（[^）]*）", "", a_body)
    if squash(d_body) != squash(a_body):
        diffs.append("STEM")
        diffs.append("  DQ " + d_body[:140])
        diffs.append("  DB " + a_body[:140])
    if diffs:
        print(f"\n{label} deleted Q{deleted_id} vs Q{active_id}")
        for line in diffs:
            print(" ", line)
