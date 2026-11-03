"""Independent favorite state for permanent-mark review units."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.platform.application import UnitOfWork

from .unit_review_projection import unit_payload


def set_unit_favorite(
    session: Session,
    unit_id: str,
    is_favorite: bool,
    *,
    uow: UnitOfWork,
    before_commit: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    row = session.get(ReviewUnitState, str(unit_id))
    if row is None or not row.active or row.permanently_removed:
        raise ValueError("active review unit not found")
    row.is_favorite = is_favorite
    session.flush()
    payload = unit_payload(row)
    if before_commit is not None:
        before_commit(payload)
    uow.commit()
    return payload


def list_unit_favorites(session: Session, unit_ids: Iterable[str]) -> dict[str, bool]:
    normalized = sorted({str(unit_id).strip() for unit_id in unit_ids if str(unit_id).strip()})
    if not normalized:
        return {}
    result: dict[str, bool] = {}
    for start in range(0, len(normalized), 400):
        rows = (
            session.query(ReviewUnitState.id, ReviewUnitState.is_favorite)
            .filter(
                ReviewUnitState.id.in_(normalized[start : start + 400]),
                ReviewUnitState.active.is_(True),
                ReviewUnitState.permanently_removed.is_(False),
            )
            .all()
        )
        result.update({str(unit_id): bool(is_favorite) for unit_id, is_favorite in rows})
    return result
