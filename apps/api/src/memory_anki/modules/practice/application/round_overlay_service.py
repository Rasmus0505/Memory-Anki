"""Round overlay-quiz writes. Questions follow this round's review units (or its palaces in the wide range)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.memory.public.queries import (
    list_round_unit_ratings,
    list_unit_node_members,
)
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
    classify_round_question_badges,
)
from memory_anki.modules.practice.application.round_read_lookups import latest_active_round
from memory_anki.modules.practice.application.round_state_service import (
    _apply_plan,
    _begin_round_write,
    _commit_operation,
    _json_load_object,
    _plan_of,
    _require_operation_id,
    _serve,
)
from memory_anki.modules.practice.domain.feed_config import (
    OVERLAY_RATING_INHERIT_LOWEST,
    sanitize_feed_config,
)
from memory_anki.modules.practice.domain.overlay_quiz import (
    apply_overlay_progress,
    current_wrong_overlay_question_ids,
    drop_overlay_for_palaces,
    merge_overlay_quiz,
    normalize_overlay_quiz,
    set_overlay_palaces_skipped,
)
from memory_anki.modules.practice.domain.overlay_quiz_shuffle import (
    shuffle_overlay_question_order,
)
from memory_anki.modules.practice.domain.round_plan import (
    _is_unfinished,
    _sync_index,
    removed_review_palace_ids,
    review_palace_ids,
    review_unit_ids,
    waiting_review_unit_ids,
)
from memory_anki.modules.quiz.public.queries import list_node_bindings_for_palaces


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


def read_active_overlay_wrong_questions(
    session: Session,
    *,
    workspace: str = "primary",
) -> dict[str, Any] | None:
    """Read the active round's current 做题 wrong-question snapshot."""
    row = latest_active_round(session, workspace)
    if row is None:
        return None
    plan = _plan_of(row)
    # The plan set is the durable answer (it survives a correct retry until
    # 小结算). Live overlay states are merged in so rounds written before the
    # plan field existed still show their current mistakes.
    wrong = {int(item) for item in plan.get("wrong_question_ids") or [] if str(item).isdigit()}
    wrong.update(current_wrong_overlay_question_ids(plan.get("overlay_quiz")))
    return {
        "workspace": str(getattr(row, "workspace", workspace) or workspace),
        "round_id": row.round_id,
        "plan_version": int(row.version or 0),
        "wrong_question_ids": sorted(wrong),
    }


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


