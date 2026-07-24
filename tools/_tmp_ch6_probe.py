# -*- coding: utf-8 -*-
"""Probe DB + locate chapter 6 pages via OCR samples."""
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
    print("home", home)
    print("db", db, db.exists())
    if not db.exists():
        matches = list(home.rglob("memory_palace.db"))
        print("matches", matches[:5])
        if matches:
            db = matches[0]
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    for r in con.execute("SELECT id, name FROM subjects ORDER BY id"):
        print("subject", dict(r))
    for r in con.execute(
        "SELECT id, name, parent_id, subject_id FROM chapters ORDER BY subject_id, id"
    ):
        name = r["name"] or ""
        if any(k in name for k in ["外", "第六", "西欧", "夸美", "卢梭", "洛克", "赫尔", "裴斯", "福禄", "思潮"]):
            print("chapter", dict(r))
    for r in con.execute(
        "SELECT id, title, primary_chapter_id FROM palaces ORDER BY id"
    ):
        title = r["title"] or ""
        if any(
            k in title
            for k in [
                "夸美",
                "洛克",
                "卢梭",
                "裴斯",
                "赫尔巴特",
                "福禄",
                "思潮",
                "斯宾塞",
                "马克思",
                "第斯多惠",
            ]
        ):
            print("palace", dict(r))


if __name__ == "__main__":
    main()
