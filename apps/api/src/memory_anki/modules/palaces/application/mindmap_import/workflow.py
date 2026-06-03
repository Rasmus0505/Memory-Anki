from __future__ import annotations

from typing import Any

from .contracts import (
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_IMPORT_MODE_STRUCTURED_MERGE,
    MindMapImportError,
    PdfImportOptions,
)
from .normalization import build_editor_doc, trim_pdf_extracted_text


def resolve_pdf_structure_page(page_numbers: list[int], structure_page: int | None) -> int:
    if not page_numbers:
        raise MindMapImportError("请至少选择一页 PDF。")
    if structure_page is not None:
        try:
            normalized_structure_page = int(structure_page)
        except (TypeError, ValueError):
            normalized_structure_page = None
        if normalized_structure_page in page_numbers:
            return normalized_structure_page
    return page_numbers[0]


def split_rendered_pdf_pages(
    rendered_pages: list[tuple[int, bytes, str]],
    *,
    structure_page: int,
) -> tuple[tuple[int, bytes, str], list[tuple[int, bytes, str]]]:
    structure_payload = next(
        (payload for payload in rendered_pages if payload[0] == structure_page),
        None,
    )
    if structure_payload is None:
        raise MindMapImportError("未找到指定的结构页，请重新选择后再试。")
    body_payloads = [payload for payload in rendered_pages if payload[0] != structure_page]
    return structure_payload, body_payloads


def order_pdf_image_items(
    structure_payload: tuple[int, bytes, str],
    body_payloads: list[tuple[int, bytes, str]],
) -> list[tuple[bytes, str | None]]:
    return [
        (structure_payload[1], structure_payload[2]),
        *[(image_bytes, filename) for _, image_bytes, filename in body_payloads],
    ]


def build_pdf_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
    selected_pages: list[int],
    structure_page: int | None,
    import_options: PdfImportOptions,
    warnings: list[str] | None = None,
    match_mode: str = "strict_match",
    ocr_grounding_used: bool | None = None,
    ocr_text_chars: int | None = None,
) -> dict[str, Any]:
    editor_doc = build_editor_doc(
        source_tree,
        fallback_title=fallback_title,
        preserve_line_breaks=import_options.preserve_line_breaks,
    )
    return {
        "source_tree": source_tree,
        "editor_doc": editor_doc,
        "selected_pages": selected_pages,
        "structure_page": structure_page,
        "match_mode": match_mode,
        "can_apply": True,
        "warnings": list(warnings or []),
        "ocr_grounding_used": ocr_grounding_used,
        "ocr_text_chars": ocr_text_chars,
    }


def build_image_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
) -> dict[str, Any]:
    return {
        "source_tree": source_tree,
        "editor_doc": build_editor_doc(
            source_tree,
            fallback_title=fallback_title,
            preserve_line_breaks=True,
        ),
        "warnings": [],
        "can_apply": True,
        "match_mode": "strict_match",
    }


def build_batch_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
    structure_image_index: int,
    image_count: int,
) -> dict[str, Any]:
    return {
        **build_image_import_result_payload(
            source_tree=source_tree,
            fallback_title=fallback_title,
        ),
        "structure_image_index": structure_image_index,
        "image_count": image_count,
    }


def build_text_result_payload(
    *,
    extracted_text: str,
    selected_pages: list[int] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "extracted_text": extracted_text,
        "warnings": [],
        "can_apply": False,
        "match_mode": "strict_match",
    }
    if selected_pages is not None:
        payload["selected_pages"] = selected_pages
    return payload


def prepare_pdf_ocr_grounding(
    extracted_text: str,
    *,
    structure_title: str,
    range_prompt: str,
) -> tuple[str | None, int]:
    trimmed_text = (
        trim_pdf_extracted_text(
            extracted_text,
            structure_title=structure_title,
            range_prompt=range_prompt,
        )
        or None
    )
    return trimmed_text, len(trimmed_text or extracted_text or "")


def normalize_pdf_import_mode(pdf_mode: str | None) -> str:
    normalized = str(pdf_mode or "").strip()
    if normalized == PDF_IMPORT_MODE_STRUCTURED_MERGE:
        return PDF_IMPORT_MODE_STRUCTURED_MERGE
    return PDF_IMPORT_MODE_DIRECT_GENERATION
