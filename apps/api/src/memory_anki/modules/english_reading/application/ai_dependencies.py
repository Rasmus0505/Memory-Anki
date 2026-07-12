from __future__ import annotations

from dataclasses import dataclass

from memory_anki.platform.application import AiRuntimeProvider, PromptCatalog


@dataclass(frozen=True, slots=True)
class EnglishReadingAiDependencies:
    runtime: AiRuntimeProvider
    prompts: PromptCatalog
