# -*- coding: utf-8 -*-
"""Split chapter6 OCR into 7 section text files by known page ranges."""
from __future__ import annotations

import re
from pathlib import Path

SRC = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_ocr\knowledge")
OUT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_ocr\sections")
OUT.mkdir(parents=True, exist_ok=True)

# PDF page ranges based on 精华提要 markers and body continuity
RANGES = {
    "01_第一节夸美纽斯的教育思想": (82, 89),
    "02_第二节卢梭的教育思想": (90, 95),
    "03_第三节裴斯泰洛齐的教育思想": (96, 102),
    "04_第四节赫尔巴特的教育思想": (103, 116),
    "05_第五节福禄培尔的教育思想": (117, 124),
    "06_第六节马克思和恩格斯的教育思想": (125, 130),
    "07_第七节西欧近代教育思潮": (131, 140),
}


def clean(text: str) -> str:
    lines = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if "后续更新" in s or "qq群" in s:
            continue
        lines.append(s)
    return "\n".join(lines)


def is_dup(a: str, b: str) -> bool:
    ca, cb = re.sub(r"\s+", "", a), re.sub(r"\s+", "", b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    if len(ca) > 200 and ca[:220] == cb[:220] and abs(len(ca) - len(cb)) < 40:
        return True
    return False


def main() -> None:
    for name, (start, end) in RANGES.items():
        parts = []
        prev = ""
        for p in range(start, end + 1):
            path = SRC / f"page_{p:03d}.txt"
            if not path.exists():
                print(name, "missing", p)
                continue
            text = clean(path.read_text(encoding="utf-8", errors="ignore"))
            if is_dup(prev, text):
                continue
            parts.append(f"===== PAGE {p} =====\n{text}")
            prev = text
        out = OUT / f"{name}.txt"
        body = "\n\n".join(parts)
        out.write_text(body, encoding="utf-8")
        print(name, "parts", len(parts), "chars", len(body))
    # also save intro map page
    intro = clean((SRC / "page_080.txt").read_text(encoding="utf-8", errors="ignore")) if (SRC / "page_080.txt").exists() else ""
    (OUT / "00_知识导图.txt").write_text(intro, encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
