from __future__ import annotations

from pathlib import Path
from typing import Any


def build_uploaded_image_ocr_sources(
    *,
    image_items: list[tuple[bytes, str | None]],
    source_meta: dict[str, Any],
) -> list[dict[str, Any]]:
    import_batch = str(source_meta.get("ai_call_log_id") or source_meta.get("generated_at") or "image-preview")
    sources: list[dict[str, Any]] = []
    refs: list[dict[str, Any]] = []
    for index, (_content, filename) in enumerate(image_items, start=1):
        page_key = f"image_{index:03d}"
        display_name = str(filename or f"image-{index}.png")
        refs.append({"source_set": "image_upload", "page_key": page_key, "filename": display_name})
        sources.append(
            {
                "source_kind": "image_upload",
                "source_set": "image_upload",
                "page_key": page_key,
                "page_number": index,
                "image_path": display_name,
                "raw_text": "",
                "lines": [],
                "source_meta": {
                    "filename": display_name,
                    "note": "Uploaded image source; OCR text is not available before model transcription.",
                },
                "import_batch": import_batch,
            }
        )
    source_meta["ocr_source_refs"] = refs
    return sources


def build_text_file_ocr_sources(
    *,
    file_artifacts: list[dict[str, Any]],
    source_meta: dict[str, Any],
) -> list[dict[str, Any]]:
    import_batch = str(source_meta.get("ai_call_log_id") or source_meta.get("generated_at") or "text-preview")
    sources: list[dict[str, Any]] = []
    refs: list[dict[str, Any]] = []
    for index, artifact in enumerate(file_artifacts, start=1):
        filename = str(artifact.get("filename") or f"text-{index}.txt")
        page_key = Path(filename).stem.strip() or f"text_{index:03d}"
        page_key = f"{page_key}_{index:03d}"
        refs.append({"source_set": "text_files", "page_key": page_key, "filename": filename})
        sources.append(
            {
                "source_kind": "text_files",
                "source_set": "text_files",
                "page_key": page_key,
                "page_number": index,
                "image_path": filename,
                "raw_text": str(artifact.get("decoded_text") or ""),
                "lines": [],
                "source_meta": {
                    "filename": filename,
                    "extension": artifact.get("extension"),
                    "mime_type": artifact.get("mime_type"),
                },
                "import_batch": import_batch,
            }
        )
    source_meta["ocr_source_refs"] = refs
    return sources


__all__ = [
    "build_text_file_ocr_sources",
    "build_uploaded_image_ocr_sources",
]
