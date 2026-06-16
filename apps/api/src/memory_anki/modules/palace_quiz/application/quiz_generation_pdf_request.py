"""Facade for PDF quiz generation request preparation."""

from __future__ import annotations

from .quiz_generation_pdf_request_runtime import (
    PdfGenerationPreparedRequest as PdfGenerationPreparedRequest,
    prepare_pdf_generation_request as prepare_pdf_generation_request,
)

__all__ = [
    "PdfGenerationPreparedRequest",
    "prepare_pdf_generation_request",
]
