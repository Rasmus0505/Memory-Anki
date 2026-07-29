from __future__ import annotations

import importlib.util
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewSessionUnit,
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)


def _load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/0053_add_initial_review_stage.py"
    spec = importlib.util.spec_from_file_location("migration_0053", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _state(palace_id: int, unit_id: str, *, stage: int, passed: bool, due: date):
    return ReviewUnitState(
        id=unit_id,
        palace_id=palace_id,
        anchor_uid=unit_id,
        unit_kind="mark",
        node_uids_json="[]",
        membership_hash=f"membership-{unit_id}",
        content_hash=f"content-{unit_id}",
        revision=1,
        stage_index=stage,
        has_passed=passed,
        due_date=due,
        active=True,
    )


def test_initial_stage_migration_preserves_mature_due_and_repairs_first_remembered_today(
    db_session,
    monkeypatch,
):
    today = datetime.now().astimezone().date()
    palace = Palace(title="迁移测试宫殿", archived=False, editor_doc="{}")
    db_session.add(palace)
    db_session.flush()

    unseen = _state(palace.id, "unit-unseen", stage=0, passed=False, due=today)
    first = _state(
        palace.id,
        "unit-first",
        stage=1,
        passed=True,
        due=today + timedelta(days=3),
    )
    mature_due = today + timedelta(days=30)
    mature = _state(palace.id, "unit-mature", stage=4, passed=True, due=mature_due)
    db_session.add_all((unseen, first, mature))

    study = StudySession(
        id="study-first",
        status="active",
        scene="freestyle_unit_review",
        target_type="palace",
        target_id=palace.id,
        palace_id=palace.id,
        title=palace.title,
        started_at=datetime.now(UTC).replace(tzinfo=None),
        summary_json="{}",
    )
    db_session.add(study)
    db_session.add(
        ReviewSessionUnit(
            study_session_id=study.id,
            unit_id=first.id,
            unit_revision=1,
            node_uids_json="[]",
            order_index=0,
            status="passed",
        )
    )
    baseline = {
        "state": {
            "stage_index": 0,
            "has_passed": False,
            "due_date": today.isoformat(),
            "last_passed_at": None,
        },
        "item": {"status": "pending"},
    }
    encounter = ReviewUnitEncounter(
        id="encounter-first",
        study_session_id=study.id,
        unit_id=first.id,
        unit_revision=1,
        round_id="round-first",
        sequence=0,
        baseline_state_json=json.dumps(baseline),
        effective_operation_id="operation-first",
        selected_rating=3,
        passed=True,
        retry_after_cards=0,
        status="closed",
        close_operation_id="close-first",
        closed_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session.add(encounter)
    db_session.add(
        ReviewUnitRatingOperation(
            id="operation-first",
            encounter_id=encounter.id,
            study_session_id=study.id,
            unit_id=first.id,
            palace_id=palace.id,
            unit_revision=1,
            rating=3,
            passed=True,
            retry_after_cards=0,
            before_state_json=json.dumps(baseline),
            after_state_json=json.dumps(
                {
                    "unit": {
                        "stage_index": 1,
                        "interval_days": 3,
                        "has_passed": True,
                    }
                }
            ),
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
    )
    db_session.flush()

    migration = _load_migration()
    monkeypatch.setattr(migration.op, "get_bind", db_session.connection)
    migration.upgrade()
    db_session.flush()
    db_session.expire_all()

    assert db_session.get(ReviewUnitState, unseen.id).stage_index == 0
    migrated_first = db_session.get(ReviewUnitState, first.id)
    assert migrated_first.stage_index == 1
    assert migrated_first.due_date == today + timedelta(days=1)
    assert migrated_first.revision == 2
    migrated_mature = db_session.get(ReviewUnitState, mature.id)
    assert migrated_mature.stage_index == 5
    assert migrated_mature.due_date == mature_due
    assert migrated_mature.revision == 1

    migrated_encounter = db_session.get(ReviewUnitEncounter, encounter.id)
    migrated_baseline = json.loads(migrated_encounter.baseline_state_json)
    assert migrated_baseline["state"]["stage_index"] == 0
    migrated_operation = db_session.get(ReviewUnitRatingOperation, "operation-first")
    migrated_after = json.loads(migrated_operation.after_state_json)
    assert migrated_after["unit"]["stage_index"] == 2
    assert migrated_after["unit"]["interval_days"] == 3
