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
    ch_ids = list(range(69, 77))
    for cid in ch_ids:
        row = con.execute("SELECT id, name, parent_id FROM chapters WHERE id=?", (cid,)).fetchone()
        print("chapter", dict(row) if row else cid)
        for p in con.execute(
            "SELECT id, title, primary_chapter_id FROM palaces WHERE primary_chapter_id=? OR title LIKE ?",
            (cid, f"%{row['name'][-8:] if row else 'XXX'}%"),
        ):
            print("  palace", dict(p))
    # all foreign edu palaces
    print("--- all foreign palaces ---")
    for p in con.execute(
        """
        SELECT p.id, p.title, p.primary_chapter_id, c.name as ch
        FROM palaces p
        LEFT JOIN chapters c ON c.id = p.primary_chapter_id
        WHERE c.subject_id = 5 OR p.title LIKE '%近代%' OR p.title LIKE '%夸美%'
        ORDER BY p.id
        """
    ):
        print(dict(p))
    # sample mindmap structure from an existing palace
    sample = con.execute(
        "SELECT id, title, structure_json FROM palaces WHERE structure_json IS NOT NULL AND length(structure_json)>100 LIMIT 1"
    ).fetchone()
    if sample:
        print("sample palace", sample["id"], sample["title"])
        data = json.loads(sample["structure_json"])
        print(json.dumps(data, ensure_ascii=False)[:1500])
    else:
        # try other columns
        cols = [r[1] for r in con.execute("PRAGMA table_info(palaces)")]
        print("palace cols", cols)


if __name__ == "__main__":
    main()
