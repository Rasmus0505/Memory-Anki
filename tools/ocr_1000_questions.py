from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


PDF_ROOT = Path(r"D:\考研（丹丹）\1000题")
OUT_ROOT = Path(r"D:\我的网站\Memory Anki\output\1000题_ocr_work")
OCR_ROOT = OUT_ROOT / "ocr_pages"
LOG_PATH = OUT_ROOT / "ocr_progress.jsonl"


PDFS = [
    PDF_ROOT / "01.试题册" / "03.教原.pdf",
    PDF_ROOT / "01.试题册" / "01中教.pdf",
    PDF_ROOT / "01.试题册" / "02.外教.pdf",
    PDF_ROOT / "01.试题册" / "04.教心➕样卷➕真题.pdf",
    PDF_ROOT / "02.解析册" / "00.解析目录.pdf",
    PDF_ROOT / "02.解析册" / "03.教原解析.pdf",
    PDF_ROOT / "02.解析册" / "01.中教解析.pdf",
    PDF_ROOT / "02.解析册" / "02.外教解析.pdf",
    PDF_ROOT / "02.解析册" / "04.教心解析.pdf",
]


NOISE_PATTERNS = [
    re.compile(r"后续更新\s*q+群?\s*\d*", re.I),
    re.compile(r"后续更新qq群\s*\d*", re.I),
    re.compile(r"^群\s*\d{6,}$"),
    re.compile(r"^\s*[S5]?\d+\s*$"),
]


def safe_stem(path: Path) -> str:
    return (
        path.stem.replace("➕", "+")
        .replace(" ", "")
        .replace(".", "_")
        .replace("．", "_")
    )


def line_center(box: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def is_noise(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return any(p.search(compact) for p in NOISE_PATTERNS)


def normalize_lines(result: list) -> list[dict]:
    lines = []
    for item in result or []:
        if len(item) < 3:
            continue
        box, text, score = item[0], str(item[1]).strip(), float(item[2])
        if not text or is_noise(text):
            continue
        cx, cy = line_center(box)
        lines.append({"box": box, "text": text, "score": score, "cx": cx, "cy": cy})

    # OCR boxes are usually already in reading order, but sorting by row then x fixes
    # occasional option-order drift while preserving question flow.
    lines.sort(key=lambda r: (round(r["cy"] / 28) * 28, r["cx"]))
    return lines


def join_lines(lines: list[dict]) -> str:
    return "\n".join(line["text"] for line in lines)


def page_outputs(pdf_path: Path, page_index: int, side: str) -> tuple[Path, Path]:
    stem = safe_stem(pdf_path)
    folder = OCR_ROOT / stem
    folder.mkdir(parents=True, exist_ok=True)
    base = folder / f"p{page_index + 1:03d}_{side}"
    return base.with_suffix(".json"), base.with_suffix(".txt")


def render_side(page: fitz.Page, side: str, zoom: float = 1.6) -> Image.Image:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    w, h = img.size
    # The PDFs are scanned spreads: one PDF page contains two printed pages.
    # Keep a tiny overlap so text close to the gutter is not clipped.
    overlap = max(8, int(w * 0.008))
    if side == "L":
        return img.crop((0, 0, w // 2 + overlap, h))
    return img.crop((w // 2 - overlap, 0, w, h))


def append_log(record: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def process_pdf(engine: RapidOCR, pdf_path: Path) -> None:
    doc = fitz.open(str(pdf_path))
    for page_index in range(len(doc)):
        page = doc[page_index]
        for side in ("L", "R"):
            json_path, txt_path = page_outputs(pdf_path, page_index, side)
            if json_path.exists() and txt_path.exists():
                continue
            started = time.time()
            try:
                img = render_side(page, side)
                result, elapsed = engine(np.array(img))
                lines = normalize_lines(result or [])
                payload = {
                    "source_pdf": str(pdf_path),
                    "source_name": pdf_path.name,
                    "pdf_page": page_index + 1,
                    "side": side,
                    "printed_page_order": page_index * 2 + (1 if side == "L" else 2),
                    "line_count": len(lines),
                    "text": join_lines(lines),
                    "lines": lines,
                    "ocr_elapsed": elapsed,
                }
                json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                txt_path.write_text(payload["text"], encoding="utf-8")
                append_log(
                    {
                        "status": "ok",
                        "pdf": pdf_path.name,
                        "page": page_index + 1,
                        "side": side,
                        "lines": len(lines),
                        "seconds": round(time.time() - started, 2),
                    }
                )
            except Exception as exc:
                append_log(
                    {
                        "status": "error",
                        "pdf": pdf_path.name,
                        "page": page_index + 1,
                        "side": side,
                        "error": repr(exc),
                    }
                )
                raise
    doc.close()


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    OCR_ROOT.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()
    targets = PDFS
    if len(sys.argv) > 1:
        wanted = set(sys.argv[1:])
        targets = [p for p in PDFS if p.name in wanted or p.stem in wanted]
    for pdf_path in targets:
        if not pdf_path.exists():
            append_log({"status": "missing", "pdf": str(pdf_path)})
            continue
        process_pdf(engine, pdf_path)
    append_log({"status": "done", "timestamp": time.time()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
