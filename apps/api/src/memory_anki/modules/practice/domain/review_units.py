"""Practice-side projection of review units owned by Reviews."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from memory_anki.modules.mindmap_document.api import ancestor_path


@dataclass(frozen=True)
class ReviewUnitCandidate:
    palace_id: int
    anchor_uid: str
    context_path: tuple[dict[str, str], ...]
    node_uids: tuple[str, ...]
    unit_id: str
    revision: int

    @property
    def node_count(self) -> int:
        return len(self.node_uids)


def candidate_from_projection(
    *,
    palace_id: int,
    nodes: Mapping[str, Mapping[str, Any]],
    projection: Mapping[str, Any],
) -> ReviewUnitCandidate:
    anchor_uid = str(projection["anchor_uid"])
    return ReviewUnitCandidate(
        palace_id=palace_id,
        anchor_uid=anchor_uid,
        context_path=tuple(ancestor_path(nodes, anchor_uid)),
        node_uids=tuple(str(uid) for uid in projection.get("node_uids") or []),
        unit_id=str(projection["id"]),
        revision=int(projection["revision"]),
    )


__all__ = ["ReviewUnitCandidate", "candidate_from_projection"]
