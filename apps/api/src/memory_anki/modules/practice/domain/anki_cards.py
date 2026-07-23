"""Resolve Anki front/back cards from palace tree node projections."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _role(node: Mapping[str, Any] | None) -> str | None:
    if not node:
        return None
    role = node.get("anki_role")
    if role in {"front", "back", "none"}:
        return str(role)
    return None


def resolve_effective_role(
    uid: str,
    nodes: Mapping[str, Mapping[str, Any]],
    memo: dict[str, str],
) -> str:
    if uid in memo:
        return memo[uid]
    node = nodes.get(uid)
    if not node:
        memo[uid] = "none"
        return "none"
    explicit = _role(node)
    if explicit is not None:
        memo[uid] = explicit
        return explicit
    parent_uid = node.get("parent_uid")
    if parent_uid and parent_uid in nodes:
        parent_role = resolve_effective_role(str(parent_uid), nodes, memo)
        children = list(nodes[str(parent_uid)].get("children") or [])
        if parent_role == "front" and uid in children:
            memo[uid] = "back"
            return "back"
    memo[uid] = "none"
    return "none"


def collect_anki_cards(nodes: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return [{front_uid, back_uids}] for every effective front in the tree."""
    memo: dict[str, str] = {}
    fronts = [
        uid
        for uid in nodes
        if resolve_effective_role(uid, nodes, memo) == "front"
    ]
    cards: list[dict[str, Any]] = []
    for front_uid in fronts:
        front = nodes.get(front_uid) or {}
        child_backs = [
            child
            for child in list(front.get("children") or [])
            if resolve_effective_role(str(child), nodes, memo) == "back"
        ]
        extra_backs: list[str] = []
        for uid, node in nodes.items():
            if uid == front_uid or uid in child_backs:
                continue
            if resolve_effective_role(uid, nodes, memo) != "back":
                continue
            linked = str(node.get("anki_front_uid") or "").strip()
            if linked == front_uid:
                extra_backs.append(uid)
        cards.append(
            {
                "front_uid": front_uid,
                "back_uids": child_backs + extra_backs,
                "text": str(front.get("text") or ""),
            }
        )
    return cards


def unit_has_anki_front(
    unit_ratable_uids: list[str] | tuple[str, ...],
    nodes: Mapping[str, Mapping[str, Any]],
) -> bool:
    memo: dict[str, str] = {}
    for uid in unit_ratable_uids:
        if resolve_effective_role(str(uid), nodes, memo) == "front":
            return True
    return False


__all__ = [
    "collect_anki_cards",
    "resolve_effective_role",
    "unit_has_anki_front",
]
