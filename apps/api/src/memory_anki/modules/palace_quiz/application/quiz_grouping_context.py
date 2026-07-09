"""Compatibility exports for mini-palace grouping context builders."""

from __future__ import annotations

from .grouping.classify import (
    build_mini_palace_context as build_mini_palace_context,
)
from .grouping.classify import (
    question_payload_for_grouping as question_payload_for_grouping,
)

__all__ = [
    "build_mini_palace_context",
    "question_payload_for_grouping",
]