def _overlay_pack(
    session: Session,
    *,
    round_id: str,
    plan: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Authoritative 做题 pack for this round, with the learner's deletions applied."""
    skipped = normalize_overlay_quiz(plan.get("overlay_quiz"))["skipped_palace_ids"]
    return build_overlay_question_pack(
        session,
        config,
        # The round's own review set is the outer 做题 boundary: the saved config
        # must not widen it. `unit_ids` narrows the default range to the scheduled
        # units and their root paths (see overlay_quiz_service docstring).
        palace_ids=review_palace_ids(plan),
        # ...minus palaces whose every card the learner took out with 移除本队列.
        # Their questions leave with them. A palace with one card still queued
        # is unaffected.
        removed_palace_ids=sorted(removed_review_palace_ids(plan)),
        # ...and palaces the learner deleted from 做题. Review cards are untouched.
        skipped_palace_ids=skipped,
        unit_ids=review_unit_ids(plan),
        waiting_unit_ids=waiting_review_unit_ids(plan),
        # From the encounter table, not the plan's cached copy: the cache omits
        # most `rating` values (see list_round_unit_ratings).
        round_ratings=list_round_unit_ratings(session, round_id),
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
    stored_config = _json_load_object(row.config_json)
    incoming = config if isinstance(config, dict) else stored_config
    mode = _rating_inherit_mode(stored_config, config if isinstance(config, dict) else None)
    # Stamp the choice onto the pack config without replacing the round's other
    # saved fields. A blank choice must be stored, or the read path would fall
    # back to the default and the two windows would disagree.
    pack = _overlay_pack(
        session,
        round_id=round_id,
        plan=plan,
        config={**incoming, "overlay_rating_inherit": mode},
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
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


def progress_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    current_index: int = 0,
    completed_ids: list[int] | None = None,
    states: dict[str, Any] | None = None,
    wrong_question_ids: list[int] | None = None,
    auto_prioritize_wrong_palaces: bool = False,
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
    previous = normalize_overlay_quiz(plan.get("overlay_quiz"))
    plan["overlay_quiz"] = apply_overlay_progress(
        plan.get("overlay_quiz"),
        current_index=current_index,
        completed_ids=list(completed_ids or []),
        states=states if isinstance(states, dict) else {},
    )
    overlay = plan["overlay_quiz"]
    # Persist the round's wrong questions. A later correct retry must not erase
    # this marker: it clears only at 小结算 (the settled units) or a new round,
    # which is the same lifetime the progress rail's 错题 marker has.
    answered_wrong = {
        str(qid)
        for source in (previous, overlay)
        for qid, state in {**source["parked"]["states"], **source["states"]}.items()
        if state.get("resolved") is True and state.get("correct") is False
    }
    known_wrong = set(plan["wrong_question_ids"])
    for qid in sorted(answered_wrong):
        if qid not in known_wrong:
            plan["wrong_question_ids"].append(qid)
            known_wrong.add(qid)
    wrong = {
        qid for qid, state in overlay["states"].items()
        if state.get("resolved") is True and state.get("correct") is False
        and not (
            previous["states"].get(qid, {}).get("resolved") is True
            and previous["states"].get(qid, {}).get("correct") is False
        )
    }
    allowed = set(overlay["question_ids"])
    wrong.update(str(qid) for qid in (wrong_question_ids or []) if qid in allowed)
    marked = set(plan["wrong_unit_ids"])
    if wrong:
        palace_ids = {
            overlay["question_palace_ids"][qid]
            for qid in wrong if qid in overlay["question_palace_ids"]
        }
        bindings = list_node_bindings_for_palaces(session, palace_ids=sorted(palace_ids)) if palace_ids else []
        nodes = {
            str(binding.get("node_uid") or "") for binding in bindings
            if str(binding.get("question_id") or "") in wrong
        }
        members = list_unit_node_members(session, review_unit_ids(plan)) if nodes else {}
        for unit_id, unit_nodes in members.items():
            if any(str(node) in nodes for node in unit_nodes) and unit_id not in marked:
                plan["wrong_unit_ids"].append(unit_id)
                marked.add(unit_id)
    # Turning the switch on must act on this round's existing wrong answers too,
    # not only the next new mistake.
    #
    # The unit is the boundary: a wrong question hoists the review units its
    # bound nodes belong to, and nothing else. Hoisting every unit of the
    # palace(s) those units live in pulled in knowledge points the learner never
    # got wrong, so a single mistake in one palace reordered that palace's whole
    # remaining queue.
    #
    # The wire field still says `wrong_palaces`; renaming it would 422 a cached
    # PWA build that keeps sending the old name.
    wrong_priority: dict[str, int] | None = None
    if auto_prioritize_wrong_palaces:
        target_units = {
            str(unit_id).strip() for unit_id in plan["wrong_unit_ids"] if str(unit_id).strip()
        }
        cards = {card["card_id"]: card for card in plan["original_cards"]}
        occurrences = {occ["occurrence_id"]: occ for occ in plan["occurrences"]}
        presented = plan["presented_ids"]
        current = plan.get("current_card_id")
        anchor = presented.index(current) if current in presented else -1
        slots = [
            i for i, card_id in enumerate(presented)
            if i > anchor and _is_unfinished(plan, card_id)
        ]
        movable = [presented[i] for i in slots]

        def source_card(card_id: str) -> dict[str, Any]:
            occurrence = occurrences.get(card_id)
            return cards.get(occurrence["source_card_id"] if occurrence else card_id, {})

        def is_target(card_id: str) -> bool:
            card = source_card(card_id)
            return (
                card.get("kind") == "mindmap_branch"
                and str(card.get("unit_id") or "") in target_units
            )

        hoisted = [card_id for card_id in movable if is_target(card_id)]
        ordered = hoisted + [card_id for card_id in movable if not is_target(card_id)]
        for index, card_id in zip(slots, ordered, strict=True):
            presented[index] = card_id
        _sync_index(plan)
        # What the learner actually sees move: still-unfinished units of the
        # wrong questions, counted per unit and per palace so the 做题 window can
        # say whether the switch did anything.
        hoisted_cards = [source_card(card_id) for card_id in hoisted]
        wrong_priority = {
            "unit_count": len({
                str(card.get("unit_id") or "") for card in hoisted_cards
            } - {""}),
            "palace_count": len({
                int(card["palace_id"]) for card in hoisted_cards if card.get("palace_id")
            }),
        }
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    payload = _serve(session, row)
    if payload is not None and wrong_priority is not None:
        payload["wrong_priority"] = wrong_priority
    return payload


def shuffle_overlay_quiz(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
) -> dict[str, Any]:
    """打乱题库: shuffle the unfinished questions, answered ones keep their slot.

    Writes only the overlay's order and ``current_index``; answered states,
    scope, exclusions and the round's scheduling are untouched. The order is
    stored on the round, so a reopened window keeps it until the next click.
    """
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
    plan["overlay_quiz"] = shuffle_overlay_question_order(plan.get("overlay_quiz"))
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


def set_overlay_skipped_palaces(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    palace_ids: list[int] | None = None,
    skipped: bool = True,
) -> dict[str, Any]:
    """Delete palaces from 做题 (``skipped=True``) or put them back (``False``).

    Only the 做题 pool is rebuilt. Review cards, ratings and the round's
    ``excluded_ids`` are not touched, so scheduling and scoring do not change.
    """
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
    plan["overlay_quiz"] = set_overlay_palaces_skipped(
        plan.get("overlay_quiz"),
        list(palace_ids or []),
        skipped=skipped,
    )
    stored_config = _json_load_object(row.config_json)
    pack = _overlay_pack(session, round_id=round_id, plan=plan, config=stored_config)
    plan["overlay_quiz"] = merge_overlay_quiz(plan.get("overlay_quiz"), **pack)
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)


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
    dropped = {int(item) for item in palace_ids or []}
    dropped_questions = {
        int(question_id)
        for question_id, palace_id in (normalize_overlay_quiz(plan.get("overlay_quiz")).get("question_palace_ids") or {}).items()
        if int(palace_id) in dropped
    }
    plan["overlay_quiz"] = drop_overlay_for_palaces(plan.get("overlay_quiz"), list(palace_ids or []))
    if dropped_questions:
        plan["wrong_question_ids"] = [
            item for item in plan["wrong_question_ids"]
            if not (str(item).isdigit() and int(item) in dropped_questions)
        ]
    op_id = _require_operation_id(operation_id)
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return _serve(session, row, conflict=True)
    return _serve(session, row)
