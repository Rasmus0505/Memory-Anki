from __future__ import annotations

import json
from pathlib import Path

import fitz
from PIL import Image


PDF_ROOT = Path(r"D:\考研（丹丹）\1000题")
OUT_ROOT = Path(r"D:\我的网站\Memory Anki\output\1000题_visual_work")
IMAGE_ROOT = OUT_ROOT / "pages"
MANIFEST_PATH = OUT_ROOT / "manifest.json"


PDFS = [
    {"kind": "questions", "part": "教育学原理", "path": PDF_ROOT / "01.试题册" / "03.教原.pdf"},
    {"kind": "questions", "part": "中国教育史", "path": PDF_ROOT / "01.试题册" / "01中教.pdf"},
    {"kind": "questions", "part": "外国教育史", "path": PDF_ROOT / "01.试题册" / "02.外教.pdf"},
    {"kind": "questions", "part": "教育心理学及附录", "path": PDF_ROOT / "01.试题册" / "04.教心➕样卷➕真题.pdf"},
    {"kind": "answers", "part": "解析目录", "path": PDF_ROOT / "02.解析册" / "00.解析目录.pdf"},
    {"kind": "answers", "part": "教育学原理", "path": PDF_ROOT / "02.解析册" / "03.教原解析.pdf"},
    {"kind": "answers", "part": "中国教育史", "path": PDF_ROOT / "02.解析册" / "01.中教解析.pdf"},
    {"kind": "answers", "part": "外国教育史", "path": PDF_ROOT / "02.解析册" / "02.外教解析.pdf"},
    {"kind": "answers", "part": "教育心理学及附录", "path": PDF_ROOT / "02.解析册" / "04.教心解析.pdf"},
]


def safe_stem(path: Path) -> str:
    return path.stem.replace("➕", "+").replace(".", "_").replace(" ", "")


def render_half_pages(pdf_info: dict, zoom: float = 1.35) -> dict:
    path = pdf_info["path"]
    stem = safe_stem(path)
    out_dir = IMAGE_ROOT / stem
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(path))
    pages = []
    for page_index, page in enumerate(doc):
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        width, height = img.size
        overlap = max(6, int(width * 0.008))
        crops = {
            "L": (0, 0, width // 2 + overlap, height),
            "R": (width // 2 - overlap, 0, width, height),
        }
        for side, box in crops.items():
            out_path = out_dir / f"p{page_index + 1:03d}_{side}.jpg"
            if not out_path.exists():
                half = img.crop(box)
                half.save(out_path, "JPEG", quality=88, optimize=True)
            pages.append(
                {
                    "pdf_page": page_index + 1,
                    "side": side,
                    "printed_order": page_index * 2 + (1 if side == "L" else 2),
                    "image": str(out_path),
                }
            )
    doc.close()
    return {
        "source_pdf": str(path),
        "source_name": path.name,
        "kind": pdf_info["kind"],
        "part": pdf_info["part"],
        "image_dir": str(out_dir),
        "pdf_pages": len(doc) if False else len(pages) // 2,
        "half_pages": len(pages),
        "pages": pages,
    }


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
    manifest = [render_half_pages(info) for info in PDFS]
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(MANIFEST_PATH)
    print(sum(item["half_pages"] for item in manifest), "half-pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
