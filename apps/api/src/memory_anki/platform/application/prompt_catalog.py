from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class PromptRunSelection:
    block_keys: tuple[str, ...] | None = None
    scene_instruction: str | None = None
    run_instruction: str | None = None


@dataclass(frozen=True, slots=True)
class CompiledPromptSnapshot:
    scene_key: str
    prompt_key: str
    text: str
    block_keys: tuple[str, ...]
    block_versions: dict[str, str | None]
    scene_version_id: str | None
    scene_instruction: str
    run_instruction: str
    warnings: tuple[str, ...]
    estimated_tokens: int


class PromptCatalog(Protocol):
    """Render configured prompts without exposing settings storage or templates."""

    def render(
        self,
        key: str,
        variables: dict[str, Any] | None = None,
    ) -> str: ...

    def compose(
        self,
        scene_key: str,
        variables: dict[str, Any] | None = None,
        selection: PromptRunSelection | None = None,
    ) -> CompiledPromptSnapshot: ...
