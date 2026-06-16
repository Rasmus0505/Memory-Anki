from __future__ import annotations

from typing import Any


def flatten_pdf_source_page_numbers(pdf_sources: list[dict[str, Any]]) -> list[int] | None:
    return sorted(
        {
            page
            for item in pdf_sources
            for page in (item.get("page_numbers") or [])
            if isinstance(page, int) and page > 0
        }
    ) or None


def flatten_pdf_source_image_names(pdf_sources: list[dict[str, Any]]) -> list[str] | None:
    flattened = [
        str(name).strip()
        for item in pdf_sources
        for name in (item.get("image_names") or [])
        if str(name).strip()
    ]
    return flattened or None


def resolve_primary_pdf_subject_document_id(
    pdf_sources: list[dict[str, Any]],
    *,
    fallback_subject_document_id: int | None,
) -> int | None:
    return next(
        (
            int(item["subject_document_id"])
            for item in pdf_sources
            if item.get("subject_document_id") not in (None, "", 0, "0")
        ),
        fallback_subject_document_id,
    )


__all__ = [
    "flatten_pdf_source_image_names",
    "flatten_pdf_source_page_numbers",
    "resolve_primary_pdf_subject_document_id",
]
