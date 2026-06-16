"""Facade for PDF-specific AI step helpers."""

from __future__ import annotations

from .quiz_generation_pdf_step_runtime import (
    pair_pdf_generation_with_turbo as pair_pdf_generation_with_turbo,
    recover_pdf_pairing_from_log as recover_pdf_pairing_from_log,
    review_pdf_generation_with_turbo as review_pdf_generation_with_turbo,
)
from .quiz_generation_pdf_step_support import (
    ScenarioAiOptionsMap as ScenarioAiOptionsMap,
    build_pdf_pairing_prompt as build_pdf_pairing_prompt,
    build_pdf_review_prompt as build_pdf_review_prompt,
    resolve_pdf_step_ai_options as resolve_pdf_step_ai_options,
    should_pair_pdf_generation_with_turbo as should_pair_pdf_generation_with_turbo,
    should_review_pdf_generation_with_turbo as should_review_pdf_generation_with_turbo,
)

__all__ = [
    "ScenarioAiOptionsMap",
    "build_pdf_pairing_prompt",
    "build_pdf_review_prompt",
    "pair_pdf_generation_with_turbo",
    "recover_pdf_pairing_from_log",
    "resolve_pdf_step_ai_options",
    "review_pdf_generation_with_turbo",
    "should_pair_pdf_generation_with_turbo",
    "should_review_pdf_generation_with_turbo",
]
