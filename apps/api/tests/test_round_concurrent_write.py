"""A lost-update race on ``freestyle_round_states`` must not become a 500.

Root cause
----------
``FreestyleRoundState`` is mapped with SQLAlchemy's ``version_id_col`` **and**
the practice module runs its own optimistic concurrency on the same ``version``
column (``expected_version`` + ``operation_id``). Two mechanisms guard one
column, and they disagreed about what to do when they lose:

* the module's own check returns a payload with ``conflict: true``, which the
  frontend already retries (``useOverlayProgressPersistence``,
  ``useImmersiveQueue``);
* the ORM's check raised ``StaleDataError`` at flush time, which nothing caught,
  so the request died as HTTP 500.

The ORM raise also fires *after* the module's check passed, because a concurrent
writer can commit in between — so it is the common case on a busy round, not an
exotic one. The live-study heartbeat writes to this table every few seconds.

The fix keeps the ORM guard (it is the real protection against a stale session
clobbering a newer plan) and converts the loss into the retryable ``conflict``
payload at the single commit choke point.

See docs/incidents/0003-round-stale-data-500.md.
"""

import json

import pytest

from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.practice.application.round_state_payload import _payload
from memory_anki.modules.practice.application.round_state_service import (
    _commit_operation,
    apply_round_action,
    get_or_create_active_round,
)


def test_overlay_wrong_ledger_and_prioritization(db_session, monkeypatch):
    from memory_anki.modules.practice.application import round_overlay_service as service
    from memory_anki.modules.practice.domain.round_plan import plan_from_cards

    cards = [
        {"id": "current", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "done", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
        {"id": "other", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u3"},
        {"id": "target", "type": "mindmap_branch", "palace_id": 2, "unit_id": "u4"},
    ]
    plan = plan_from_cards(cards)
    plan["completed_ids"] = ["done"]
    plan["overlay_quiz"] = {"question_ids": [11], "question_palace_ids": {"11": 2}}
    row = FreestyleRoundState(round_id="wrong-test", scope_key="wrong-test", version=1,
                              plan_json=json.dumps(plan), config_json="{}", current_card_id="current")
    db_session.add(row)
    db_session.commit()
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-4"},
    ])
    monkeypatch.setattr(service, "list_unit_node_members", lambda session, unit_ids: {
        "u4": ["node-4"],
    })

    def progress(operation_id, version, states, prioritize=False):
        return service.progress_overlay_quiz(
            db_session, round_id="wrong-test", operation_id=operation_id,
            expected_version=version, states=states,
            auto_prioritize_wrong_palaces=prioritize,
        )

    wrong = {"11": {"resolved": True, "correct": False}}
    first = progress("wrong", 1, wrong)
    assert first["plan"]["wrong_unit_ids"] == ["u4"]
    assert first["plan"]["presented_ids"] == ["current", "done", "other", "target"]
    correct = progress("correct", first["version"], {"11": {"resolved": True, "correct": True}})
    assert correct["plan"]["wrong_unit_ids"] == ["u4"]
    cleared = progress("clear", correct["version"], {})
    assert cleared["plan"]["wrong_unit_ids"] == ["u4"]
    # No new mistake: turning the switch on alone must still hoist the palace
    # of this round's existing wrong unit.
    reordered = progress("wrong-again", cleared["version"], {}, True)
    assert reordered["plan"]["presented_ids"] == ["current", "done", "target", "other"]
    assert reordered["plan"]["current_card_id"] == "current"
    assert reordered["plan"]["completed_ids"] == ["done"]
    duplicate = progress("wrong-again", cleared["version"], {}, True)
    assert duplicate["duplicate"] is True
    stale = progress("stale", cleared["version"], {})
    assert stale["conflict"] is True
    db_session.expire_all()
    saved = json.loads(db_session.get(FreestyleRoundState, "wrong-test").plan_json)
    assert saved["wrong_unit_ids"] == ["u4"]
    assert saved["presented_ids"] == ["current", "done", "target", "other"]


def test_overlay_explicit_wrong_ids_survive_correct_state_and_filter_scope(
    db_session, make_client, monkeypatch
):
    from memory_anki.infrastructure.db.deps import session_dep
    from memory_anki.modules.practice.application import round_overlay_service as service
    from memory_anki.modules.practice.domain.round_plan import plan_from_cards
    from memory_anki.modules.practice.presentation import router

    plan = plan_from_cards([
        {"id": "current", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "other", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
        {"id": "target", "type": "mindmap_branch", "palace_id": 2, "unit_id": "u3"},
    ])
    plan["overlay_quiz"] = {"question_ids": [11], "question_palace_ids": {"11": 2}}
    db_session.add(FreestyleRoundState(
        round_id="explicit-wrong", scope_key="explicit-wrong", version=1,
        plan_json=json.dumps(plan), config_json="{}", current_card_id="current",
    ))
    db_session.commit()
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-3"},
        {"question_id": 999, "node_uid": "node-2"},
    ])
    monkeypatch.setattr(service, "list_unit_node_members", lambda session, unit_ids: {
        "u2": ["node-2"], "u3": ["node-3"],
    })
    router.session_dep = session_dep
    client = make_client(router)
    response = client.post("/api/v1/freestyle/rounds/explicit-wrong/overlay-quiz/progress", json={
        "operation_id": "explicit-wrong-op", "expected_version": 1,
        "states": {"11": {"resolved": True, "correct": True}},
        "wrong_question_ids": [11, 999], "auto_prioritize_wrong_palaces": True,
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["plan"]["wrong_unit_ids"] == ["u3"]
    assert result["plan"]["presented_ids"] == ["current", "target", "other"]
    assert result["plan"]["overlay_quiz"]["states"]["11"]["correct"] is True
    db_session.expire_all()
    saved = json.loads(db_session.get(FreestyleRoundState, "explicit-wrong").plan_json)
    assert saved["wrong_unit_ids"] == ["u3"]


def _config() -> dict:
    return {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "specific_palace_ids": [],
                "subject_ids": [],
                "subject_scope": "all",
            },
            "quiz": {"question_type": "all", "quiz_palace_scope": "cross_palace_random"},
        },
    }


