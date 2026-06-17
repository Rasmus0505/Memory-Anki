"""PDF generation source rendering and source-item assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
)

from .question_contracts import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
)


@dataclass(frozen=True, slots=True)
class PdfGenerationSourceArtifacts:
    image_items: list[tuple[bytes, str | None]]
    source_items: list[dict[str, object]]
    source_labels: list[str]
    primary_subject_document_id: int | None
    all_page_numbers: list[int]
    all_image_names: list[str]


def _normalize_selected_pages(raw_page_selection: Any) -> list[int]:
    if not isinstance(raw_page_selection, list):
        raw_page_selection = []
    normalized_pages: set[int] = set()
    for raw_page in raw_page_selection:
        try:
            page_number = int(raw_page)
        except (TypeError, ValueError):
            continue
        if page_number > 0:
            normalized_pages.add(page_number)
    return sorted(normalized_pages)


def prepare_pdf_generation_source_artifacts(
    session: Session,
    *,
    normalized_sources: list[dict[str, Any]],
    render_selected_pdf_pages: Any,
) -> PdfGenerationSourceArtifacts:
    image_items: list[tuple[bytes, str | None]] = []
    source_items: list[dict[str, object]] = []
    all_page_numbers: list[int] = []
    all_image_names: list[str] = []
    source_labels: list[str] = []
    primary_subject_document_id: int | None = None

    for index, source in enumerate(normalized_sources, start=1):
        document = get_subject_document_by_id(session, source["subject_document_id"])
        if not document:
            raise PalaceQuizNotFoundError("PDF 资料不存在。")
        normalized_pages = _normalize_selected_pages(source.get("page_selection"))
        if len(normalized_pages) == 0:
            raise PalaceQuizValidationError("每份 PDF 至少需要选择一页。")
        rendered_pages = render_selected_pdf_pages(
            document,
            page_numbers=normalized_pages,
            kind="preview",
        )
        rendered_image_names = [filename for _, _, filename in rendered_pages]
        image_items.extend((image_bytes, filename) for _, image_bytes, filename in rendered_pages)
        all_page_numbers.extend(normalized_pages)
        all_image_names.extend(
            [filename for filename in rendered_image_names if str(filename or "").strip()]
        )
        role_hint = str(source.get("role_hint") or "").strip() or None
        source_items.append(
            {
                "subject_document_id": document.id,
                "document_name": document.original_name,
                "page_numbers": normalized_pages,
                "image_names": rendered_image_names,
                "role_hint": role_hint,
            }
        )
        source_labels.append(
            f"资料{index}《{document.original_name}》第 {', '.join(str(page) for page in normalized_pages)} 页"
        )
        if primary_subject_document_id is None:
            primary_subject_document_id = document.id

    return PdfGenerationSourceArtifacts(
        image_items=image_items,
        source_items=source_items,
        source_labels=source_labels,
        primary_subject_document_id=primary_subject_document_id,
        all_page_numbers=all_page_numbers,
        all_image_names=all_image_names,
    )


__all__ = [
    "PdfGenerationSourceArtifacts",
    "prepare_pdf_generation_source_artifacts",
]
