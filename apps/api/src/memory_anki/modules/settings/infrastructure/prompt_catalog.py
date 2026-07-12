from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_prompts import render_prompt


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
