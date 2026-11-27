"""Backfill missing empty root outlines without reconciling live child units."""
from __future__ import annotations

import uuid

from alembic import op
from sqlalchemy.orm import Session

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.application.unit_review_projection import resolve_unit_definitions

revision = "0087_marked_root_outline"
down_revision = "0086_remove_bedtime_review"
branch_labels = None
depends_on = None


def backfill(session: Session) -> int:
    # Never reconcile a partially populated palace: its child schedules and
    # active encounters must survive the upgrade byte-for-byte.
    added = 0
    candidates = (session.query(Palace.id).join(ReviewUnitState)
                  .filter(Palace.deleted_at.is_(None), Palace.archived.is_(False),
                          ReviewUnitState.unit_kind == "mark", ReviewUnitState.active.is_(True))
                  .distinct().all())
    for (palace_id,) in candidates:
        _, definitions = resolve_unit_definitions(session, palace_id)
        for definition in definitions:
            if definition.unit_kind != "palace" or definition.node_uids:
                continue
            if session.query(ReviewUnitState.id).filter_by(palace_id=palace_id,
                    anchor_uid=definition.anchor_uid, unit_kind="palace").first():
                continue
            session.add(ReviewUnitState(id=uuid.uuid4().hex, palace_id=palace_id,
                anchor_uid=definition.anchor_uid, unit_kind="palace", node_uids_json="[]",
                membership_hash=definition.membership_hash, content_hash=definition.content_hash,
                topology_order=0, revision=1, stage_index=0, has_passed=False,
                due_date=local_day(), active=True))
            added += 1
    session.flush()
    return added


def upgrade() -> None:
    with Session(bind=op.get_bind()) as session:
        backfill(session)
        session.commit()


def downgrade() -> None:
    # A root may already have earned its own history; never delete it on rollback.
    pass
