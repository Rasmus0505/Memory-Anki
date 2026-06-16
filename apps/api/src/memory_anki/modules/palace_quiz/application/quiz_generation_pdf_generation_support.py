"""Support types and planning helpers for PDF quiz generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


QuizStreamEvent = tuple[str, dict[str, Any]]


@dataclass(frozen=True, slots=True)
class PdfGenerationStepPlan:
    total_steps: int
    pairing_step: int | None
    review_step: int | None
    normalizing_step: int


def build_pdf_generation_step_plan(
    *,
    should_pair_with_turbo: bool,
    should_review_with_turbo: bool,
) -> PdfGenerationStepPlan:
    next_step = 3
    pairing_step = None
    if should_pair_with_turbo:
        pairing_step = next_step
        next_step += 1
    review_step = None
    if should_review_with_turbo:
        review_step = next_step
        next_step += 1
    return PdfGenerationStepPlan(
        total_steps=next_step,
        pairing_step=pairing_step,
        review_step=review_step,
        normalizing_step=next_step,
    )


def resolve_pdf_generation_completion_step(
    *,
    step_plan: PdfGenerationStepPlan,
    phase: str,
) -> int | None:
    if phase == "pairing":
        return step_plan.pairing_step
    if phase == "reviewing":
        return step_plan.review_step
    if phase == "normalizing":
        return step_plan.normalizing_step
    return None


__all__ = [
    "PdfGenerationStepPlan",
    "QuizStreamEvent",
    "build_pdf_generation_step_plan",
    "resolve_pdf_generation_completion_step",
]
