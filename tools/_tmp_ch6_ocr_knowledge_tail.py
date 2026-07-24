# -*- coding: utf-8 -*-
"""OCR remaining ch6 pages (Marx + trends + self-test)."""
from __future__ import annotations

import json
from pathlib import Path

import fitz
from rapidocr_onnxruntime import RapidOCR

PDF = Path(r"D:\考研（丹丹）\原版\外国教育史知识清单.pdf")
OUT = Path(r"D:\BaiduSyncdisk\Memory Anki\tools\_tmp_ch6_ocr\knowledge")
OUT.mkdir(parents=True, exist_ok=True)
CACHE = Path(r"E:\memory anki data\pdf_ocr_cache\3d1b56dae1ff423a98ff94bccc410971")
START, END = 125, 140
ocr = RapidOCR()


def ocr_page(doc, page_1based: int, scale: float = 2.0) -> str:
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
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"page-{page_1based}.txt").write_text(text, encoding="utf-8")
    except Exception:
        pass
    return text


def main() -> None:
    doc = fitz.open(str(PDF))
    for p in range(START, min(END + 1, doc.page_count + 1)):
        text = ocr_page(doc, p)
        compact = text.replace(" ", "")
        flags = [
            k
            for k in [
                "第六节",
                "第七节",
                "第七章",
                "马克思",
                "恩格斯",
                "教育思潮",
                "自然主义",
                "科学教育",
                "国家主义",
                "心理学化",
                "福禄培尔",
                "本章自测",
            ]
            if k in compact
        ]
        print(f"page {p}: len={len(text)} flags={flags}")
    print("done")


if __name__ == "__main__":
    main()
