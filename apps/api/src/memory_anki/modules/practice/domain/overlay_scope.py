"""The 做题 scope report. Framework-free.

It answers one question for the dialog: *which scheduled palaces contribute
questions right now, and why not when they don't.* The pool owner
(``practice/application/overlay_quiz_service.py``) supplies the counts; this
module formats the report the UI renders verbatim.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

# Why a palace this round scheduled is not contributing questions to 做题.
SCOPE_REASON_NO_QUESTIONS = "no_questions"
# The palace has questions, but none on the round units / their root path.
SCOPE_REASON_UNIT_NO_QUESTIONS = "unit_no_questions"
SCOPE_REASON_KINDS_FILTERED = "kinds_filtered"
# The learner took every card of this palace out of the queue (移除本队列).
SCOPE_REASON_PALACE_REMOVED = "palace_removed"
# The learner deleted this palace from 做题 (its questions only). Review cards and
# ratings are untouched, so the round's scheduling does not change.
SCOPE_REASON_PALACE_SKIPPED = "palace_skipped"


def empty_scope_palaces() -> dict[str, Any]:
    return {"scheduled_count": 0, "in_pool_count": 0, "question_count": 0, "palaces": []}


def build_scope_palaces(
    *,
    scheduled_palace_ids: Sequence[int],
    counts_by_palace: Mapping[int, Mapping[str, int]],
    titles: Mapping[int, str],
    in_pool_palace_ids: Sequence[int] = (),
    removed_palace_ids: Sequence[int] = (),
    skipped_palace_ids: Sequence[int] = (),
    no_questions_reason: str = SCOPE_REASON_NO_QUESTIONS,
    unit_no_questions_reason: str = SCOPE_REASON_UNIT_NO_QUESTIONS,
    kinds_filtered_reason: str = SCOPE_REASON_KINDS_FILTERED,
    palace_removed_reason: str = SCOPE_REASON_PALACE_REMOVED,
    palace_skipped_reason: str = SCOPE_REASON_PALACE_SKIPPED,
    all_counts_by_palace: Mapping[int, Mapping[str, int]] | None = None,
    unit_scope_active: bool = False,
) -> dict[str, Any]:
    """Authoritative per-palace 做题 scope report for the UI to render.

    The dialog must show this instead of re-deriving membership from the round
    plan and the config: two derivations of one scope let the header claim
    "8 palaces" while the pool was empty, with nothing explaining why.

    ``scheduled_palace_ids`` is the round's review set. There is deliberately no
    "not in current config" reason: a palace this round scheduled stays in scope
    even when today's 随心 config would no longer pick it. But a palace whose
    cards were all 移除本队列 (``removed_palace_ids``) does leave — the learner
    explicitly took it out of this round.

    ``counts_by_palace`` is the active range's question count (palace-wide for
    整个宫殿, unit-path-scoped for 本轮复习单元). ``all_counts_by_palace`` keeps
    the palace total so a palace with plenty of questions but none on the
    round's units reads as 「本轮单元没有题目」 instead of 「还没有题目」.

    Reason priority is `palace_removed` → `no_questions` → `kinds_filtered`:
    the most actionable, learner-caused explanation wins, so a removed palace
    never reads as "no questions" when it actually has plenty.

    Reasons are stable codes; the frontend owns their Chinese copy.
    """
    live = {int(item) for item in in_pool_palace_ids}
    removed = {int(item) for item in removed_palace_ids}
    skipped = {int(item) for item in skipped_palace_ids}
    all_counts = all_counts_by_palace if all_counts_by_palace is not None else counts_by_palace
    rows: list[dict[str, Any]] = []
    # Only contributing palaces count toward "N 题可做". A blocked row's
    # questions are listed beside its reason, never advertised as playable.
    total = 0
    in_pool_count = 0
    for raw_palace_id in scheduled_palace_ids:
        palace_id = int(raw_palace_id)
        counts = counts_by_palace.get(palace_id) or {}
        objective = max(0, int(counts.get("objective") or 0))
        subjective = max(0, int(counts.get("subjective") or 0))
        question_count = objective + subjective
        palace_counts = all_counts.get(palace_id) or {}
        palace_total = max(0, int(palace_counts.get("objective") or 0)) + max(
            0, int(palace_counts.get("subjective") or 0)
        )
        if palace_id in removed:
            reason = palace_removed_reason
        elif palace_id in skipped:
            reason = palace_skipped_reason
        elif question_count <= 0:
            # A palace with questions somewhere, but none in this round's unit
            # scope, must not claim to have no questions at all.
            reason = unit_no_questions_reason if unit_scope_active and palace_total > 0 else no_questions_reason
        elif palace_id not in live:
            # In scope with questions, but every one is of an unselected kind.
            reason = kinds_filtered_reason
        else:
            reason = ""
        contributes = not reason
        if contributes:
            in_pool_count += 1
            total += question_count
        rows.append(
            {
                "palace_id": palace_id,
                "title": str(titles.get(palace_id) or "") or f"宫殿 {palace_id}",
                "question_count": question_count,
                "objective": objective,
                "subjective": subjective,
                "in_pool": contributes,
                "reason": reason,
            }
        )
    return {
        "scheduled_count": len(rows),
        "in_pool_count": in_pool_count,
        "question_count": total,
        "palaces": rows,
    }


__all__ = [
    "SCOPE_REASON_KINDS_FILTERED",
    "SCOPE_REASON_NO_QUESTIONS",
    "SCOPE_REASON_PALACE_REMOVED",
    "SCOPE_REASON_PALACE_SKIPPED",
    "SCOPE_REASON_UNIT_NO_QUESTIONS",
    "build_scope_palaces",
    "empty_scope_palaces",
]
