# -*- coding: utf-8 -*-
"""Binary-search-ish OCR of knowledge PDF for chapter 6 page range."""
from __future__ import annotations

import json
from pathlib import Path

import fitz
from rapidocr_onnxruntime import RapidOCR

PDF = Path(r"D:\考研（丹丹）\原版\外国教育史知识清单.pdf")
OUT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_ocr")
OUT.mkdir(parents=True, exist_ok=True)

ocr = RapidOCR()


def ocr_page(doc: fitz.Document, page_index: int, scale: float = 1.8) -> str:
    page = doc[page_index]
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    img_path = OUT / f"_probe_{page_index+1:03d}.png"
    pix.save(str(img_path))
    result, _ = ocr(str(img_path))
    lines = []
    if result:
        for item in result:
            # item: [box, text, score]
            if len(item) >= 2 and item[1]:
                lines.append(str(item[1]).strip())
    text = "\n".join(lines)
    (OUT / f"_probe_{page_index+1:03d}.txt").write_text(text, encoding="utf-8")
    return text


def main() -> None:
    doc = fitz.open(str(PDF))
    print("pages", doc.page_count)
    # sample strategic pages: TOC front + mid book
    candidates = [0, 1, 2, 3, 4, 5, 10, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280]
    hits = []
    for i in candidates:
        if i >= doc.page_count:
            continue
        text = ocr_page(doc, i)
        compact = text.replace(" ", "")
        flags = []
        for key in [
            "第六章",
            "第6章",
            "第6 章",
            "西欧近代教育思想",
            "夸美纽斯",
            "卢梭",
            "裴斯泰洛齐",
            "赫尔巴特",
            "福禄培尔",
            "马克思",
            "教育思潮",
            "第五章",
            "第七章",
            "目录",
            "欧美主要国家",
        ]:
            if key in compact:
                flags.append(key)
        print(f"page {i+1}: flags={flags} len={len(text)} head={compact[:80]!r}")
        if flags:
            hits.append({"page": i + 1, "flags": flags, "preview": compact[:200]})
    (OUT / "probe_hits.json").write_text(json.dumps(hits, ensure_ascii=False, indent=2), encoding="utf-8")
    print("done hits", len(hits))


if __name__ == "__main__":
    main()
