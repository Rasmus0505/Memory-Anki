"""Deterministic freestyle queue assembly (pure functions)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .branch_units import (
    BranchUnit,
    order_units_within_palace,
    sort_units_by_node_policy,
    split_branch_units,
)
from .feed_config import (
    DUE_POLICY_ALL_WEIGHTED,
    DUE_POLICY_DUE_FIRST,
    DUE_POLICY_DUE_ONLY,
    PALACE_ORDER_INTERLEAVE,
    PALACE_ORDER_SEQUENTIAL,
    WITHIN_PALACE_SHUFFLE,
)


@dataclass(frozen=True)
class QuizCandidate:
    question_id: int
    palace_id: int
    bound_node_uids: tuple[str, ...]
    mastery_score: float
    mastery_label: str
    question: Mapping[str, Any]
    last_practiced_at: str | None = None

    @property
    def is_priority_mastery(self) -> bool:
        return self.mastery_label in {"weak", "reinforce", "unseen"}


@dataclass
class QueueBuildResult:
    cards: list[dict[str, Any]] = field(default_factory=list)
    phase_stats: dict[str, Any] = field(default_factory=dict)
    operation_id: str = ""


def _unit_due_count(unit: BranchUnit, due_uids: set[str]) -> int:
    return sum(1 for uid in unit.ratable_node_uids if uid in due_uids)


def _unit_has_due(unit: BranchUnit, due_uids: set[str]) -> bool:
    return _unit_due_count(unit, due_uids) > 0


def _stable_mix(*parts: Any) -> int:
    value = 2_166_136_261
    for part in parts:
        text = str(part)
        for char in text:
            value ^= ord(char)
            value = (value * 16_777_619) & 0xFFFFFFFF
    return value


def build_palace_units(
    *,
    palace_id: int,
    nodes: Mapping[str, Mapping[str, Any]],
    root_uid: str | None,
    node_limit: int,
    within_palace_order: str,
    seed: int,
) -> list[BranchUnit]:
    units = split_branch_units(
        palace_id=palace_id,
        nodes=nodes,
        root_uid=root_uid,
        node_limit=node_limit,
    )
    ordered = order_units_within_palace(
        units,
        nodes=nodes,
        root_uid=root_uid,
        shuffle=within_palace_order == WITHIN_PALACE_SHUFFLE,
        seed=seed,
    )
    return ordered


def order_palace_batches(
    palace_ids: Sequence[int],
    units_by_palace: Mapping[int, Sequence[BranchUnit]],
    *,
    palace_order: str,
    seed: int,
) -> list[BranchUnit]:
    """Sequential: finish each palace's units; interleave: deterministic round-robin."""
    active_ids = [pid for pid in palace_ids if units_by_palace.get(pid)]
    if not active_ids:
        return []
    if palace_order == PALACE_ORDER_SEQUENTIAL:
        result: list[BranchUnit] = []
        for palace_id in active_ids:
            result.extend(units_by_palace[palace_id])
        return result

    # Deterministic interleave by seed-ordered palace sequence then round-robin.
    ordered_ids = sorted(active_ids, key=lambda pid: (_stable_mix(seed, "palace", pid), pid))
    queues = {pid: list(units_by_palace[pid]) for pid in ordered_ids}
    result = []
    while any(queues.values()):
        for pid in ordered_ids:
            bucket = queues[pid]
            if bucket:
                result.append(bucket.pop(0))
    return result


def partition_units_by_due(
    units: Sequence[BranchUnit],
    due_by_palace: Mapping[int, set[str]],
) -> tuple[list[BranchUnit], list[BranchUnit]]:
    due_units: list[BranchUnit] = []
    later_units: list[BranchUnit] = []
    for unit in units:
        due_uids = due_by_palace.get(unit.palace_id, set())
        if _unit_has_due(unit, due_uids):
            due_units.append(unit)
        else:
            later_units.append(unit)
    return due_units, later_units


def sort_due_phase_units(
    units: Sequence[BranchUnit],
    due_by_palace: Mapping[int, set[str]],
) -> list[BranchUnit]:
    """Due phase still applies node-limit preference within the due set."""
    return sort_units_by_node_policy(units)


