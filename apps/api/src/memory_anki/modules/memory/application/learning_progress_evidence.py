"""Read current, topology-matching review evidence in a bounded batch."""
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from .unit_review_projection import _definitions_for_palace


def read_learning_progress_evidence(session: Session) -> dict[int, dict[str, set[str]]]:
    with session.no_autoflush:
        palaces = session.query(Palace).filter(Palace.deleted_at.is_(None), Palace.archived.is_(False)).all()
        states = session.query(ReviewUnitState).filter(ReviewUnitState.active.is_(True)).all()
        rated = {
            (uid, revision)
            for uid, revision in session.query(
                ReviewUnitRatingOperation.unit_id, ReviewUnitRatingOperation.unit_revision
            ).filter(
                ReviewUnitRatingOperation.undone_at.is_(None),
                ReviewUnitRatingOperation.replaced_at.is_(None),
            ).distinct().all()
        }
    definitions: dict[tuple[int, str, str], Any] = {}
    for palace in palaces:
        _, units = _definitions_for_palace(palace)
        for unit in units:
            definitions[(palace.id, unit.anchor_uid, unit.unit_kind)] = unit
    result: dict[int, dict[str, set[str]]] = {}
    today = date.today()
    for state in states:
        definition = definitions.get((state.palace_id, state.anchor_uid, state.unit_kind))
        if definition is None or (
            definition.membership_hash != state.membership_hash
            or definition.content_hash != state.content_hash
        ):
            continue
        evidence = result.setdefault(state.palace_id, {"reviewed": set(), "due": set()})
        if (state.id, state.revision) in rated or state.has_passed:
            evidence["reviewed"].update(definition.node_uids)
        if state.due_date <= today:
            evidence["due"].update(definition.node_uids)
    return result
