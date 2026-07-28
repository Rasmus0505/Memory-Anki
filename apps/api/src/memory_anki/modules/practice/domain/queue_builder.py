"""Deterministic freestyle queue assembly (pure functions)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .anki_cards import collect_anki_cards, resolve_effective_role
from .feed_config import (
    BOUND_QUIZ_FOLLOW_UNIT,
    DUE_POLICY_ALL_WEIGHTED,
    DUE_POLICY_DUE_FIRST,
    DUE_POLICY_DUE_ONLY,
    MIX_MODE_MINDMAP_ONLY,
    MIX_MODE_QUIZ_ONLY,
    MIX_MODE_RANDOM,
    MIX_MODE_RATIO,
    MIX_MODE_SEQUENTIAL_MAP_QUIZ,
    MIX_MODE_SEQUENTIAL_QUIZ_MAP,
    PALACE_ORDER_INTERLEAVE,
    PALACE_ORDER_SEQUENTIAL,
)
from .review_units import ReviewUnitCandidate


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


def _unit_due_count(unit: ReviewUnitCandidate, due_uids: set[str]) -> int:
    return sum(1 for uid in unit.node_uids if uid in due_uids)


def _unit_has_due(unit: ReviewUnitCandidate, due_uids: set[str]) -> bool:
    return _unit_due_count(unit, due_uids) > 0


def _stable_mix(*parts: Any) -> int:
    value = 2_166_136_261
    for part in parts:
        text = str(part)
        for char in text:
            value ^= ord(char)
            value = (value * 16_777_619) & 0xFFFFFFFF
    return value


def partition_units_by_due(
    units: Sequence[ReviewUnitCandidate],
    due_by_palace: Mapping[int, set[str]],
) -> tuple[list[ReviewUnitCandidate], list[ReviewUnitCandidate]]:
    due_units: list[ReviewUnitCandidate] = []
    later_units: list[ReviewUnitCandidate] = []
    for unit in units:
        due_uids = due_by_palace.get(unit.palace_id, set())
        if _unit_has_due(unit, due_uids):
            due_units.append(unit)
        else:
            later_units.append(unit)
    return due_units, later_units


def sort_due_phase_units(
    units: Sequence[ReviewUnitCandidate],
    due_by_palace: Mapping[int, set[str]],
) -> list[ReviewUnitCandidate]:
    del due_by_palace
    return list(units)


def sort_fill_phase_units(
    units: Sequence[ReviewUnitCandidate],
    mastery_by_palace: Mapping[int, float],
    recent_practice_rank: Mapping[int, int],
) -> list[ReviewUnitCandidate]:
    del mastery_by_palace, recent_practice_rank
    return list(units)


def attach_questions_to_units(
    units: Sequence[ReviewUnitCandidate],
    quizzes: Sequence[QuizCandidate],
) -> tuple[dict[str, list[QuizCandidate]], list[QuizCandidate]]:
    """Bound questions follow a branch that contains the bound node; else palace pool."""
    unit_questions: dict[str, list[QuizCandidate]] = {unit_key(unit): [] for unit in units}
    palace_units: dict[int, list[ReviewUnitCandidate]] = {}
    for unit in units:
        palace_units.setdefault(unit.palace_id, []).append(unit)

    unbound: list[QuizCandidate] = []
    for quiz in quizzes:
        if not quiz.bound_node_uids:
            unbound.append(quiz)
            continue
        matched = False
        for unit in palace_units.get(quiz.palace_id, []):
            ratable = set(unit.node_uids)
            if any(uid in ratable for uid in quiz.bound_node_uids):
                unit_questions[unit_key(unit)].append(quiz)
                matched = True
                break
        if not matched:
            unbound.append(quiz)
    return unit_questions, unbound


def unit_key(unit: ReviewUnitCandidate) -> str:
    return f"review_unit:{unit.unit_id}:r{unit.revision}"


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


def deterministic_random_merge(
    mindmap_cards: Sequence[dict[str, Any]],
    quiz_cards: Sequence[dict[str, Any]],
    *,
    seed: int,
) -> list[dict[str, Any]]:
    """Seed-stable merge of two streams (same inputs → same order)."""
    items: list[tuple[int, int, int, dict[str, Any]]] = []
    for index, card in enumerate(mindmap_cards):
        items.append(
            (
                _stable_mix(seed, "rand", "m", index, card.get("id")),
                0,
                index,
                card,
            )
        )
    for index, card in enumerate(quiz_cards):
        items.append(
            (
                _stable_mix(seed, "rand", "q", index, card.get("id")),
                1,
                index,
                card,
            )
        )
    items.sort(key=lambda item: (item[0], item[1], item[2]))
    return [item[3] for item in items]


def merge_streams_by_mix_mode(
    mindmap_cards: Sequence[dict[str, Any]],
    quiz_cards: Sequence[dict[str, Any]],
    *,
    mix_mode: str,
    mix_ratio_mindmap: int,
    mix_ratio_quiz: int,
    seed: int,
) -> list[dict[str, Any]]:
    """Apply explicit map-vs-quiz mix_mode to two ordered streams."""
    maps = list(mindmap_cards)
    quizzes = list(quiz_cards)
    if mix_mode == MIX_MODE_MINDMAP_ONLY:
        return maps
    if mix_mode == MIX_MODE_QUIZ_ONLY:
        return quizzes
    if mix_mode == MIX_MODE_SEQUENTIAL_MAP_QUIZ:
        return maps + quizzes
    if mix_mode == MIX_MODE_SEQUENTIAL_QUIZ_MAP:
        return quizzes + maps
    if mix_mode == MIX_MODE_RANDOM:
        return deterministic_random_merge(maps, quizzes, seed=seed)
    # Default / ratio
    return interleave_by_weights(
        maps,
        quizzes,
        mindmap_weight=max(1, mix_ratio_mindmap),
        quiz_weight=max(1, mix_ratio_quiz),
        seed=seed,
    )


def _is_map_side_card(card: Mapping[str, Any]) -> bool:
    return str(card.get("type") or "") in {"mindmap_branch", "anki_card"}


def _is_quiz_side_card(card: Mapping[str, Any]) -> bool:
    return str(card.get("type") or "") == "quiz_question"


def mindmap_card_payload(
    unit: ReviewUnitCandidate,
    *,
    palace_title: str,
    due_uids: set[str],
    phase: str,
    presentation: str = "palace",
    anki_front_uid: str | None = None,
    anki_back_uids: list[str] | None = None,
) -> dict[str, Any] | None:
    """Build a due review-unit card or an independent Anki presentation card."""
    due_in_unit = [uid for uid in unit.node_uids if uid in due_uids]
    if not due_in_unit:
        return None
    is_anki = presentation == "anki"
    card_type = "anki_card" if is_anki else "mindmap_branch"
    card_id = (
        f"anki_card:{unit.palace_id}:{anki_front_uid or unit.anchor_uid}"
        if is_anki
        else unit_key(unit)
    )
    payload: dict[str, Any] = {
        "id": card_id,
        "type": card_type,
        "content_type": card_type,
        "presentation": "anki" if is_anki else "palace",
        "palace_id": unit.palace_id,
        "palace_title": palace_title,
        "anchor_uid": unit.anchor_uid,
        "context_path": list(unit.context_path),
        "node_uids": list(unit.node_uids),
        "node_count": unit.node_count,
        "phase": phase,
        "palace_context": {
            "id": unit.palace_id,
            "title": palace_title,
            "resolved_title": palace_title,
        },
    }
    if is_anki:
        payload["anki_front_uid"] = anki_front_uid or unit.anchor_uid
        payload["anki_back_uids"] = list(anki_back_uids or [])
    else:
        payload["unit_id"] = unit.unit_id
        payload["unit_revision"] = unit.revision
    return payload


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
    units_by_palace: Mapping[int, Sequence[ReviewUnitCandidate]],
    due_by_palace: Mapping[int, set[str]],
    mastery_by_palace: Mapping[int, float],
    recent_practice_rank: Mapping[int, int],
    quizzes: Sequence[QuizCandidate],
    completed_ids: Iterable[str] = (),
    hidden_ids: Iterable[str] = (),
    operation_id: str = "",
    nodes_by_palace: Mapping[int, Mapping[str, Mapping[str, Any]]] | None = None,
) -> QueueBuildResult:
    completed = {str(item) for item in completed_ids if item}
    hidden = {str(item) for item in hidden_ids if item}
    seed = int(config.get("seed") or 17)
    due_policy = str(config.get("due_policy") or DUE_POLICY_DUE_FIRST)
    palace_order = str(config.get("palace_order") or PALACE_ORDER_SEQUENTIAL)
    queue_length = int(config.get("queue_length") or 20)
    mindmap_enabled = bool((config.get("content") or {}).get("mindmap_branch", True))
    anki_enabled = bool((config.get("content") or {}).get("anki_card", True))
    quiz_enabled = bool((config.get("content") or {}).get("quiz_question", True))
    weights = config.get("weights") or {}
    mindmap_weight = int(weights.get("mindmap_branch", 2))
    anki_weight = int(weights.get("anki_card", 2))
    quiz_weight = int(weights.get("quiz_question", 1))
    mix_mode = str(config.get("mix_mode") or MIX_MODE_RATIO)
    raw_mix_ratio = config.get("mix_ratio") or {}
    if not isinstance(raw_mix_ratio, Mapping):
        raw_mix_ratio = {}
    mix_ratio_mindmap = int(
        raw_mix_ratio.get("mindmap")
        or max(1, max(0, mindmap_weight) + max(0, anki_weight))
        or 2
    )
    mix_ratio_quiz = int(raw_mix_ratio.get("quiz") or max(1, quiz_weight) or 1)
    bound_quiz_placement = str(
        config.get("bound_quiz_placement") or BOUND_QUIZ_FOLLOW_UNIT
    )
    # Combine mindmap streams for interleave against quiz (legacy fallback).
    map_stream_weight = max(mindmap_weight, 0) + max(anki_weight, 0)
    if map_stream_weight <= 0:
        map_stream_weight = mix_ratio_mindmap
    if quiz_weight <= 0:
        quiz_weight = mix_ratio_quiz
    weak_priority = bool(config.get("weak_quiz_priority", True))
    nodes_by_palace = nodes_by_palace or {}

    # mix_mode can force-disable a stream even if content toggles are on.
    if mix_mode == MIX_MODE_MINDMAP_ONLY:
        quiz_enabled = False
    elif mix_mode == MIX_MODE_QUIZ_ONLY:
        mindmap_enabled = False
        anki_enabled = False

    palace_ids = list(palace_meta.keys())
    if palace_order == PALACE_ORDER_INTERLEAVE:
        palace_ids = sorted(
            palace_ids,
            key=lambda palace_id: (_stable_mix(seed, "palace", palace_id), palace_id),
        )

    due_units_by_palace: dict[int, list[ReviewUnitCandidate]] = {}
    later_units_by_palace: dict[int, list[ReviewUnitCandidate]] = {}
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

    def unit_cards(
        units: Sequence[ReviewUnitCandidate], phase: str
    ) -> list[dict[str, Any]]:
        if not mindmap_enabled and not anki_enabled:
            return []
        cards: list[dict[str, Any]] = []
        for unit in units:
            title = str((palace_meta.get(unit.palace_id) or {}).get("title") or "")
            due_uids = due_by_palace.get(unit.palace_id, set())
            palace_nodes = nodes_by_palace.get(unit.palace_id) or {}
            if mindmap_enabled:
                payload = mindmap_card_payload(
                    unit,
                    palace_title=title,
                    due_uids=due_uids,
                    phase=phase,
                    presentation="palace",
                )
                if payload is not None:
                    cards.append(payload)

            memo: dict[str, str] = {}
            due_fronts = [
                uid
                for uid in unit.node_uids
                if uid in due_uids
                and resolve_effective_role(str(uid), palace_nodes, memo) == "front"
            ]
            # Anki cards are independent practice prompts. They supplement the
            # review-unit card and never carry unit identity or replace scoring.
            if anki_enabled and due_fronts and palace_nodes:
                anki_defs = {
                    str(item["front_uid"]): item
                    for item in collect_anki_cards(palace_nodes)
                }
                for front_uid in due_fronts:
                    definition = anki_defs.get(str(front_uid)) or {
                        "front_uid": front_uid,
                        "back_uids": [],
                    }
                    back_uids = [str(uid) for uid in list(definition.get("back_uids") or [])]
                    ratable = [str(front_uid), *back_uids]
                    due_for_card = [uid for uid in ratable if uid in due_uids]
                    if not due_for_card:
                        due_for_card = [str(front_uid)]
                    scoped = ReviewUnitCandidate(
                        palace_id=unit.palace_id,
                        anchor_uid=str(front_uid),
                        context_path=unit.context_path,
                        node_uids=tuple(ratable),
                        unit_id=unit.unit_id,
                        revision=unit.revision,
                    )
                    payload = mindmap_card_payload(
                        scoped,
                        palace_title=title,
                        due_uids=set(due_for_card),
                        phase=phase,
                        presentation="anki",
                        anki_front_uid=str(front_uid),
                        anki_back_uids=back_uids,
                    )
                    if payload is not None:
                        cards.append(payload)
        return cards

    def quiz_cards(items: Sequence[QuizCandidate], phase: str) -> list[dict[str, Any]]:
        if not quiz_enabled:
            return []
        cards: list[dict[str, Any]] = []
        for quiz in items:
            title = str((palace_meta.get(quiz.palace_id) or {}).get("title") or "")
            cards.append(quiz_card_payload(quiz, palace_title=title, phase=phase))
        return cards

    def palace_map_stream(
        units: Sequence[ReviewUnitCandidate],
        phase: str,
    ) -> list[dict[str, Any]]:
        """Palace-side cards only (mindmap / anki)."""
        stream: list[dict[str, Any]] = []
        for unit in units:
            stream.extend(unit_cards([unit], phase))
        return stream

    def collect_palace_streams(
        units: Sequence[ReviewUnitCandidate],
        palace_quizzes: Sequence[QuizCandidate],
        phase: str,
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
        """Return pure map cards, bound quizzes keyed by map card id, and free quiz cards.

        When bound_quiz_placement is follow_unit, bound quizzes are re-attached after
        their unit's map card post-mix so ratio/random cannot split them apart.
        Otherwise every quiz goes into the free quiz stream for global mix_mode.
        """
        unit_questions, unbound = attach_questions_to_units(units, palace_quizzes)
        map_cards = palace_map_stream(units, phase)
        if bound_quiz_placement != BOUND_QUIZ_FOLLOW_UNIT:
            return (
                map_cards,
                {},
                quiz_cards(
                    sort_quiz_candidates(list(palace_quizzes), weak_priority=weak_priority),
                    phase,
                ),
            )

        bound_after: dict[str, list[dict[str, Any]]] = {}
        # Attach bound quizzes to the last map card emitted for each unit.
        for unit in units:
            unit_map = unit_cards([unit], phase)
            if not unit_map:
                # No map card (e.g. disabled); bound quizzes fall into free stream.
                unbound = list(unbound) + list(unit_questions.get(unit_key(unit), ()))
                continue
            anchor_id = str(unit_map[-1].get("id") or "")
            bound = quiz_cards(
                sort_quiz_candidates(
                    unit_questions.get(unit_key(unit), ()),
                    weak_priority=weak_priority,
                ),
                phase,
            )
            if anchor_id and bound:
                bound_after.setdefault(anchor_id, []).extend(bound)
        return (
            map_cards,
            bound_after,
            quiz_cards(sort_quiz_candidates(unbound, weak_priority=weak_priority), phase),
        )

    def compose_phase(
        units_map: Mapping[int, Sequence[ReviewUnitCandidate]],
        quizzes_map: Mapping[int, Sequence[QuizCandidate]],
        phase: str,
    ) -> list[dict[str, Any]]:
        map_by_palace: dict[int, list[dict[str, Any]]] = {}
        quiz_by_palace: dict[int, list[dict[str, Any]]] = {}
        bound_after: dict[str, list[dict[str, Any]]] = {}
        for palace_id in palace_ids:
            map_cards, palace_bound, quiz_cards_list = collect_palace_streams(
                units_map.get(palace_id, ()),
                quizzes_map.get(palace_id, ()),
                phase,
            )
            map_by_palace[palace_id] = map_cards
            quiz_by_palace[palace_id] = quiz_cards_list
            for card_id, items in palace_bound.items():
                bound_after.setdefault(card_id, []).extend(items)

        def order_palace_cards(
            by_palace: Mapping[int, Sequence[dict[str, Any]]],
        ) -> list[dict[str, Any]]:
            if palace_order == PALACE_ORDER_SEQUENTIAL:
                return [
                    card
                    for palace_id in palace_ids
                    for card in by_palace.get(palace_id, ())
                ]
            result: list[dict[str, Any]] = []
            queues = {
                palace_id: list(by_palace.get(palace_id, ())) for palace_id in palace_ids
            }
            while any(queues.values()):
                for palace_id in palace_ids:
                    if queues[palace_id]:
                        result.append(queues[palace_id].pop(0))
            return result

        map_side = order_palace_cards(map_by_palace)
        quiz_side = order_palace_cards(quiz_by_palace)
        mixed = merge_streams_by_mix_mode(
            map_side,
            quiz_side,
            mix_mode=mix_mode,
            mix_ratio_mindmap=mix_ratio_mindmap,
            mix_ratio_quiz=mix_ratio_quiz,
            seed=seed + (0 if phase == "due" else 1),
        )
        if not bound_after:
            return mixed
        # Re-attach bound quizzes immediately after their anchor map/anki card.
        final: list[dict[str, Any]] = []
        for card in mixed:
            final.append(card)
            card_id = str(card.get("id") or "")
            if card_id in bound_after:
                final.extend(bound_after.pop(card_id))
        # Any anchors missing from mixed (filtered/disabled) append remaining bounds.
        for leftovers in bound_after.values():
            final.extend(leftovers)
        return final

    phase1 = compose_phase(due_units_by_palace, priority_quizzes_by_palace, "due")
    phase2 = (
        []
        if due_policy == DUE_POLICY_DUE_ONLY
        else compose_phase(later_units_by_palace, fill_quizzes_by_palace, "fill")
    )
    if due_policy == DUE_POLICY_ALL_WEIGHTED:
        # Expand pool: fold fill into due phase with a fixed secondary interleave.
        # mix_mode already ordered each phase; here we only combine priority vs fill pools.
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
            "mix_mode": mix_mode,
            "bound_quiz_placement": bound_quiz_placement,
        },
        operation_id=operation_id,
    )


__all__ = [
    "QuizCandidate",
    "QueueBuildResult",
    "assemble_queue",
    "attach_questions_to_units",
    "deterministic_random_merge",
    "filter_completed",
    "interleave_by_weights",
    "merge_streams_by_mix_mode",
    "mindmap_card_payload",
    "partition_units_by_due",
    "quiz_card_payload",
    "quiz_key",
    "sort_due_phase_units",
    "sort_fill_phase_units",
    "sort_quiz_candidates",
    "unit_key",
]