def sort_fill_phase_units(
    units: Sequence[BranchUnit],
    mastery_by_palace: Mapping[int, float],
    recent_practice_rank: Mapping[int, int],
) -> list[BranchUnit]:
    """Fill: node policy first, then lower mastery, then older practice."""
    policy = sort_units_by_node_policy(units)
    return sorted(
        policy,
        key=lambda unit: (
            0 if unit.over_limit_delta == 0 else 1,
            unit.node_count if unit.over_limit_delta == 0 else unit.over_limit_delta,
            mastery_by_palace.get(unit.palace_id, 0.5),
            recent_practice_rank.get(unit.palace_id, 10**9),
            unit.palace_id,
            unit.branch_uid,
        ),
    )


def attach_questions_to_units(
    units: Sequence[BranchUnit],
    quizzes: Sequence[QuizCandidate],
) -> tuple[dict[str, list[QuizCandidate]], list[QuizCandidate]]:
    """Bound questions follow a branch that contains the bound node; else palace pool."""
    unit_questions: dict[str, list[QuizCandidate]] = {unit_key(unit): [] for unit in units}
    palace_units: dict[int, list[BranchUnit]] = {}
    for unit in units:
        palace_units.setdefault(unit.palace_id, []).append(unit)

    unbound: list[QuizCandidate] = []
    for quiz in quizzes:
        if not quiz.bound_node_uids:
            unbound.append(quiz)
            continue
        matched = False
        for unit in palace_units.get(quiz.palace_id, []):
            ratable = set(unit.ratable_node_uids)
            if any(uid in ratable for uid in quiz.bound_node_uids):
                unit_questions[unit_key(unit)].append(quiz)
                matched = True
                break
        if not matched:
            unbound.append(quiz)
    return unit_questions, unbound


def unit_key(unit: BranchUnit) -> str:
    return f"mindmap_branch:{unit.palace_id}:{unit.branch_uid}"


def quiz_key(quiz: QuizCandidate) -> str:
    return f"quiz_question:{quiz.question_id}"


def sort_quiz_candidates(
    quizzes: Sequence[QuizCandidate],
    *,
    weak_priority: bool,
) -> list[QuizCandidate]:
    if weak_priority:
        return sorted(
            quizzes,
            key=lambda item: (
                0 if item.is_priority_mastery else 1,
                item.mastery_score,
                item.question_id,
            ),
        )
    return sorted(quizzes, key=lambda item: (item.mastery_score, item.question_id))


def interleave_by_weights(
    mindmap_cards: Sequence[dict[str, Any]],
    quiz_cards: Sequence[dict[str, Any]],
    *,
    mindmap_weight: int,
    quiz_weight: int,
    seed: int,
) -> list[dict[str, Any]]:
    """Deterministic weighted interleave; zero weight skips that stream."""
    m_weight = max(0, mindmap_weight)
    q_weight = max(0, quiz_weight)
    if m_weight == 0 and q_weight == 0:
        m_weight, q_weight = 2, 1
    m_queue = list(mindmap_cards)
    q_queue = list(quiz_cards)
    if m_weight == 0:
        return q_queue
    if q_weight == 0:
        return m_queue

    result: list[dict[str, Any]] = []
    m_credit = 0
    q_credit = 0
    # Slight seed bias on which stream starts when both available.
    prefer_mindmap_first = _stable_mix(seed, "stream") % 2 == 0
    while m_queue or q_queue:
        if not m_queue:
            result.extend(q_queue)
            break
        if not q_queue:
            result.extend(m_queue)
            break
        if m_credit <= 0 and q_credit <= 0:
            if prefer_mindmap_first:
                m_credit = m_weight
                q_credit = q_weight
            else:
                q_credit = q_weight
                m_credit = m_weight
        if m_credit > 0 and m_queue:
            result.append(m_queue.pop(0))
            m_credit -= 1
            continue
        if q_credit > 0 and q_queue:
            result.append(q_queue.pop(0))
            q_credit -= 1
            continue
        # Reset credits if stuck.
        m_credit = m_weight
        q_credit = q_weight
    return result


def mindmap_card_payload(
    unit: BranchUnit,
    *,
    palace_title: str,
    due_uids: set[str],
    phase: str,
) -> dict[str, Any]:
    due_in_unit = [uid for uid in unit.ratable_node_uids if uid in due_uids]
    return {
        "id": unit_key(unit),
        "type": "mindmap_branch",
        "content_type": "mindmap_branch",
        "palace_id": unit.palace_id,
        "palace_title": palace_title,
        "branch_uid": unit.branch_uid,
        "context_path": list(unit.context_path),
        "ratable_node_uids": list(unit.ratable_node_uids),
        "due_node_uids": due_in_unit,
        "node_count": unit.node_count,
        "over_limit_delta": unit.over_limit_delta,
        "due_node_count": len(due_in_unit),
        "selection_reason": unit.selection_reason,
        "phase": phase,
        "palace_context": {
            "id": unit.palace_id,
            "title": palace_title,
            "resolved_title": palace_title,
        },
    }


