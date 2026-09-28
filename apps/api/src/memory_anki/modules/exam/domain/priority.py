"""Exam-priority ordering for freestyle palaces. Framework-free.

priority = star_weight(stars) * (0.35 + forgetting_degree) * share_factor
share_factor = 0.5 + subject_share_percent / 100 (even split when unset).
Higher priority is served first; ties fall back to palace id for stability.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from .stars import star_weight

FORGETTING_FLOOR = 0.35


def share_factor(share_percent: float | None, subject_count: int) -> float:
    if share_percent is None:
        share_percent = 100.0 / max(1, subject_count)
    return 0.5 + max(0.0, min(100.0, float(share_percent))) / 100.0


def palace_priority(stars: int, forgetting: float, share: float) -> float:
    return star_weight(stars) * (FORGETTING_FLOOR + max(0.0, min(1.0, forgetting))) * share


def order_by_priority(palace_ids: Sequence[int], scores: Mapping[int, float]) -> list[int]:
    return sorted(palace_ids, key=lambda pid: (-float(scores.get(pid, 0.0)), pid))
