# -*- coding: utf-8 -*-
"""OCR knowledge PDF pages for chapter 6 (printed ~78-121 => PDF pages ~80-123)."""
from __future__ import annotations

import json
from pathlib import Path

import fitz
from rapidocr_onnxruntime import RapidOCR

PDF = Path(r"D:\考研（丹丹）\原版\外国教育史知识清单.pdf")
OUT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_ocr\knowledge")
OUT.mkdir(parents=True, exist_ok=True)
CACHE = Path(r"E:\memory anki data\pdf_ocr_cache\3d1b56dae1ff423a98ff94bccc410971")

# PDF 1-based page numbers covering ch6 intro + body + self-test before ch7
START = 80  # printed ~78
END = 124  # exclusive-ish; printed ~122 is ch7 start

ocr = RapidOCR()


def ocr_page(doc: fitz.Document, page_1based: int, scale: float = 2.0) -> str:
    cache_txt = CACHE / f"page-{page_1based}.txt"
    if cache_txt.exists() and cache_txt.stat().st_size > 200:
        return cache_txt.read_text(encoding="utf-8", errors="ignore")
    out_txt = OUT / f"page_{page_1based:03d}.txt"
    if out_txt.exists() and out_txt.stat().st_size > 200:
        return out_txt.read_text(encoding="utf-8", errors="ignore")

    page = doc[page_1based - 1]
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    img_path = OUT / f"page_{page_1based:03d}.png"
    pix.save(str(img_path))
    result, _ = ocr(str(img_path))
    lines = []
    if result:
        for item in result:
            if len(item) >= 2 and item[1]:
                lines.append(str(item[1]).strip())
    text = "\n".join(lines)
    out_txt.write_text(text, encoding="utf-8")
    # also write to cache for reuse
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_txt.write_text(text, encoding="utf-8")
        (CACHE / f"page-{page_1based}.meta.json").write_text(
            json.dumps({"page": page_1based, "engine": "rapidocr", "chars": len(text)}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as e:
        print("cache write fail", page_1based, e)
    return text


def main() -> None:
    doc = fitz.open(str(PDF))
    print("pages", doc.page_count, "ocr range", START, END)
    all_parts = []
    for p in range(START, min(END + 1, doc.page_count + 1)):
        text = ocr_page(doc, p)
        compact = text.replace(" ", "")
        flags = [k for k in ["第一节", "第二节", "第三节", "第四节", "第五节", "第六节", "第七节", "第七章", "夸美纽斯", "卢梭", "裴斯泰洛齐", "赫尔巴特", "福禄培尔", "马克思", "教育思潮", "知识导图", "精华提要", "知识点"] if k in compact]
        print(f"page {p}: len={len(text)} flags={flags}")
        all_parts.append(f"===== PDF_PAGE {p} =====\n{text}")
    (OUT / "chapter6_all.txt").write_text("\n\n".join(all_parts), encoding="utf-8")
    print("wrote", OUT / "chapter6_all.txt")


if __name__ == "__main__":
    main()