def quiz_card_payload(
    quiz: QuizCandidate,
    *,
    palace_title: str,
    phase: str,
) -> dict[str, Any]:
    return {
        "id": quiz_key(quiz),
        "type": "quiz_question",
        "content_type": "quiz_question",
        "question": dict(quiz.question),
        "palace_context": {
            "id": quiz.palace_id,
            "title": palace_title,
            "resolved_title": palace_title,
        },
        "group_key": f"palace:{quiz.palace_id}",
        "mastery_score": quiz.mastery_score,
        "mastery_label": quiz.mastery_label,
        "bound_node_uids": list(quiz.bound_node_uids),
        "phase": phase,
        "selection_reason": (
            f"mastery:{quiz.mastery_label}"
            if quiz.is_priority_mastery
            else "mastery_fill"
        ),
    }


def filter_completed(
    cards: Sequence[dict[str, Any]],
    *,
    completed_ids: set[str],
    hidden_ids: set[str],
) -> list[dict[str, Any]]:
    return [
        card
        for card in cards
        if str(card.get("id") or "") not in completed_ids
        and str(card.get("id") or "") not in hidden_ids
    ]


def assemble_queue(
    *,
    config: Mapping[str, Any],
    palace_meta: Mapping[int, Mapping[str, Any]],
    units_by_palace: Mapping[int, Sequence[BranchUnit]],
    due_by_palace: Mapping[int, set[str]],
    mastery_by_palace: Mapping[int, float],
    recent_practice_rank: Mapping[int, int],
    quizzes: Sequence[QuizCandidate],
    completed_ids: Iterable[str] = (),
    hidden_ids: Iterable[str] = (),
    operation_id: str = "",
) -> QueueBuildResult:
    completed = {str(item) for item in completed_ids if item}
    hidden = {str(item) for item in hidden_ids if item}
    seed = int(config.get("seed") or 17)
    due_policy = str(config.get("due_policy") or DUE_POLICY_DUE_FIRST)
    palace_order = str(config.get("palace_order") or PALACE_ORDER_SEQUENTIAL)
    queue_length = int(config.get("queue_length") or 20)
    mindmap_enabled = bool((config.get("content") or {}).get("mindmap_branch", True))
    quiz_enabled = bool((config.get("content") or {}).get("quiz_question", True))
    weights = config.get("weights") or {}
    mindmap_weight = int(weights.get("mindmap_branch", 2))
    quiz_weight = int(weights.get("quiz_question", 1))
    weak_priority = bool(config.get("weak_quiz_priority", True))

    palace_ids = list(palace_meta.keys())
    if palace_order == PALACE_ORDER_INTERLEAVE:
        palace_ids = sorted(
            palace_ids,
            key=lambda palace_id: (_stable_mix(seed, "palace", palace_id), palace_id),
        )

    due_units_by_palace: dict[int, list[BranchUnit]] = {}
    later_units_by_palace: dict[int, list[BranchUnit]] = {}
    for palace_id in palace_ids:
        due_units, later_units = partition_units_by_due(
            units_by_palace.get(palace_id, ()),
            due_by_palace,
        )
        due_units_by_palace[palace_id] = sort_due_phase_units(due_units, due_by_palace)
        later_units_by_palace[palace_id] = sort_fill_phase_units(
            later_units,
            mastery_by_palace,
            recent_practice_rank,
        )

    priority_quizzes_by_palace: dict[int, list[QuizCandidate]] = {}
    fill_quizzes_by_palace: dict[int, list[QuizCandidate]] = {}
    for palace_id in palace_ids:
        palace_quizzes = [quiz for quiz in quizzes if quiz.palace_id == palace_id]
        priority_quizzes_by_palace[palace_id] = sort_quiz_candidates(
            [quiz for quiz in palace_quizzes if quiz.is_priority_mastery],
            weak_priority=weak_priority,
        )
        fill_quizzes_by_palace[palace_id] = sort_quiz_candidates(
            [quiz for quiz in palace_quizzes if not quiz.is_priority_mastery],
            weak_priority=False,
        )

    def unit_cards(units: Sequence[BranchUnit], phase: str) -> list[dict[str, Any]]:
        if not mindmap_enabled:
            return []
        cards: list[dict[str, Any]] = []
        for unit in units:
            title = str((palace_meta.get(unit.palace_id) or {}).get("title") or "")
            due_uids = due_by_palace.get(unit.palace_id, set())
            cards.append(
                mindmap_card_payload(
                    unit,
                    palace_title=title,
                    due_uids=due_uids,
                    phase=phase,
                )
            )
        return cards

    def quiz_cards(items: Sequence[QuizCandidate], phase: str) -> list[dict[str, Any]]:
        if not quiz_enabled:
            return []
        cards: list[dict[str, Any]] = []
        for quiz in items:
            title = str((palace_meta.get(quiz.palace_id) or {}).get("title") or "")
            cards.append(quiz_card_payload(quiz, palace_title=title, phase=phase))
        return cards

    def palace_stream(
        palace_id: int,
        units: Sequence[BranchUnit],
        palace_quizzes: Sequence[QuizCandidate],
        phase: str,
    ) -> list[dict[str, Any]]:
        unit_questions, unbound = attach_questions_to_units(units, palace_quizzes)
        stream: list[dict[str, Any]] = []
        for unit in units:
            stream.extend(unit_cards([unit], phase))
            stream.extend(
                quiz_cards(
                    sort_quiz_candidates(
                        unit_questions.get(unit_key(unit), ()),
                        weak_priority=weak_priority,
                    ),
                    phase,
                )
            )
        if unbound:
            stream = interleave_by_weights(
                stream,
                quiz_cards(sort_quiz_candidates(unbound, weak_priority=weak_priority), phase),
                mindmap_weight=mindmap_weight,
                quiz_weight=quiz_weight,
                seed=seed + palace_id,
            )
        return stream

    def compose_phase(
        units_map: Mapping[int, Sequence[BranchUnit]],
        quizzes_map: Mapping[int, Sequence[QuizCandidate]],
        phase: str,
    ) -> list[dict[str, Any]]:
        streams = {
            palace_id: palace_stream(
                palace_id,
                units_map.get(palace_id, ()),
                quizzes_map.get(palace_id, ()),
                phase,
            )
            for palace_id in palace_ids
        }
        if palace_order == PALACE_ORDER_SEQUENTIAL:
            return [card for palace_id in palace_ids for card in streams[palace_id]]
        result: list[dict[str, Any]] = []
        queues = {palace_id: list(streams[palace_id]) for palace_id in palace_ids}
        while any(queues.values()):
            for palace_id in palace_ids:
                if queues[palace_id]:
                    result.append(queues[palace_id].pop(0))
        return result

    phase1 = compose_phase(due_units_by_palace, priority_quizzes_by_palace, "due")
    phase2 = (
        []
        if due_policy == DUE_POLICY_DUE_ONLY
        else compose_phase(later_units_by_palace, fill_quizzes_by_palace, "fill")
    )
    if due_policy == DUE_POLICY_ALL_WEIGHTED:
        phase1 = interleave_by_weights(
            phase1,
            phase2,
            mindmap_weight=3,
            quiz_weight=1,
            seed=seed + 2,
        )
        phase2 = []
    combined = phase1 + phase2
    remaining = filter_completed(combined, completed_ids=completed, hidden_ids=hidden)
    limited = remaining[:queue_length]

    return QueueBuildResult(
        cards=limited,
        phase_stats={
            "phase1_count": len(phase1),
            "phase2_count": len(phase2),
            "remaining_before_limit": len(remaining),
            "queue_length": len(limited),
            "due_unit_count": sum(len(items) for items in due_units_by_palace.values()),
            "fill_unit_count": sum(len(items) for items in later_units_by_palace.values()),
            "priority_quiz_count": sum(len(items) for items in priority_quizzes_by_palace.values()),
            "fill_quiz_count": sum(len(items) for items in fill_quizzes_by_palace.values()),
            "completed_excluded": len(completed),
            "hidden_excluded": len(hidden),
            "due_policy": due_policy,
        },
        operation_id=operation_id,
    )


__all__ = [
    "QuizCandidate",
    "QueueBuildResult",
    "assemble_queue",
    "attach_questions_to_units",
    "build_palace_units",
    "filter_completed",
    "interleave_by_weights",
    "mindmap_card_payload",
    "order_palace_batches",
    "partition_units_by_due",
    "quiz_card_payload",
    "quiz_key",
    "sort_due_phase_units",
    "sort_fill_phase_units",
    "sort_quiz_candidates",
    "unit_key",
]
