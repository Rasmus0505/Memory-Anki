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
    con = sqlite3.connect(str(home / "data" / "memory_palace.db"))
    con.row_factory = sqlite3.Row
    for table in ["pdf_documents", "quiz_pdf_assets", "palace_quiz_ocr_sources", "palace_quiz_questions", "attachments"]:
        cols = [x[1] for x in con.execute(f"PRAGMA table_info({table})")]
        print("===", table, cols)
        n = con.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
        print("count", n)
        for row in con.execute(f"SELECT * FROM {table} LIMIT 5"):
            d = dict(row)
            for k, v in list(d.items()):
                if isinstance(v, (bytes, memoryview)):
                    d[k] = f"<bytes {len(v)}>"
                elif isinstance(v, str) and len(v) > 160:
                    d[k] = v[:160] + "..."
            print(d)


if __name__ == "__main__":
    main()
