"""Facade for quiz generation message helpers."""

from __future__ import annotations

from .quiz_generation_prompt_messages import (
    build_generation_messages as build_generation_messages,
)

__all__ = [
    "build_generation_messages",
]
