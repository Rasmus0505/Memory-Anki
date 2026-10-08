"""Build the freestyle toolbar 做题 overlay pool without changing training_mode.

This module is the **single owner** of "which palaces does 做题 cover".

The rule, stated by the product owner: *if the 随心 config selects 20 palaces but
this round actually scheduled 10, 做题 may only draw the 10.* The round's own
review set is therefore the whole scope. The saved config is **not** applied a
second time — an earlier version did that and produced the worst possible
outcome: the header counted the round's 8 palaces while the pool held 0
questions, because the config had since been narrowed. A palace the round
scheduled is in scope even when today's config would no longer pick it: the
learner arranged this round deliberately, and the questions belong to the round.

The frontend renders the ``scope_palaces`` report returned here instead of
deriving membership again. Any future scope rule change belongs here, not in a
UI model.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import resolve_palace_titles
from memory_anki.modules.memory.public.queries import list_unit_node_members
from memory_anki.modules.quiz.public.queries import (
    list_node_bindings_for_palaces,
    list_published_questions_for_palaces,
)

from ..domain.feed_config import sanitize_feed_config
from ..domain.overlay_quiz import (
    QUESTION_RATING_NONE,
    SCOPE_REASON_KINDS_FILTERED,
    SCOPE_REASON_NO_QUESTIONS,
    SCOPE_REASON_PALACE_REMOVED,
    build_scope_palaces,
    order_overlay_questions,
    overlay_question_kind,
    overlay_quiz_scope_signature,
    pick_question_node_rating,
)
from ..domain.queue_builder import QuizCandidate, sort_quiz_candidates


def _positive_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        result.append(number)
    return result


def _round_node_ratings(
    session: Session,
    *,
    unit_ids: list[str],
    round_ratings: dict[str, int],
) -> dict[str, int]:
    """``node_uid`` → this round's 1–4 rating, for the round's own units only.

    The chain is: ``node_uid`` → the round's review unit owning that node → this
    round's rating for that unit. Only units in ``unit_ids`` are considered, so a
    node owned by some other palace's unit cannot borrow a rating.
    """
    if not unit_ids:
        return {}
    members_by_unit = list_unit_node_members(session, list(unit_ids))
    # node_uid → unit_id, only for units this round actually scheduled.
    node_unit: dict[str, str] = {}
    for unit_id, members in members_by_unit.items():
        for node_uid in members:
            node_unit.setdefault(str(node_uid), unit_id)
    if not node_unit:
        return {}
    rating_by_node: dict[str, int] = {}
    for node_uid, unit_id in node_unit.items():
        rating = round_ratings.get(unit_id)
        if rating in {1, 2, 3, 4}:
            rating_by_node[node_uid] = int(rating)
    return rating_by_node


def _question_ratings_from_nodes(
    session: Session,
    *,
    palace_ids: list[int],
    rating_by_node: dict[str, int],
) -> dict[str, int]:
    """``question_id`` → weakest this-round rating among its bound knowledge points.

    Shared by both 做题 surfaces: the toolbar 做题 overlay and 关联题目. They read
    the same rule through here rather than each deriving a score, so 「本轮最低 N」
    cannot mean two different things depending on which window is open.

    Only rated questions appear. A question whose bound nodes are all unrated this
    round is absent, which the UI renders as 「本轮尚未复习」 — never as a zero.
    """
    if not palace_ids or not rating_by_node:
        return {}
    bindings = list_node_bindings_for_palaces(session, palace_ids=palace_ids)
    bound_by_question: dict[int, list[str]] = {}
    for row in bindings:
        qid = int(row.get("question_id") or 0)
        node_uid = str(row.get("node_uid") or "")
        if qid <= 0 or not node_uid:
            continue
        bound_by_question.setdefault(qid, []).append(node_uid)
    ratings: dict[str, int] = {}
    for qid, node_uids in bound_by_question.items():
        picked = pick_question_node_rating(node_uids, rating_by_node)
        if picked is not None and picked != QUESTION_RATING_NONE:
            ratings[str(qid)] = picked
    return ratings


def build_round_question_ratings(
    session: Session,
    *,
    palace_ids: list[int],
    unit_ids: list[str],
    round_ratings: dict[str, int],
) -> dict[str, int]:
    """``question_id`` → this round's weakest rating, for **every** bound question.

    The 做题 pool only holds questions passing the kind filter, but 关联题目 can
    open any question bound to a node of the round's palaces (measured: 235 across
    the round's palaces against a 165-question pool). Reading a rating off the pool
    would leave those questions blank, so this covers the whole round instead.
    """
    return _question_ratings_from_nodes(
        session,
        palace_ids=palace_ids,
        rating_by_node=_round_node_ratings(
            session, unit_ids=unit_ids, round_ratings=round_ratings
        ),
    )


def _resolve_question_node_ratings(
    session: Session,
    *,
    question_palace_ids: dict[str, int],
    unit_ids: list[str],
    round_ratings: dict[str, int],
) -> dict[str, int]:
    """Badge map narrowed to the overlay pool's own questions."""
    if not question_palace_ids:
        return {}
    palace_ids = sorted({int(item) for item in question_palace_ids.values() if int(item) > 0})
    ratings = build_round_question_ratings(
        session,
        palace_ids=palace_ids,
        unit_ids=unit_ids,
        round_ratings=round_ratings,
    )
    pool_ids = {str(int(raw)) for raw in question_palace_ids}
    return {qid: rating for qid, rating in ratings.items() if qid in pool_ids}


