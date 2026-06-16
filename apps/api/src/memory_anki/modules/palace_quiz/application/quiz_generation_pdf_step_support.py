"""Support helpers for PDF-specific AI step orchestration."""

from __future__ import annotations

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions
from memory_anki.modules.settings.application.ai_prompt_templates import (
    build_palace_quiz_pdf_pairing_prompt,
    build_palace_quiz_pdf_review_prompt,
)

ScenarioAiOptionsMap = dict[str, AiRuntimeOptions]


def should_pair_pdf_generation_with_turbo(source_meta: dict[str, object]) -> bool:
    pdf_sources = source_meta.get("pdf_sources")
    if not isinstance(pdf_sources, list) or len(pdf_sources) < 2:
        return False
    roles = {str(item.get("role_hint") or "").strip() for item in pdf_sources if isinstance(item, dict)}
    return "question" in roles and "answer" in roles


def build_pdf_pairing_prompt(extra_prompt: str) -> str:
    return build_palace_quiz_pdf_pairing_prompt(extra_prompt)


def resolve_pdf_step_ai_options(
    *,
    scenario_key: str,
    ai_options_by_scenario: ScenarioAiOptionsMap | None = None,
    legacy_ai_options: AiRuntimeOptions | None = None,
    allow_legacy_fallback: bool = False,
) -> AiRuntimeOptions | None:
    if ai_options_by_scenario and scenario_key in ai_options_by_scenario:
        return ai_options_by_scenario[scenario_key]
    if allow_legacy_fallback:
        return legacy_ai_options
    return None


def should_review_pdf_generation_with_turbo(enable_secondary_review: bool) -> bool:
    return bool(enable_secondary_review)


def build_pdf_review_prompt(extra_prompt: str) -> str:
    return build_palace_quiz_pdf_review_prompt(extra_prompt)


__all__ = [
    "ScenarioAiOptionsMap",
    "build_pdf_pairing_prompt",
    "build_pdf_review_prompt",
    "resolve_pdf_step_ai_options",
    "should_pair_pdf_generation_with_turbo",
    "should_review_pdf_generation_with_turbo",
]
