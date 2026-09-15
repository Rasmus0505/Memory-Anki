"""Freestyle immersive workspace ids. Framework-free."""

from __future__ import annotations

from typing import Any

WORKSPACE_PRIMARY = "primary"
WORKSPACE_SECONDARY = "secondary"
WORKSPACES = frozenset({WORKSPACE_PRIMARY, WORKSPACE_SECONDARY})


def normalize_workspace(value: Any) -> str:
    text = str(value or "").strip()
    return text if text in WORKSPACES else WORKSPACE_PRIMARY


def peer_workspace(workspace: Any) -> str:
    normalized = normalize_workspace(workspace)
    return WORKSPACE_SECONDARY if normalized == WORKSPACE_PRIMARY else WORKSPACE_PRIMARY
