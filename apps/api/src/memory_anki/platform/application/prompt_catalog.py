from __future__ import annotations

from typing import Any, Protocol


class PromptCatalog(Protocol):
    """Render configured prompts without exposing settings storage or templates."""

    def render(
        self,
        key: str,
        variables: dict[str, Any] | None = None,
    ) -> str: ...
