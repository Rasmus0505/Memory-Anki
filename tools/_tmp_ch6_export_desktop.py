# -*- coding: utf-8 -*-
import json
from pathlib import Path

out = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_vision\out")
final = json.loads((out / "ch6_seven_palaces_final.json").read_text(encoding="utf-8"))
desk = Path(r"C:\Users\Administrator\Desktop\第六章七个记忆宫殿")
desk.mkdir(exist_ok=True)


def count(n: dict) -> int:
    return 1 + sum(count(c) for c in n.get("children") or [])


for i, p in enumerate(final["palaces"], 1):
    safe = p["title"].replace(" ", "")
    path = desk / f"{i:02d}_{safe}.json"
    bundle = {
        "title": p["mindmap"]["title"],
        "children": p["mindmap"]["children"],
        "quizzes": p["quizzes"],
        "chapter_id": p["chapter_id"],
    }
    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(path.name, "nodes", count(p["mindmap"]), "quizzes", len(p["quizzes"]), "bytes", path.stat().st_size)

# copy full
full = desk / "00_全章合并.json"
full.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
print("full", full.stat().st_size)
print("total quizzes", sum(len(p["quizzes"]) for p in final["palaces"]))
