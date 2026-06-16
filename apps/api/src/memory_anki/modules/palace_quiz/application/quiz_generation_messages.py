"""Facade for quiz generation message and PDF source helpers."""

from __future__ import annotations

from .quiz_generation_pdf_source_messages import (
    build_pdf_source_context as build_pdf_source_context,
    normalize_pdf_sources_input as normalize_pdf_sources_input,
)
from .quiz_generation_prompt_messages import (
    build_generation_messages as build_generation_messages,
)

__all__ = [
    "build_generation_messages",
    "build_pdf_source_context",
    "normalize_pdf_sources_input",
]
