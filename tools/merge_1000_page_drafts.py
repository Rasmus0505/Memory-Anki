from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(r"D:\我的网站\Memory Anki\output\1000题_visual_work")
DRAFTS = ROOT / "drafts_pages"
MERGED = ROOT / "merged_partial"


PREFIX_TO_PART = {
    "教育学原理": "教育学原理",
    "中国教育史": "中国教育史",
    "外国教育史": "外国教育史",
    "教育心理学": "教育心理学",
}


def clean_piece(text: str) -> str:
    text = text.replace("\ufeff", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main() -> int:
    MERGED.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[Path]] = {part: [] for part in PREFIX_TO_PART.values()}
    for path in sorted(DRAFTS.glob("*.md")):
        for prefix, part in PREFIX_TO_PART.items():
            if path.name.startswith(prefix):
                grouped[part].append(path)
                break

    for part, paths in grouped.items():
        if not paths:
            continue
        chunks = []
        for path in sorted(paths, key=lambda p: p.name):
            chunks.append(clean_piece(path.read_text(encoding="utf-8")))
        out = MERGED / f"{part}_partial.md"
        out.write_text("\n\n".join(chunk for chunk in chunks if chunk) + "\n", encoding="utf-8")
        print(out, len(paths))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
