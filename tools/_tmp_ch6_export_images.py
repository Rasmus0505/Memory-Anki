# -*- coding: utf-8 -*-
"""Export PDF pages to PNG for multimodal vision agents."""
from __future__ import annotations

from pathlib import Path

import fitz

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_vision")
KNOW = Path(r"D:\考研（丹丹）\原版\外国教育史知识清单.pdf")
QPDF = Path(r"D:\考研（丹丹）\原版\题库-题目\02.外教.pdf")
APDF = Path(r"D:\考研（丹丹）\原版\题库-解析\02.外教解析.pdf")

# PDF 1-based page ranges for chapter 6 body (from prior TOC/probe)
SECTIONS = {
    "01_夸美纽斯": list(range(82, 90)),
    "02_卢梭": list(range(90, 96)),
    "03_裴斯泰洛齐": list(range(96, 103)),
    "04_赫尔巴特": list(range(103, 117)),
    "05_福禄培尔": list(range(117, 126)),
    "06_马克思恩格斯": list(range(125, 132)),
    "07_教育思潮": list(range(131, 141)),
}
# also chapter map intro
INTRO = [80, 81]
# quiz pages (1-based) covering ch6
QUIZ_Q = list(range(12, 17))
QUIZ_A = list(range(12, 22))


def export(pdf: Path, pages: list[int], out_dir: Path, scale: float = 2.0) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf))
    paths = []
    for p in pages:
        if p < 1 or p > doc.page_count:
            continue
        out = out_dir / f"page_{p:03d}.png"
        if out.exists() and out.stat().st_size > 10_000:
            paths.append(str(out))
            continue
        pix = doc[p - 1].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        pix.save(str(out))
        paths.append(str(out))
        print("wrote", out.name, out.stat().st_size)
    return paths


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    export(KNOW, INTRO, ROOT / "knowledge" / "00_导图", 2.0)
    for name, pages in SECTIONS.items():
        export(KNOW, pages, ROOT / "knowledge" / name, 2.0)
    export(QPDF, QUIZ_Q, ROOT / "quiz" / "questions", 2.0)
    export(APDF, QUIZ_A, ROOT / "quiz" / "answers", 2.0)
    print("DONE root", ROOT)


if __name__ == "__main__":
    main()
