from __future__ import annotations


class EnglishLookupError(RuntimeError):
    """User-facing lookup error (invalid query, etc.)."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code