def build_overlay_question_pack(
    session: Session,
    config_raw: dict[str, Any] | None,
    *,
    palace_ids: list[int] | None = None,
    unit_ids: list[str] | None = None,
    round_ratings: dict[str, int] | None = None,
    removed_palace_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Questions for toolbar 做题, plus the authoritative scope report.

    ``palace_ids`` is the round's review set. The saved config supplies
    presentation choices (draw order, 客观/主观 kinds) but never narrows which
    palaces contribute.

    ``removed_palace_ids`` are palaces whose every card the learner took out of
    this round with 移除本队列. They leave the scope too: the learner explicitly
    removed them, so their questions must go with them. A palace with even one
    card still queued is unaffected.

    ``unit_ids`` are the round's review units, used to resolve each question's
    bound knowledge points to this round's rating. ``round_ratings`` maps
    ``unit_id`` → this round's 1–4 rating (lowest wins per unit); a unit absent
    from it simply has no rating this round.
    """
    config = sanitize_feed_config(config_raw or {})
    raw_streams = config.get("streams")
    streams: dict[str, Any] = raw_streams if isinstance(raw_streams, dict) else {}
    raw_quiz = streams.get("quiz")
    quiz_stream: dict[str, Any] = raw_quiz if isinstance(raw_quiz, dict) else {}
    scheduled_palace_ids = _positive_ids(palace_ids)
    removed_ids = {int(item) for item in (removed_palace_ids or []) if int(item) > 0}
    # Removed palaces drop out of the scope entirely, but the report still lists
    # them with the reason so the learner can see why their questions are gone.
    ordered_palace_ids = [
        palace_id for palace_id in scheduled_palace_ids if palace_id not in removed_ids
    ]
    # One catalog read over every scheduled palace, then split it: the pool only
    # draws from the palaces still in this round, while the report needs counts
    # for removed ones too ("移除队列 · 有 18 题" is the actionable number).
    available_questions = list_published_questions_for_palaces(
        session,
        palace_ids=scheduled_palace_ids or None,
        question_type="all",
    )
    allowed_palace_ids = set(ordered_palace_ids)
    questions = [
        question
        for question in available_questions
        if int(question.get("palace_id") or 0) in allowed_palace_ids
    ]
    quizzes: list[QuizCandidate] = []
    for question in questions:
        qid = int(question.get("id") or 0)
        palace_id = int(question.get("palace_id") or 0)
        if qid <= 0 or palace_id <= 0:
            continue
        quizzes.append(
            QuizCandidate(
                question_id=qid,
                palace_id=palace_id,
                bound_node_uids=(),
                mastery_score=0.0,
                mastery_label="",
                question=question,
            )
        )
    # Counts per scheduled palace (removed ones included), independent of the
    # 客观/主观 checkboxes: this is what the scope list reports per row.
    per_palace: dict[int, dict[str, int]] = {}
    for question in available_questions:
        palace_id = int(question.get("palace_id") or 0)
        if palace_id <= 0:
            continue
        kind = overlay_question_kind(str(question.get("question_type") or ""))
        counts = per_palace.setdefault(palace_id, {"objective": 0, "subjective": 0})
        counts[kind] = counts.get(kind, 0) + 1
    kind_counts = {"objective": 0, "subjective": 0}
    cards: list[dict[str, Any]] = []
    for palace_id in ordered_palace_ids:
        palace_quizzes = [item for item in quizzes if item.palace_id == palace_id]
        for item in sort_quiz_candidates(palace_quizzes, weak_priority=False):
            kind = overlay_question_kind(str(item.question.get("question_type") or ""))
            kind_counts[kind] = kind_counts.get(kind, 0) + 1
            cards.append(
                {"id": item.question_id, "palace_id": item.palace_id, "kind": kind}
            )
    selected_kinds = {
        str(kind)
        for kind in (config.get("overlay_question_kinds") or ("objective", "subjective"))
    }
    filtered = [card for card in cards if str(card.get("kind") or "") in selected_kinds]
    in_pool_palace_ids = sorted({int(card["palace_id"]) for card in filtered})
    quiz_scope = str(quiz_stream.get("quiz_scope") or config.get("quiz_scope") or "cross_palace_random")
    type_order = str(config.get("overlay_type_order") or "interleave")
    nesting = str(config.get("overlay_type_palace_nesting") or "palace_then_type")
    seed = int(config.get("seed") or 0)
    ordered = order_overlay_questions(
        filtered,
        ordered_palace_ids,
        quiz_scope=quiz_scope,
        type_order=type_order,
        nesting=nesting,
        seed=seed,
    )
    question_ids = [int(item["id"]) for item in ordered if int(item.get("id") or 0) > 0]
    question_palace_ids = {
        str(int(item["id"])): int(item["palace_id"])
        for item in ordered
        if int(item.get("id") or 0) > 0 and int(item.get("palace_id") or 0) > 0
    }
    question_node_ratings = _resolve_question_node_ratings(
        session,
        question_palace_ids=question_palace_ids,
        unit_ids=list(unit_ids or []),
        round_ratings=dict(round_ratings or {}),
    )
    scope_palaces = build_scope_palaces(
        # The report lists every palace this round scheduled, including removed
        # ones, so the learner can see why their questions are gone.
        scheduled_palace_ids=scheduled_palace_ids,
        counts_by_palace=per_palace,
        titles=resolve_palace_titles(session, scheduled_palace_ids),
        in_pool_palace_ids=in_pool_palace_ids,
        removed_palace_ids=sorted(removed_ids),
        no_questions_reason=SCOPE_REASON_NO_QUESTIONS,
        kinds_filtered_reason=SCOPE_REASON_KINDS_FILTERED,
        palace_removed_reason=SCOPE_REASON_PALACE_REMOVED,
    )
    return {
        "question_ids": question_ids,
        "quiz_scope": quiz_scope,
        "seed": seed,
        "scope_signature": overlay_quiz_scope_signature(
            ordered_palace_ids,
            quiz_scope,
            overlay_question_kinds=list(selected_kinds),
            overlay_type_order=type_order,
            overlay_type_palace_nesting=nesting,
        ),
        "limit_reached": False,
        "candidate_count": len(question_ids),
        "question_palace_ids": question_palace_ids,
        "kind_counts": kind_counts,
        "scope_palaces": scope_palaces,
        "question_node_ratings": question_node_ratings,
    }


__all__ = ["build_overlay_question_pack"]
