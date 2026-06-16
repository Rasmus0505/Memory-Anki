from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .question_source_meta_pdf_sources import (
    build_legacy_pdf_source,
    normalize_pdf_sources,
)
from .question_source_meta_pdf_summary import (
    flatten_pdf_source_image_names,
    flatten_pdf_source_page_numbers,
    resolve_primary_pdf_subject_document_id,
)


@dataclass(frozen=True, slots=True)
class NormalizedPdfSourceMeta:
    pdf_sources: list[dict[str, Any]] | None
    primary_subject_document_id: int | None
    flattened_page_numbers: list[int] | None
    flattened_image_names: list[str] | None


def normalize_pdf_source_meta(
    source_meta: dict[str, Any],
    *,
    subject_document_id: int | None,
    page_numbers: list[int] | None,
    image_names: list[str] | None,
) -> NormalizedPdfSourceMeta:
    pdf_sources = normalize_pdf_sources(source_meta.get("pdf_sources"))
    if pdf_sources is None:
        pdf_sources = build_legacy_pdf_source(
            source_meta,
            subject_document_id=subject_document_id,
            page_numbers=page_numbers,
            image_names=image_names,
        )
    if not pdf_sources:
        return NormalizedPdfSourceMeta(
            pdf_sources=None,
            primary_subject_document_id=subject_document_id,
            flattened_page_numbers=page_numbers,
            flattened_image_names=image_names,
        )
    return NormalizedPdfSourceMeta(
        pdf_sources=pdf_sources,
        primary_subject_document_id=resolve_primary_pdf_subject_document_id(
            pdf_sources,
            fallback_subject_document_id=subject_document_id,
        ),
        flattened_page_numbers=flatten_pdf_source_page_numbers(pdf_sources),
        flattened_image_names=flatten_pdf_source_image_names(pdf_sources),
    )


__all__ = [
    "NormalizedPdfSourceMeta",
    "normalize_pdf_source_meta",
]
