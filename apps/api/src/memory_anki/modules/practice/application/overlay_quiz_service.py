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

from memory_anki.modules.content.public.queries import (
    list_node_parent_uids,
    list_palace_node_paths,
    resolve_palace_titles,
)
from memory_anki.modules.memory.public.queries import (
    list_unit_node_members,
    list_unit_scheduling_nodes,
)
from memory_anki.modules.quiz.public.queries import (
    list_node_bindings_for_palaces,
    list_published_questions_for_palaces,
)

from ..domain.feed_config import (
    OVERLAY_QUESTION_RANGE_WHOLE_PALACE,
    OVERLAY_RATING_INHERIT_BLANK,
    OVERLAY_RATING_INHERIT_LOWEST,
    sanitize_feed_config,
)
from ..domain.overlay_quiz import (
    QUESTION_RATING_NONE,
    order_overlay_questions,
    overlay_question_kind,
    overlay_quiz_scope_signature,
    pick_question_node_rating,
)
from ..domain.overlay_scope import (
    SCOPE_REASON_KINDS_FILTERED,
    SCOPE_REASON_NO_QUESTIONS,
    SCOPE_REASON_PALACE_REMOVED,
    SCOPE_REASON_PALACE_SKIPPED,
    SCOPE_REASON_UNIT_NO_QUESTIONS,
    build_scope_palaces,
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


def _round_node_units(
    session: Session,
    *,
    unit_ids: list[str],
) -> dict[str, str]:
    """``node_uid`` → the round's review unit that owns it.

    Only units in ``unit_ids`` are considered, so a node owned by some other
    palace's unit cannot borrow a rating or a "still waiting" mark.
    """
    if not unit_ids:
        return {}
    members_by_unit = list_unit_node_members(session, list(unit_ids))
    node_unit: dict[str, str] = {}
    for unit_id, members in members_by_unit.items():
        for node_uid in members:
            node_unit.setdefault(str(node_uid), unit_id)
    return node_unit


def _unit_scope_node_uids(
    session: Session,
    *,
    unit_ids: list[str],
    palace_ids: list[int],
) -> tuple[dict[int, set[str]], dict[int, str]]:
    """``palace_id`` → node uids a scheduled unit makes eligible, plus roots.

    A unit contributes its own member nodes **and every ancestor from the
    palace root down to its anchor**. The anchor is a permanent mark, often on a
    level-2 node; the knowledge points above it were still reviewed as context,
    so their questions belong to this round too. A sibling branch does not.

    No permanent mark means no units, but every scheduled palace still has a
    root; ``roots`` lets a question with no binding record fall back to it (the
    product rule: every question has a node, and the root is on every unit path).
    """
    scheduled = {int(item) for item in palace_ids if int(item) > 0}
    tree_by_palace = list_palace_node_paths(session, sorted(scheduled)) if scheduled else {}
    scope: dict[int, set[str]] = {}
    roots: dict[int, str] = {}
    for palace_id, tree in tree_by_palace.items():
        root_uid = str(tree.get("root_uid") or "")
        if root_uid:
            roots[palace_id] = root_uid
    if not unit_ids or not scheduled:
        return scope, roots
    units = list_unit_scheduling_nodes(session, list(unit_ids))
    for unit in units.values():
        palace_id = int(unit.get("palace_id") or 0)
        if palace_id not in scheduled:
            continue
        tree = tree_by_palace.get(palace_id) or {}
        parents = tree.get("parents")
        parent_by_uid = parents if isinstance(parents, dict) else {}
        root_uid = str(tree.get("root_uid") or "")
        anchor_uid = str(unit.get("anchor_uid") or "")
        nodes = scope.setdefault(palace_id, set())
        nodes.update(
            str(uid) for uid in (unit.get("node_uids") or []) if str(uid).strip()
        )
        if root_uid:
            nodes.add(root_uid)
        current = anchor_uid
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            nodes.add(current)
            current = str(parent_by_uid.get(current) or "")
        # A palace without a readable editor_doc still has the unit's own
        # parentless anchor as the only known root. This keeps unbound
        # questions attributable instead of silently dropping them.
        if palace_id not in roots and anchor_uid and not parent_by_uid.get(anchor_uid):
            roots[palace_id] = anchor_uid
    return scope, roots


def _question_in_unit_scope(
    question_palace_id: int,
    bound_node_uids: set[str],
    scope_node_uids: dict[int, set[str]],
    root_uids: dict[int, str],
) -> bool:
    """Is this question on a scheduled unit's root path (or in its region)?

    ``bound_node_uids`` must already be narrowed to edges in the question's own
    palace; a binding into another palace doesn't make the question part of
    this palace's review unit.
    """
    scope = scope_node_uids.get(question_palace_id)
    if not scope:
        return False
    if bound_node_uids:
        return bool(bound_node_uids & scope)
    root_uid = root_uids.get(question_palace_id)
    return bool(root_uid and root_uid in scope)


def _rating_inherit_mode(value: str | None) -> str:
    key = str(value or "").strip()
    if key == OVERLAY_RATING_INHERIT_BLANK:
        return OVERLAY_RATING_INHERIT_BLANK
    return OVERLAY_RATING_INHERIT_LOWEST


def _lowest_reviewed_ancestor_rating(
    node_uids: list[str],
    rating_by_node: dict[str, int],
    parents: dict[str, str],
) -> int | None:
    """Weakest 1–4 among ancestors whose own round unit was scored.

    Starts at the parent, so a sibling's score cannot leak in. Display only:
    it does not put the question on the ancestor's card.
    """
    found: list[int] = []
    for uid in node_uids:
        current = parents.get(str(uid))
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            rating = rating_by_node.get(current)
            if rating in {1, 2, 3, 4}:
                found.append(int(rating))
            current = parents.get(current)
    if not found:
        return None
    return min(found)


def classify_round_question_badges(
    session: Session,
    *,
    palace_ids: list[int],
    unit_ids: list[str],
    waiting_unit_ids: list[str] | None,
    round_ratings: dict[str, int],
    rating_inherit: str | None = None,
) -> tuple[dict[str, int], list[str]]:
    """``(ratings, pending_ids)`` for every question bound to these palaces.

    ``ratings`` is question id → weakest 1–4 among bound nodes this round rated.
    ``pending_ids`` are questions with no such score whose bound node belongs to
    a unit still unfinished on the progress bar.

    A question in neither list must not be labelled 「本轮尚未复习」. Its point
    was never in this round, or the bar already drew that card as done. Saying
    the round has not reviewed it contradicts the bar.

    When ``rating_inherit`` is ``lowest_reviewed`` (the default), a question
    with no own 1–4 and not pending takes the weakest 1–4 among reviewed
    ancestor nodes. ``blank`` leaves that case out of both lists. Own score
    and pending still win. This is a display fallback, not queue membership.
    """
    if not palace_ids:
        return {}, []
    node_unit = _round_node_units(session, unit_ids=unit_ids)
    rating_by_node: dict[str, int] = {}
    for node_uid, unit_id in node_unit.items():
        rating = round_ratings.get(unit_id)
        if rating in {1, 2, 3, 4}:
            rating_by_node[node_uid] = int(rating)
    waiting = {str(item) for item in (waiting_unit_ids or []) if str(item)}
    bindings = list_node_bindings_for_palaces(session, palace_ids=palace_ids)
    bound_by_question: dict[int, list[str]] = {}
    for row in bindings:
        qid = int(row.get("question_id") or 0)
        node_uid = str(row.get("node_uid") or "")
        if qid <= 0 or not node_uid:
            continue
        bound_by_question.setdefault(qid, []).append(node_uid)
    ratings: dict[str, int] = {}
    pending: list[str] = []
    inherit_later: list[tuple[str, list[str]]] = []
    inherit = _rating_inherit_mode(rating_inherit) == OVERLAY_RATING_INHERIT_LOWEST
    for qid, node_uids in bound_by_question.items():
        picked = pick_question_node_rating(node_uids, rating_by_node)
        if picked is not None and picked != QUESTION_RATING_NONE:
            ratings[str(qid)] = picked
            continue
        if any(node_unit.get(uid) in waiting for uid in node_uids):
            pending.append(str(qid))
            continue
        if inherit:
            inherit_later.append((str(qid), node_uids))
    if inherit_later:
        parents = list_node_parent_uids(session, palace_ids)
        for qkey, node_uids in inherit_later:
            inherited = _lowest_reviewed_ancestor_rating(node_uids, rating_by_node, parents)
            if inherited is not None:
                ratings[qkey] = inherited
    return ratings, pending


def build_round_question_ratings(
    session: Session,
    *,
    palace_ids: list[int],
    unit_ids: list[str],
    round_ratings: dict[str, int],
    rating_inherit: str | None = None,
) -> dict[str, int]:
    """``question_id`` → this round's weakest rating, for **every** bound question.

    Ratings only. 「本轮尚未复习」 is not "missing from this map": that sentence
    belongs to ``question_pending_ids``, which this wrapper deliberately omits.
    """
    ratings, _pending = classify_round_question_badges(
        session,
        palace_ids=palace_ids,
        unit_ids=unit_ids,
        waiting_unit_ids=[],
        round_ratings=round_ratings,
        rating_inherit=rating_inherit,
    )
    return ratings


def _resolve_question_badges(
    session: Session,
    *,
    question_palace_ids: dict[str, int],
    unit_ids: list[str],
    waiting_unit_ids: list[str] | None,
    round_ratings: dict[str, int],
    rating_inherit: str | None = None,
) -> tuple[dict[str, int], list[str]]:
    """Badge pair narrowed to the overlay pool's own questions."""
    if not question_palace_ids:
        return {}, []
    palace_ids = sorted({int(item) for item in question_palace_ids.values() if int(item) > 0})
    ratings, pending = classify_round_question_badges(
        session,
        palace_ids=palace_ids,
        unit_ids=unit_ids,
        waiting_unit_ids=waiting_unit_ids,
        round_ratings=round_ratings,
        rating_inherit=rating_inherit,
    )
    pool_ids = {str(int(raw)) for raw in question_palace_ids}
    return (
        {qid: rating for qid, rating in ratings.items() if qid in pool_ids},
        [qid for qid in pending if qid in pool_ids],
    )


def _resolve_question_node_ratings(
    session: Session,
    *,
    question_palace_ids: dict[str, int],
    unit_ids: list[str],
    round_ratings: dict[str, int],
) -> dict[str, int]:
    """Ratings map narrowed to the overlay pool. Pending ids are a separate field."""
    ratings, _pending = _resolve_question_badges(
        session,
        question_palace_ids=question_palace_ids,
        unit_ids=unit_ids,
        waiting_unit_ids=[],
        round_ratings=round_ratings,
    )
    return ratings


def build_overlay_question_pack(
    session: Session,
    config_raw: dict[str, Any] | None,
    *,
    palace_ids: list[int] | None = None,
    unit_ids: list[str] | None = None,
    waiting_unit_ids: list[str] | None = None,
    round_ratings: dict[str, int] | None = None,
    removed_palace_ids: list[int] | None = None,
    skipped_palace_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Questions for toolbar 做题, plus the authoritative scope report.

    ``palace_ids`` is the round's review set. The saved config supplies
    presentation choices (draw order, 客观/主观 kinds) but never narrows which
    palaces contribute.

    Two ranges:

    - ``round_units`` (default): only questions bound to the round's scheduled
      review units, plus every ancestor node from the palace root down to each
      unit's anchor. A unit is a permanent-mark region; the path above it was
      reviewed as context, so its questions are included, but a sibling branch
      is not. A question with no binding record is treated as bound to its
      palace root, whose questions every unit path includes.
    - ``whole_palace``: every non-deleted question of the round's palaces (the
      old behaviour), opt-in from the 出题范围 page.

    ``removed_palace_ids`` are palaces whose every card the learner took out of
    this round with 移除本队列. They leave the scope too: the learner explicitly
    removed them, so their questions must go with them. A palace with even one
    card still queued is unaffected.

    ``skipped_palace_ids`` are palaces the learner deleted from 做题 only. Their
    questions leave the pool; their review cards and ratings are untouched.

    ``unit_ids`` are the round's review units. They define the default range and
    resolve each question's bound knowledge points to this round's rating.
    ``waiting_unit_ids`` are the subset the progress bar has not finished yet;
    only those may be labelled 「本轮尚未复习」. ``round_ratings`` maps
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
    skipped_ids = {int(item) for item in (skipped_palace_ids or []) if int(item) > 0}
    # Removed and deleted palaces drop out of the scope entirely, but the report
    # still lists them with the reason so the learner can see why they are gone.
    ordered_palace_ids = [
        palace_id
        for palace_id in scheduled_palace_ids
        if palace_id not in removed_ids and palace_id not in skipped_ids
    ]
    range_mode = str(config.get("overlay_question_range") or "")
    unit_scope_active = range_mode != OVERLAY_QUESTION_RANGE_WHOLE_PALACE
    scope_node_uids: dict[int, set[str]] = {}
    root_uids: dict[int, str] = {}
    bindings_by_question: dict[int, set[tuple[int, str]]] = {}
    if unit_scope_active:
        scope_node_uids, root_uids = _unit_scope_node_uids(
            session,
            unit_ids=list(unit_ids or []),
            palace_ids=scheduled_palace_ids,
        )
        for row in list_node_bindings_for_palaces(
            session, palace_ids=scheduled_palace_ids
        ):
            qid = int(row.get("question_id") or 0)
            node_uid = str(row.get("node_uid") or "")
            binding_palace_id = int(row.get("palace_id") or 0)
            if qid <= 0 or not node_uid or binding_palace_id <= 0:
                continue
            bindings_by_question.setdefault(qid, set()).add((binding_palace_id, node_uid))

    def question_is_eligible(question: dict[str, Any]) -> bool:
        if not unit_scope_active:
            return True
        palace_id = int(question.get("palace_id") or 0)
        qid = int(question.get("id") or 0)
        own_bound_nodes = {
            node_uid
            for binding_palace_id, node_uid in bindings_by_question.get(qid, ())
            if binding_palace_id == palace_id
        }
        return _question_in_unit_scope(
            palace_id, own_bound_nodes, scope_node_uids, root_uids
        )

    # One catalog read over every scheduled palace, then split it: the pool only
    # draws from the palaces still in this round and questions eligible in the
    # active range; the report needs counts for removed ones too
    # ("移除队列 · 有 18 题" is the actionable number).
    available_questions = list_published_questions_for_palaces(
        session,
        palace_ids=scheduled_palace_ids,
        question_type="all",
    )
    eligibility_by_question = {
        int(question.get("id") or 0): question_is_eligible(question)
        for question in available_questions
        if int(question.get("id") or 0) > 0
    }
    allowed_palace_ids = set(ordered_palace_ids)
    questions = [
        question
        for question in available_questions
        if int(question.get("palace_id") or 0) in allowed_palace_ids
        and eligibility_by_question.get(int(question.get("id") or 0), False)
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
    # 客观/主观 checkboxes: this is what the scope list reports per row. The
    # active range narrows these counts; the palace total is kept separately so
    # the report can distinguish "no questions" from "none in this unit".
    per_palace: dict[int, dict[str, int]] = {}
    all_per_palace: dict[int, dict[str, int]] = {}
    for question in available_questions:
        palace_id = int(question.get("palace_id") or 0)
        qid = int(question.get("id") or 0)
        if palace_id <= 0:
            continue
        kind = overlay_question_kind(str(question.get("question_type") or ""))
        all_counts = all_per_palace.setdefault(palace_id, {"objective": 0, "subjective": 0})
        all_counts[kind] = all_counts.get(kind, 0) + 1
        if not eligibility_by_question.get(qid, False):
            continue
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
    question_node_ratings, question_pending_ids = _resolve_question_badges(
        session,
        question_palace_ids=question_palace_ids,
        unit_ids=list(unit_ids or []),
        waiting_unit_ids=list(waiting_unit_ids or []),
        round_ratings=dict(round_ratings or {}),
        rating_inherit=str(config.get("overlay_rating_inherit") or ""),
    )
    scope_palaces = build_scope_palaces(
        # The report lists every palace this round scheduled, including removed
        # ones, so the learner can see why their questions are gone.
        scheduled_palace_ids=scheduled_palace_ids,
        counts_by_palace=per_palace,
        titles=resolve_palace_titles(session, scheduled_palace_ids),
        in_pool_palace_ids=in_pool_palace_ids,
        removed_palace_ids=sorted(removed_ids),
        skipped_palace_ids=sorted(skipped_ids),
        no_questions_reason=SCOPE_REASON_NO_QUESTIONS,
        unit_no_questions_reason=SCOPE_REASON_UNIT_NO_QUESTIONS,
        kinds_filtered_reason=SCOPE_REASON_KINDS_FILTERED,
        palace_removed_reason=SCOPE_REASON_PALACE_REMOVED,
        palace_skipped_reason=SCOPE_REASON_PALACE_SKIPPED,
        all_counts_by_palace=all_per_palace,
        unit_scope_active=unit_scope_active,
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
        "question_pending_ids": question_pending_ids,
    }


__all__ = ["build_overlay_question_pack"]
