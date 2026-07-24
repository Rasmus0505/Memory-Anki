# -*- coding: utf-8 -*-
"""Validate, normalize emphasis_marks, merge 7 palaces + quizzes."""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_vision\out")
FINAL = OUT / "ch6_seven_palaces_final.json"
DESKTOP = Path(r"C:\Users\Administrator\Desktop\第六章_七个记忆宫殿_最终.json")

FILES = [
    ("01_夸美纽斯.json", "第一节 夸美纽斯的教育思想", 70),
    ("02_卢梭.json", "第二节 卢梭的教育思想", 71),
    ("03_裴斯泰洛齐.json", "第三节 裴斯泰洛齐的教育思想", 72),
    ("04_赫尔巴特.json", "第四节 赫尔巴特的教育思想", 73),
    ("05_福禄培尔.json", "第五节 福禄培尔的教育思想", 74),
    ("06_马克思恩格斯.json", "第六节 马克思和恩格斯的教育思想", 75),
    ("07_教育思潮.json", "第七节 西欧近代教育思潮", 76),
]


def count_nodes(n: dict) -> int:
    c = 1
    for ch in n.get("children") or []:
        c += count_nodes(ch)
    return c


def normalize_node(n: dict, is_root: bool = False) -> dict:
    if is_root:
        out = {"title": n.get("title") or "", "children": []}
    else:
        text = n.get("text") or ""
        out = {"text": text, "children": []}
        ems = n.get("emphasis_marks")
        if ems:
            cleaned = []
            for em in ems:
                kind = em.get("kind") or "highlight"
                if kind == "underline":
                    kind = "highlight"
                t = em.get("text") or ""
                if t and t in text:
                    cleaned.append({"kind": "highlight", "text": t})
            if cleaned:
                out["emphasis_marks"] = cleaned
    kids = []
    for ch in n.get("children") or []:
        if isinstance(ch, dict):
            kids.append(normalize_node(ch, is_root=False))
    out["children"] = kids
    return out


def validate(n: dict, path: str = "root") -> list[str]:
    errs = []
    if path == "root":
        if "title" not in n:
            errs.append(f"{path}: missing title")
        if "children" not in n:
            errs.append(f"{path}: missing children")
        for i, ch in enumerate(n.get("children") or []):
            errs += validate(ch, f"{path}/{i}")
        return errs
    if "text" not in n:
        errs.append(f"{path}: missing text")
    if "children" not in n:
        errs.append(f"{path}: missing children")
    for em in n.get("emphasis_marks") or []:
        t = em.get("text") or ""
        if t and t not in (n.get("text") or ""):
            errs.append(f"{path}: emphasis not substring: {t[:40]}")
    for i, ch in enumerate(n.get("children") or []):
        errs += validate(ch, f"{path}/{i}")
    return errs


def main() -> None:
    quizzes = json.loads((OUT / "ch6_quizzes.json").read_text(encoding="utf-8"))
    palaces = []
    for fname, default_title, chapter_id in FILES:
        path = OUT / fname
        raw = json.loads(path.read_text(encoding="utf-8"))
        mindmap = normalize_node(raw, is_root=True)
        if not mindmap["title"]:
            mindmap["title"] = default_title
        errs = validate(mindmap)
        qkey = mindmap["title"]
        # fuzzy match quiz key
        qlist = quizzes.get(qkey)
        if qlist is None:
            for k, v in quizzes.items():
                if k in qkey or qkey in k or default_title in k or k in default_title:
                    qlist = v
                    qkey = k
                    break
        qlist = qlist or []
        print(
            fname,
            "title=",
            mindmap["title"],
            "nodes=",
            count_nodes(mindmap),
            "quizzes=",
            len(qlist),
            "errs=",
            len(errs),
        )
        for e in errs[:8]:
            print("  ", e)
        palaces.append(
            {
                "title": mindmap["title"],
                "chapter_id": chapter_id,
                "mindmap": mindmap,
                "quizzes": qlist,
            }
        )

    payload = {
        "chapter": "第六章 西欧近代教育思想与教育思潮",
        "palace_count": len(palaces),
        "palaces": palaces,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    FINAL.write_text(text, encoding="utf-8")
    DESKTOP.write_text(text, encoding="utf-8")
    print("wrote", FINAL, "bytes", FINAL.stat().st_size)
    print("wrote", DESKTOP, "bytes", DESKTOP.stat().st_size)


if __name__ == "__main__":
    main()
