from __future__ import annotations


class PalaceQuizAiError(RuntimeError):
    """Raised when an AI call fails (protocol/HTTP/network/parse)."""


__all__ = ["PalaceQuizAiError"]
