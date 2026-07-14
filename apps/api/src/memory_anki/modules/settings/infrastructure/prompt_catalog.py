from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_prompt_composition import compile_prompt
from memory_anki.modules.settings.application.ai_prompts import render_prompt
from memory_anki.platform.application.prompt_catalog import (
    CompiledPromptSnapshot,
    PromptRunSelection,
)


class SettingsPromptCatalog:
    """Session-bound adapter for configured prompt templates."""

    def __init__(self, session: Session | None) -> None:
        self._session = session

    def render(
        self,
        key: str,
        variables: dict[str, Any] | None = None,
    ) -> str:
        return render_prompt(key, variables, session=self._session)

    def compose(
        self,
        scene_key: str,
        variables: dict[str, Any] | None = None,
        selection: PromptRunSelection | None = None,
    ) -> CompiledPromptSnapshot:
        payload = compile_prompt(
            scene_key,
            variables,
            session=self._session,
            selection=(
                {
                    "block_keys": list(selection.block_keys) if selection.block_keys is not None else None,
                    "scene_instruction": selection.scene_instruction,
                    "run_instruction": selection.run_instruction,
                }
                if selection is not None
                else None
            ),
        )
        return CompiledPromptSnapshot(
            scene_key=payload["scene_key"],
            prompt_key=payload["prompt_key"],
            text=payload["text"],
            block_keys=tuple(payload["block_keys"]),
            block_versions=dict(payload["block_versions"]),
            scene_version_id=payload["scene_version_id"],
            scene_instruction=payload["scene_instruction"],
            run_instruction=payload["run_instruction"],
            warnings=tuple(payload["warnings"]),
            estimated_tokens=int(payload["estimated_tokens"]),
        )
