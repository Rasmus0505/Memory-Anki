"""Freestyle immersive workspace ids. Framework-free."""

from __future__ import annotations

import re
from typing import Any

WORKSPACE_PRIMARY = "primary"
# 随心 is the single immersive workspace. Stored "secondary" rows were merged into it
# by migration 0072; any leftover value normalizes to primary.
WORKSPACES = frozenset({WORKSPACE_PRIMARY})
# `p` + palace id. Column is String(20); 19 digits covers every practical id.
PALACE_REVIEW_WORKSPACE_RE = re.compile(r"^p[1-9]\d{0,18}$")


def is_palace_review_workspace(value: Any) -> bool:
    return bool(PALACE_REVIEW_WORKSPACE_RE.fullmatch(str(value or "").strip()))


def palace_review_workspace(palace_id: int) -> str:
    text = f"p{int(palace_id)}"
    if not is_palace_review_workspace(text):
        raise ValueError("palace review workspace id is invalid")
    return text


def normalize_workspace(value: Any) -> str:
    text = str(value or "").strip()
    if text in WORKSPACES or is_palace_review_workspace(text):
        return text
    return WORKSPACE_PRIMARY

