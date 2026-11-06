"""新学 / 复习 narrows the round to units by whether they have ever passed."""

from __future__ import annotations

import json

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.practice.application.queue_service import build_freestyle_queue
from memory_anki.modules.practice.domain.feed_config import (
    queue_construction_signature,
    sanitize_feed_config,
)


def _seed_palace(session):
    editor = json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "宫殿", "permanentSplitMark": True},
                "children": [
                    {"data": {"uid": "never-node", "text": "新学"}, "children": []},
                    {"data": {"uid": "passed-node", "text": "复习"}, "children": []},
                ],
            }
        },
        ensure_ascii=False,
    )
    palace = Palace(title="新学与复习", editor_doc=editor, archived=False)
    session.add(palace)
    session.flush()
    for unit_id, anchor, passed in (
        ("unit-never", "never-node", False),
        ("unit-passed", "passed-node", True),
    ):
        session.add(
            ReviewUnitState(
                id=unit_id,
                palace_id=palace.id,
                anchor_uid=anchor,
                unit_kind="mark",
                node_uids_json=json.dumps([anchor]),
                membership_hash="h",
                content_hash="c",
                revision=1,
                stage_index=1,
                has_passed=passed,
                due_date=local_day(),
            )
        )
    session.commit()
    return palace


def _queue_unit_ids(session, learn_scope) -> set[str]:
    result = build_freestyle_queue(
        session,
        config_raw={"training_mode": "memory_palace", "learn_scope": learn_scope},
        operation_id=f"op-{'/'.join(learn_scope)}",
    )
    return {
        str(card.get("unit_id") or "")
        for card in result["cards"]
        if card.get("unit_id")
    }


def test_learn_scope_splits_units_by_ever_passed(db_session) -> None:
    _seed_palace(db_session)

    assert _queue_unit_ids(db_session, ["new", "review"]) == {
        "unit-never",
        "unit-passed",
    }
    # 新学 = a unit that has never passed, even when it is due today.
    assert _queue_unit_ids(db_session, ["new"]) == {"unit-never"}
    # 复习 = every unit that has passed before, even when it is due again now.
    assert _queue_unit_ids(db_session, ["review"]) == {"unit-passed"}


def test_learn_scope_defaults_to_the_full_pool_and_signs_the_queue() -> None:
    assert sanitize_feed_config({})["learn_scope"] == ["new", "review"]
    # Unknown or empty values cannot hide the whole day's work.
    assert sanitize_feed_config({"learn_scope": []})["learn_scope"] == ["new", "review"]
    assert sanitize_feed_config({"learn_scope": ["bogus"]})["learn_scope"] == [
        "new",
        "review",
    ]
    # 新学 / 复习 is a different card set, so it must rebuild the queue.
    assert queue_construction_signature({"learn_scope": ["new"]}) != (
        queue_construction_signature({"learn_scope": ["review"]})
    )
