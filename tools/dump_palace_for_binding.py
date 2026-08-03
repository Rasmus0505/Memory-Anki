# -*- coding: utf-8 -*-
"""Dump one palace's questions + mindmap nodes so bindings can be decided by hand.

    MEMORY_ANKI_HOME="F:\\memory anki data" python tools/dump_palace_for_binding.py 15
"""
from __future__ import annotations

import ctypes
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]


def resolve_app_home() -> Path:
    configured = os.environ.get("MEMORY_ANKI_HOME", "").strip()
    if configured:
        return Path(configured)
    data = json.loads((ROOT / "local-config/memory-anki.local.json").read_text(encoding="utf-8"))
    home = data.get("local_app_home") or ""
    if not home.startswith("vol:"):
        return Path(home)
    rest = home[4:]
    vol_name, _, sub = rest.partition("/")
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not (bitmask & (1 << i)):
            continue
        drive = f"{chr(65 + i)}:\\"
        buf = ctypes.create_unicode_buffer(1024)
        ctypes.windll.kernel32.GetVolumeInformationW(drive, buf, 1024, None, None, None, None, 0)
        if buf.value == vol_name:
            return Path(drive) / sub
    raise SystemExit(f"volume {vol_name} not found")


DB = resolve_app_home() / "data" / "memory_palace.db"


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=10000")
    return con


def walk_nodes(raw):
    """Yield (uid, text, depth) in document order."""
    if not raw:
        return
    try:
        doc = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return
    root = doc.get("root") if isinstance(doc, dict) else doc

    def walk(node, depth):
        if not isinstance(node, dict):
            return
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = str(data.get("uid") or "").strip()
        text = str(data.get("text") or "").strip()
        note = str(data.get("note") or "").strip()
        if uid:
            yield uid, text, note, depth
        for child in node.get("children") or []:
            yield from walk(child, depth + 1)

    yield from walk(root, 0)


def strip_html(value: str) -> str:
    import re

    text = re.sub(r"<[^>]+>", "", value or "")
    return " ".join(text.split())


def main() -> None:
    palace_id = int(sys.argv[1])
    con = connect()
    palace = con.execute(
        "select id, title, manual_title, editor_doc from palaces where id=?", (palace_id,)
    ).fetchone()
    if palace is None:
        raise SystemExit(f"palace {palace_id} not found")

    print(f"### 宫殿 {palace_id}：{palace['manual_title'] or palace['title']}\n")

    print("## 导图节点")
    nodes = list(walk_nodes(palace["editor_doc"]))
    for uid, text, note, depth in nodes:
        indent = "  " * depth
        line = f"{indent}[{uid}] {strip_html(text)}"
        if note:
            line += f"   〔注：{strip_html(note)[:120]}〕"
        print(line)
    print(f"\n（共 {len(nodes)} 个节点）\n")

    print("## 题目")
    rows = con.execute(
        # Same filter the app's query_root_question_rows uses: palace + not deleted.
        # origin_question_id is NOT an exclusion — imported questions carry it and are live.
        """select id, question_type, stem, options_json, answer_payload_json, analysis
           from palace_quiz_questions
           where palace_id=? and deleted_at is null
           order by sort_order, id""",
        (palace_id,),
    ).fetchall()
    for row in rows:
        print(f"\n--- Q{row['id']} [{row['question_type']}]")
        print(f"题干：{strip_html(row['stem'])}")
        try:
            options = json.loads(row["options_json"] or "[]")
        except Exception:
            options = []
        for opt in options if isinstance(options, list) else []:
            if isinstance(opt, dict):
                print(f"  {opt.get('id')}. {strip_html(str(opt.get('text') or ''))}")
        try:
            answer = json.loads(row["answer_payload_json"] or "{}")
        except Exception:
            answer = {}
        if answer:
            print(f"答案：{json.dumps(answer, ensure_ascii=False)}")
        if row["analysis"]:
            print(f"解析：{strip_html(row['analysis'])}")
    print(f"\n（共 {len(rows)} 道题）")


if __name__ == "__main__":
    main()
