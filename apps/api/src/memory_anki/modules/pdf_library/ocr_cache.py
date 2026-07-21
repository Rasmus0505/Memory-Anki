"""Cross-job PDF page OCR cache under APP_HOME/pdf_ocr_cache.

Keyed by pdf document id + page number so later import jobs can reuse
successful page text without another provider call.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from memory_anki.core.config import PDF_OCR_CACHE_DIR

_PAGE_FILE_RE = re.compile(r"^page-(\d+)\.txt$")


def cache_root(cache_dir: Path | None = None) -> Path:
    return Path(cache_dir or PDF_OCR_CACHE_DIR)


def document_cache_dir(document_id: str, *, cache_dir: Path | None = None) -> Path:
    safe_id = str(document_id or "").strip()
    if not safe_id or "/" in safe_id or "\\" in safe_id or ".." in safe_id:
        raise ValueError("invalid pdf document id for OCR cache")
    return cache_root(cache_dir) / safe_id


def page_text_path(document_id: str, page_number: int, *, cache_dir: Path | None = None) -> Path:
    return document_cache_dir(document_id, cache_dir=cache_dir) / f"page-{int(page_number)}.txt"


def page_meta_path(document_id: str, page_number: int, *, cache_dir: Path | None = None) -> Path:
    return document_cache_dir(document_id, cache_dir=cache_dir) / f"page-{int(page_number)}.meta.json"


def read_cached_page(
    document_id: str,
    page_number: int,
    *,
    cache_dir: Path | None = None,
) -> tuple[str, dict[str, Any]] | None:
    text_path = page_text_path(document_id, page_number, cache_dir=cache_dir)
    if not text_path.exists():
        return None
    text = text_path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    meta: dict[str, Any] = {}
    meta_path = page_meta_path(document_id, page_number, cache_dir=cache_dir)
    if meta_path.exists():
        try:
            loaded = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                meta = loaded
        except (OSError, json.JSONDecodeError):
            meta = {}
    return text, meta


def write_cached_page(
    document_id: str,
    page_number: int,
    text: str,
    *,
    model: str | None = None,
    source_job_id: str | None = None,
    cache_dir: Path | None = None,
) -> Path:
    normalized = str(text or "").strip()
    if not normalized:
        raise ValueError("refusing to cache empty OCR text")
    directory = document_cache_dir(document_id, cache_dir=cache_dir)
    directory.mkdir(parents=True, exist_ok=True)
    text_path = page_text_path(document_id, page_number, cache_dir=cache_dir)
    text_path.write_text(normalized + "\n", encoding="utf-8")
    meta = {
        "document_id": str(document_id),
        "page_number": int(page_number),
        "model": str(model or "").strip() or None,
        "source_job_id": str(source_job_id or "").strip() or None,
        "updated_at": datetime.now(UTC).isoformat(),
        "char_count": len(normalized),
    }
    page_meta_path(document_id, page_number, cache_dir=cache_dir).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return text_path


def list_document_ocr_coverage(
    document_id: str,
    *,
    cache_dir: Path | None = None,
) -> list[dict[str, Any]]:
    directory = document_cache_dir(document_id, cache_dir=cache_dir)
    if not directory.is_dir():
        return []
    pages: list[dict[str, Any]] = []
    for path in sorted(directory.glob("page-*.txt")):
        match = _PAGE_FILE_RE.match(path.name)
        if not match:
            continue
        page_number = int(match.group(1))
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        meta: dict[str, Any] = {}
        meta_path = page_meta_path(document_id, page_number, cache_dir=cache_dir)
        if meta_path.exists():
            try:
                loaded = json.loads(meta_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    meta = loaded
            except (OSError, json.JSONDecodeError):
                meta = {}
        mtime = path.stat().st_mtime
        pages.append(
            {
                "page_number": page_number,
                "reused_available": True,
                "model": meta.get("model"),
                "source_job_id": meta.get("source_job_id"),
                "updated_at": meta.get("updated_at")
                or datetime.fromtimestamp(mtime, tz=UTC).isoformat(),
                "char_count": meta.get("char_count") or len(text),
            }
        )
    pages.sort(key=lambda item: int(item["page_number"]))
    return pages


def import_page_text_into_cache(
    document_id: str,
    page_number: int,
    text: str,
    *,
    model: str | None = None,
    source_job_id: str | None = None,
    cache_dir: Path | None = None,
    overwrite: bool = False,
) -> bool:
    """Seed cache from an existing job artifact. Returns True if written."""
    if not overwrite and read_cached_page(document_id, page_number, cache_dir=cache_dir) is not None:
        return False
    write_cached_page(
        document_id,
        page_number,
        text,
        model=model,
        source_job_id=source_job_id,
        cache_dir=cache_dir,
    )
    return True