def _card(card_id: str = "card-1") -> dict:
    return {
        "id": card_id,
        "type": "mindmap_branch",
        "palace_id": 7,
        "unit_id": "unit-1",
    }


def _seed_round(db_session) -> int:
    created = get_or_create_active_round(
        db_session,
        scope_key="race",
        config=_config(),
        cards=[_card()],
        operation_id="create-race",
        round_id="race-round",
    )
    db_session.commit()
    return int(created["version"])


def test_losing_a_version_race_reports_conflict_instead_of_raising(
    db_session, session_factory
):
    """The exact live failure: a racing commit must not surface as an error.

    Request A reads the row and stages a write; request B commits in between;
    A's flush finds the row already moved on. Before the fix this raised
    ``StaleDataError`` and became HTTP 500.
    """
    version = _seed_round(db_session)

    session_a = session_factory()
    session_b = session_factory()
    try:
        row_a = session_a.get(FreestyleRoundState, "race-round")
        assert row_a is not None
        assert int(row_a.version) == version

        # B moves the row forward and commits a distinguishable plan.
        progressed = apply_round_action(
            session_b,
            round_id="race-round",
            action="exclude",
            operation_id="op-b",
            expected_version=version,
            card_id="card-1",
        )
        assert int(progressed["version"]) > version
        winner_excluded = progressed["plan"]["excluded_ids"]

        # A writes from the snapshot it read. It must not raise, and must not
        # report success — it lost.
        row_a.plan_json = '{"touched": true}'
        row_a.version = version + 1
        assert _commit_operation(session_a, row_a, "op-a") is False
    finally:
        session_a.close()
        session_b.close()

    db_session.expire_all()
    fresh = db_session.get(FreestyleRoundState, "race-round")
    assert fresh is not None
    # The loser's write is discarded, never merged over the winner's plan.
    assert fresh.plan_json != '{"touched": true}'
    assert json.loads(fresh.plan_json)["excluded_ids"] == winner_excluded


def test_conflict_payload_carries_the_winners_version(db_session, session_factory):
    """After losing, the payload must report the real committed version.

    The client retries against ``plan_version``, so reporting the loser's own
    number would make it loop forever.
    """
    version = _seed_round(db_session)

    session_a = session_factory()
    session_b = session_factory()
    try:
        stale = session_a.get(FreestyleRoundState, "race-round")
        assert stale is not None
        progressed = apply_round_action(
            session_b,
            round_id="race-round",
            action="exclude",
            operation_id="op-b",
            expected_version=version,
            card_id="card-1",
        )
        stale.plan_json = '{"stale": true}'
        stale.version = version + 1
        assert _commit_operation(session_a, stale, "op-a") is False
        # This is what the router returns to the client.
        payload = _payload(stale, conflict=True)
    finally:
        session_a.close()
        session_b.close()

    assert payload["conflict"] is True
    assert int(payload["version"]) == int(progressed["version"])
    assert int(payload["plan_version"]) == int(progressed["version"])


@pytest.mark.parametrize("action", ["exclude", "complete"])
def test_action_write_reports_conflict_instead_of_raising(
    db_session, session_factory, action
):
    """Through the public action path, a stale version reports a conflict."""
    version = _seed_round(db_session)

    session_a = session_factory()
    session_b = session_factory()
    try:
        # A reads the row first, so its staged copy is stale from here on.
        assert session_a.get(FreestyleRoundState, "race-round") is not None
        apply_round_action(
            session_b,
            round_id="race-round",
            action="exclude",
            operation_id="op-b",
            expected_version=version,
            card_id="card-1",
        )
        result = apply_round_action(
            session_a,
            round_id="race-round",
            action=action,
            operation_id=f"op-a-{action}",
            expected_version=version,
            card_id="card-1",
        )
        assert result["conflict"] is True
    finally:
        session_a.close()
        session_b.close()


def test_every_round_write_path_commits_through_one_boundary():
    """Both round write modules must use the shared commit boundary.

    ``round_overlay_service`` is a *separate* write path from
    ``round_state_service``. The first fix only converted the latter, so the same
    ``StaleDataError`` still reached the learner through 做题 progress as
    「保存随心做题进度 ... HTTP 状态：500」. A direct ``session.commit()`` in
    either module re-opens that hole.
    """
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "src" / "memory_anki"
    practice = root / "modules" / "practice" / "application"
    for name in ("round_state_service.py", "round_overlay_service.py"):
        source = (practice / name).read_text(encoding="utf-8")
        assert "session.commit()" not in source, (
            f"{name} must commit through round_commit.commit_operation; a direct "
            "commit lets a lost version race escape as StaleDataError (HTTP 500)"
        )
        assert "_commit_operation" in source, (
            f"{name} must route its writes through the shared commit boundary"
        )
