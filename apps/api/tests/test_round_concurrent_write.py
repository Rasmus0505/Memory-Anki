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
