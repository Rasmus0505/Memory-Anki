# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import ctypes
import sqlite3
from pathlib import Path

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki")


def resolve_app_home() -> Path:
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
    raise SystemExit(f"volume not found: {vol_name}")


def main() -> None:
    home = resolve_app_home()
    db = home / "data" / "memory_palace.db"
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    print("tables with doc/subject:")
    for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        name = r["name"]
        if any(k in name for k in ["document", "subject", "quiz", "question", "ocr", "page", "attachment"]):
            print(" ", name)
    for table in ["subject_documents", "documents", "knowledge_documents", "quiz_questions", "questions"]:
        try:
            cols = [x[1] for x in con.execute(f"PRAGMA table_info({table})")]
            print(table, cols[:30])
            n = con.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
            print("  count", n)
            rows = con.execute(f"SELECT * FROM {table} LIMIT 3").fetchall()
            for row in rows:
                d = dict(row)
                # truncate long fields
                for k, v in list(d.items()):
                    if isinstance(v, str) and len(v) > 120:
                        d[k] = v[:120] + "..."
                print(" ", d)
        except Exception as e:
            print(table, "ERR", e)

    # palace editor sample
    cols = [x[1] for x in con.execute("PRAGMA table_info(palaces)")]
    print("palace cols", cols)
    sample = con.execute(
        "SELECT id, title, length(editor_doc) as n FROM palaces WHERE editor_doc IS NOT NULL ORDER BY n DESC LIMIT 3"
    ).fetchall()
    print("samples", [dict(s) for s in sample])
    if sample:
        doc = json.loads(
            con.execute("SELECT editor_doc FROM palaces WHERE id=?", (sample[0]["id"],)).fetchone()[0]
        )
        print(json.dumps(doc, ensure_ascii=False)[:2000])


if __name__ == "__main__":
    main()
