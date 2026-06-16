from __future__ import annotations

from typing import Any

from .question_source_meta_shared import (
    normalize_non_empty_string_list,
    normalize_optional_int,
    normalize_optional_string,
    normalize_positive_int_list,
)


def normalize_pdf_source_item(item: dict[str, Any]) -> dict[str, Any] | None:
    subject_document_id = normalize_optional_int(item.get("subject_document_id"))
    page_numbers = normalize_positive_int_list(item.get("page_numbers"))
    image_names = normalize_non_empty_string_list(item.get("image_names"))
    document_name = normalize_optional_string(item.get("document_name"))
    role_hint = normalize_optional_string(item.get("role_hint"))
    if (
        subject_document_id is None
        and not page_numbers
        and not image_names
        and not document_name
    ):
        return None
    return {
        "subject_document_id": subject_document_id,
        "document_name": document_name,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "role_hint": role_hint,
    }


def normalize_pdf_sources(raw_pdf_sources: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw_pdf_sources, list):
        return None
    normalized_items = [
        normalized
        for item in raw_pdf_sources
        if isinstance(item, dict)
        for normalized in [normalize_pdf_source_item(item)]
        if normalized is not None
    ]
    return normalized_items or None


def build_legacy_pdf_source(
    source_meta: dict[str, Any],
    *,
    subject_document_id: int | None,
    page_numbers: list[int] | None,
    image_names: list[str] | None,
) -> list[dict[str, Any]] | None:
    if subject_document_id is None:
        return None
    return [
        {
            "subject_document_id": subject_document_id,
            "document_name": normalize_optional_string(source_meta.get("document_name")),
            "page_numbers": page_numbers,
            "image_names": image_names,
            "role_hint": normalize_optional_string(source_meta.get("role_hint")),
        }
    ]


__all__ = [
    "build_legacy_pdf_source",
    "normalize_pdf_source_item",
    "normalize_pdf_sources",
]
