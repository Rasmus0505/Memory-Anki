"""Round overlay-quiz writes. Questions are limited to this round's review palaces."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.memory.public.queries import list_round_unit_ratings
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
    build_round_question_ratings,
)
from memory_anki.modules.practice.application.round_state_service import (
    _apply_plan,
    _begin_round_write,
    _commit_operation,
    _json_load_object,
    _payload,
    _plan_of,
    _require_operation_id,
    _sync_peer_progress,
)
from memory_anki.modules.practice.domain.overlay_quiz import (
    apply_overlay_progress,
    drop_overlay_for_palaces,
    merge_overlay_quiz,
)
from memory_anki.modules.practice.domain.round_plan import (
    removed_review_palace_ids,
    review_palace_ids,
    review_unit_ids,
)


def read_round_question_ratings(
    session: Session,
    *,
    round_id: str,
) -> dict[str, int]:
    """``question_id`` → this round's weakest rating, for 关联题目's rating badge.

    Read-only and never writes the round: opening a question window must not bump
    the round version (that would 409 the study loop behind it). The rule itself
    lives in ``build_round_question_ratings``, shared with the 做题 pool, so both
    surfaces answer 「本轮最低 N」 identically.

    An unknown/absent round returns ``{}``: the caller then shows no score, which
    is the honest answer when there is no round to score against.
    """
    row = session.get(FreestyleRoundState, str(round_id or "").strip())
    if row is None:
        return {}
    plan = _plan_of(row)
    return build_round_question_ratings(
        session,
        palace_ids=review_palace_ids(plan),
        unit_ids=review_unit_ids(plan),
        round_ratings=list_round_unit_ratings(session, row.round_id),
    )


def ensure_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None:
        return early
    assert row is not None
    plan = _plan_of(row)
    pack = build_overlay_question_pack(
        session,
        config if isinstance(config, dict) else _json_load_object(row.config_json),
        # The round's own review set IS the 做题 scope: the saved config must not
        # narrow it a second time (see overlay_quiz_service docstring).
        palace_ids=review_palace_ids(plan),
        # ...minus palaces whose every card the learner took out with 移除本队列.
        # Their questions leave with them. A palace with one card still queued
        # is unaffected.
        removed_palace_ids=sorted(removed_review_palace_ids(plan)),
        unit_ids=review_unit_ids(plan),
        # From the encounter table, not the plan's cached copy: the cache omits
        # most `rating` values (see list_round_unit_ratings).
        round_ratings=list_round_unit_ratings(session, round_id),
    )
    plan["overlay_quiz"] = merge_overlay_quiz(plan.get("overlay_quiz"), **pack)
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _payload(row, conflict=True)
    return _payload(row)


def progress_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    current_index: int = 0,
    completed_ids: list[int] | None = None,
    states: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None:
        return early
    assert row is not None
    plan = _plan_of(row)
    plan["overlay_quiz"] = apply_overlay_progress(
        plan.get("overlay_quiz"),
        current_index=current_index,
        completed_ids=list(completed_ids or []),
        states=states if isinstance(states, dict) else {},
    )
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _payload(row, conflict=True)
    return _payload(row)


def drop_overlay_quiz_for_palaces(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    palace_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Settlement confirm path: drop overlay progress for the palaces the learner clears."""
    row, early = _begin_round_write(
        session,
        round_id=round_id,
        operation_id=operation_id,
        expected_version=expected_version,
    )
    if early is not None:
        return early
    assert row is not None
    plan = _plan_of(row)
    plan["overlay_quiz"] = drop_overlay_for_palaces(plan.get("overlay_quiz"), list(palace_ids or []))
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    _sync_peer_progress(session, row, op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _payload(row, conflict=True)
    return _payload(row)
