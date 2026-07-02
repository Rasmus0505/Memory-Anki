"""Context loading for PDF quiz generation requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from .quiz_generation_chaptering import resolve_selected_generation_chapter
from .quiz_generation_pdf_request_sources import (
    PdfGenerationSourceArtifacts,
    prepare_pdf_generation_source_artifacts,
)
from .question_contracts import PalaceQuizValidationError
from .question_lookup_queries import get_palace_or_raise


@dataclass(frozen=True, slots=True)
class PdfGenerationRequestContext:
    palace: Any
    selected_chapter: Any
    source_artifacts: PdfGenerationSourceArtifacts


def load_pdf_generation_request_context(
    session: Session,
    *,
    palace_id: int,
    normalized_sources: list[dict[str, object]],
    selected_chapter_id: int | None,
    render_selected_pdf_pages: Any,
) -> PdfGenerationRequestContext:
    palace = get_palace_or_raise(session, palace_id)
    if selected_chapter_id is None:
        selected_chapter_id = palace.primary_chapter_id
    selected_chapter = resolve_selected_generation_chapter(
        session,
        palace=palace,
        selected_chapter_id=selected_chapter_id,
    )
    if len(normalized_sources) == 0:
        raise PalaceQuizValidationError("请至少添加一份 PDF，并为每份 PDF 选择页码。")
    source_artifacts = prepare_pdf_generation_source_artifacts(
        session,
        normalized_sources=normalized_sources,
        render_selected_pdf_pages=render_selected_pdf_pages,
    )
    return PdfGenerationRequestContext(
        palace=palace,
        selected_chapter=selected_chapter,
        source_artifacts=source_artifacts,
    )


__all__ = [
    "PdfGenerationRequestContext",
    "load_pdf_generation_request_context",
]
