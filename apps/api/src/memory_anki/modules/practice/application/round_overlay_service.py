"""Round overlay-quiz writes. Questions are limited to this round's review palaces."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.memory.public.queries import list_round_unit_ratings
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
    classify_round_question_badges,
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
from memory_anki.modules.practice.domain.feed_config import (
    OVERLAY_RATING_INHERIT_LOWEST,
    sanitize_feed_config,
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
    waiting_review_unit_ids,
)


def _rating_inherit_mode(stored: dict[str, Any], incoming: dict[str, Any] | None) -> str:
    """Display choice for a question with no own 1–4.

    A caller that omits the field keeps a choice already stored on the round.
    Missing on both sides is the default: follow the lowest reviewed ancestor.
    """
    source = incoming if isinstance(incoming, dict) else stored
    if (
        isinstance(incoming, dict)
        and "overlay_rating_inherit" not in incoming
        and "overlay_rating_inherit" in stored
    ):
        source = {**incoming, "overlay_rating_inherit": stored["overlay_rating_inherit"]}
    mode = sanitize_feed_config(source).get("overlay_rating_inherit")
    return str(mode or OVERLAY_RATING_INHERIT_LOWEST)


def read_round_question_badge(
    session: Session,
    *,
    round_id: str,
) -> tuple[dict[str, int], list[str]]:
    """``(ratings, pending_ids)`` for every question bound to this round.

    Read-only and never writes the round: opening a question window must not bump
    the round version (that would 409 the study loop behind it). ``pending_ids``
    are the only questions that may be labelled 「本轮尚未复习」 — a bound node
    still unfinished on the progress bar, and no 1–4 this round. An unknown round
    returns empty: there is nothing to claim.
    """
    row = session.get(FreestyleRoundState, str(round_id or "").strip())
    if row is None:
        return {}, []
    plan = _plan_of(row)
    stored = _json_load_object(row.config_json)
    return classify_round_question_badges(
        session,
        palace_ids=review_palace_ids(plan),
        unit_ids=review_unit_ids(plan),
        waiting_unit_ids=waiting_review_unit_ids(plan),
        round_ratings=list_round_unit_ratings(session, row.round_id),
        rating_inherit=_rating_inherit_mode(stored, None),
    )


def read_round_question_ratings(
    session: Session,
    *,
    round_id: str,
) -> dict[str, int]:
    """``question_id`` → this round's weakest rating. Ratings only.

    Read-only wrapper. 「本轮尚未复习」 is ``question_pending_ids`` from
    ``read_round_question_badge``, not "missing from this map".
    """
    ratings, _pending = read_round_question_badge(session, round_id=round_id)
    return ratings


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
    stored_config = _json_load_object(row.config_json)
    incoming = config if isinstance(config, dict) else stored_config
    mode = _rating_inherit_mode(stored_config, config if isinstance(config, dict) else None)
    # Stamp the choice onto the pack config without replacing the round's other
    # saved fields. A blank choice must be stored, or the read path would fall
    # back to the default and the two windows would disagree.
    pack = build_overlay_question_pack(
        session,
        {**incoming, "overlay_rating_inherit": mode},
        # The round's own review set IS the 做题 scope: the saved config must not
        # narrow it a second time (see overlay_quiz_service docstring).
        palace_ids=review_palace_ids(plan),
        # ...minus palaces whose every card the learner took out with 移除本队列.
        # Their questions leave with them. A palace with one card still queued
        # is unaffected.
        removed_palace_ids=sorted(removed_review_palace_ids(plan)),
        unit_ids=review_unit_ids(plan),
        waiting_unit_ids=waiting_review_unit_ids(plan),
        # From the encounter table, not the plan's cached copy: the cache omits
        # most `rating` values (see list_round_unit_ratings).
        round_ratings=list_round_unit_ratings(session, round_id),
    )
    plan["overlay_quiz"] = merge_overlay_quiz(plan.get("overlay_quiz"), **pack)
    op_id = _require_operation_id(operation_id)
    stored_mode = stored_config.get("overlay_rating_inherit")
    config_update = None
    # Missing means the default. Do not write that default onto an old round:
    # a version bump here would race the study loop for no visible change.
    # An explicit blank must be stored, or the read path falls back to the default.
    if stored_mode != mode and not (
        stored_mode is None and mode == OVERLAY_RATING_INHERIT_LOWEST
    ):
        config_update = {**stored_config, "overlay_rating_inherit": mode}
    changed = _apply_plan(row, plan, operation_id=op_id, config=config_update)
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
