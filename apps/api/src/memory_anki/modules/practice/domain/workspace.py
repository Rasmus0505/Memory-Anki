"""Freestyle immersive workspace ids. Framework-free."""

from __future__ import annotations

import re
from typing import Any

WORKSPACE_PRIMARY = "primary"
WORKSPACE_SECONDARY = "secondary"
WORKSPACES = frozenset({WORKSPACE_PRIMARY, WORKSPACE_SECONDARY})
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


def peer_workspace(workspace: Any) -> str:
    """Peer immersive slot. Palace review has no peer and must not touch 随心."""
    text = str(workspace or "").strip()
    if is_palace_review_workspace(text):
        return ""
    normalized = normalize_workspace(text)
    if is_palace_review_workspace(normalized):
        return ""
    return WORKSPACE_SECONDARY if normalized == WORKSPACE_PRIMARY else WORKSPACE_PRIMARY
