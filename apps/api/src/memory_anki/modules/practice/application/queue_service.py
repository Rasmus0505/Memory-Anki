"""Freestyle immersive queue composition through public context facades."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import (
    list_active_palace_ids_by_subject_ids,
    list_active_palace_ids_by_subject_scope,
)
from memory_anki.modules.exam.api import palace_priority_scores, resolve_stars_for_palaces
from memory_anki.modules.memory.public.queries import (
    list_trusted_due_units_for_queue,
    resolve_unit_definitions,
)
from memory_anki.modules.quiz.public.queries import (
    list_node_bindings_for_palaces,
    list_published_questions_for_palaces,
)

from ..domain.feed_config import (
    PALACE_ORDER_EXAM_PRIORITY,
    PALACE_ORDER_SEQUENTIAL,
    sanitize_feed_config,
)
from ..domain.leftover_due import leftover_due_by_palace, merge_leftover_due
from ..domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
    merge_content_streams,
    omit_restored_ids,
)
from .round_read_lookups import restored_card_ids
from ..domain.review_units import ReviewUnitCandidate, context_path_including_anchor
from ..domain.study_window import take_study_window


def build_freestyle_queue(
    session: Session,
    *,
    config_raw: dict[str, Any] | None,
    operation_id: str,
    round_id: str = "",
    completed_ids: list[str] | None = None,
    hidden_ids: list[str] | None = None,
    study_window: bool = False,
) -> dict[str, Any]:
    config = sanitize_feed_config(config_raw or {})
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")
    completed_ids, hidden_ids = omit_restored_ids(
        completed_ids or [],
        hidden_ids or [],
        restored_card_ids(session, round_id),
    )

    training_mode = str(config.get("training_mode") or "mixed")
    active_streams = list(config.get("mixed_modes") or [training_mode])
    if training_mode != "mixed":
        active_streams = [training_mode]
    active_streams = [item for item in active_streams if item in {"memory_palace", "quiz", "english"}]
    if not active_streams:
        active_streams = ["memory_palace"]
    stream_configs = config.get("streams") or {}

    def resolve_stream_ids(stream_name: str) -> tuple[list[int], str]:
        raw = stream_configs.get(stream_name) if isinstance(stream_configs, dict) else {}
        raw = raw if isinstance(raw, dict) else {}
        subject_scope = str(raw.get("subject_scope") or "all")
        requested_subject_ids = [
            int(value)
            for value in raw.get("subject_ids") or []
            if str(value).strip().lstrip("-").isdigit() and int(value) > 0
        ]
        specific_ids = [int(value) for value in raw.get("specific_palace_ids") or []]
        if requested_subject_ids:
            # Non-empty specific_palace_ids is an explicit subset (or extra list).
            if specific_ids:
                return specific_ids, "all"
            return list_active_palace_ids_by_subject_ids(session, requested_subject_ids), "all"
        subject_palaces = list_active_palace_ids_by_subject_scope(session, subject_scope)
        if subject_scope != "all":
            # Legacy subject presets are broad inclusion scopes; explicit IDs are additive.
            specific_ids = list(dict.fromkeys([*subject_palaces, *specific_ids]))
        return specific_ids, subject_scope

    stream_ids: dict[str, list[int]] = {}
    stream_subjects: dict[str, str] = {}
    for stream_name in active_streams:
        stream_ids[stream_name], stream_subjects[stream_name] = resolve_stream_ids(stream_name)

    all_selected_ids = sorted({item for values in stream_ids.values() for item in values})
    # Empty id list means every active palace (subject scope "all" with no
    # explicit palaces). A non-empty list is the in-scope subset. Due cards
    # come from active ReviewUnitState rows — no bulk reconcile. Opening a
    # unit still reconciles that palace. Row titles need the marked-node path,
    # so each due palace is projected once through the document cache.
    due_rows = list_trusted_due_units_for_queue(
        session,
        all_selected_ids or None,
    )

    palace_meta: dict[int, dict[str, Any]] = {}
    units_by_palace: dict[int, list[Any]] = {}
    due_by_palace: dict[int, set[str]] = {}
    mastery_by_palace: dict[int, float] = {}
    recent_practice_rank: dict[int, int] = {}
    nodes_by_palace: dict[int, dict[str, Any]] = {}

    def nodes_for(palace_id: int) -> dict[str, Any]:
        if palace_id not in nodes_by_palace:
            try:
                tree, _definitions = resolve_unit_definitions(session, palace_id)
                nodes = tree.get("nodes") if isinstance(tree, dict) else None
                nodes_by_palace[palace_id] = nodes if isinstance(nodes, dict) else {}
            except ValueError:
                nodes_by_palace[palace_id] = {}
        return nodes_by_palace[palace_id]

    for row in due_rows:
        palace_id = int(row["palace_id"])
        title = str(row.get("title") or "")
        if palace_id not in palace_meta:
            palace_meta[palace_id] = {"title": title}
        anchor = str(row.get("anchor_uid") or "")
        node_uids = tuple(
            str(uid) for uid in (row.get("node_uids") or []) if str(uid).strip()
        )
        if not node_uids and anchor:
            node_uids = (anchor,)
        path = context_path_including_anchor(nodes_for(palace_id), anchor)
        if not path:
            path = ({"uid": anchor or str(row["id"]), "text": title},)
        units_by_palace.setdefault(palace_id, []).append(
            ReviewUnitCandidate(
                palace_id=palace_id,
                anchor_uid=anchor,
                context_path=path,
                node_uids=node_uids,
                unit_id=str(row["id"]),
                revision=int(row.get("revision") or 1),
                unit_kind=str(row.get("unit_kind") or ""),
            )
        )
        due_by_palace.setdefault(palace_id, set()).update(node_uids)

    # Quiz projections only when the quiz stream is active. Its scope is
    # independent from both palace streams in a mixed round.
    quizzes: list[QuizCandidate] = []
    if "quiz" in active_streams:
        quiz_filter = stream_ids.get("quiz") or None
        quiz_scope_config = stream_configs.get("quiz") if isinstance(stream_configs, dict) else {}
        quiz_scope_config = quiz_scope_config if isinstance(quiz_scope_config, dict) else {}
        questions = list_published_questions_for_palaces(
            session,
            palace_ids=quiz_filter,
            question_type=str(quiz_scope_config.get("question_type") or config.get("question_type") or "all"),
        )
        bindings = list_node_bindings_for_palaces(session, palace_ids=quiz_filter)
        bound_map: dict[int, list[str]] = {}
        for row in bindings:
            qid = int(row["question_id"])
            bound_map.setdefault(qid, []).append(str(row["node_uid"]))
        for question in questions:
            qid = int(question.get("id") or 0)
            palace_id = int(question.get("palace_id") or 0)
            if qid <= 0 or palace_id <= 0:
                continue
            if all_selected_ids and palace_id not in set(all_selected_ids):
                continue
            quizzes.append(
                QuizCandidate(
                    question_id=qid,
                    palace_id=palace_id,
                    bound_node_uids=tuple(bound_map.get(qid) or ()),
                    mastery_score=0.0,
                    mastery_label="",
                    question=question,
                )
            )
            if palace_id not in palace_meta:
                palace_meta[palace_id] = {
                    "title": str(question.get("palace_title") or f"宫殿 {palace_id}"),
                }

    def subset(mapping: dict[int, Any], ids: list[int]) -> dict[int, Any]:
        allowed = set(ids) if ids else set(mapping)
        return {key: value for key, value in mapping.items() if key in allowed}

    def raw_palace_order(stream_name: str) -> str:
        raw = stream_configs.get(stream_name) if isinstance(stream_configs, dict) else {}
        raw = raw if isinstance(raw, dict) else {}
        return str(raw.get("palace_order") or PALACE_ORDER_SEQUENTIAL)

    exam_ordered_streams = {
        name for name in active_streams
        if name in {"memory_palace", "english"} and raw_palace_order(name) == PALACE_ORDER_EXAM_PRIORITY
    }
    priority_scores = (
        palace_priority_scores(session, list(palace_meta) or None) if exam_ordered_streams else {}
    )

    def stream_palace_meta(stream_name: str, ids: list[int]) -> dict[int, Any]:
        meta = subset(palace_meta, ids)
        if stream_name not in exam_ordered_streams:
            return meta
        ordered = sorted(meta, key=lambda pid: (-priority_scores.get(pid, 0.0), pid))
        return {pid: meta[pid] for pid in ordered}

    def stream_config(stream_name: str) -> dict[str, Any]:
        raw = stream_configs.get(stream_name) if isinstance(stream_configs, dict) else {}
        raw = raw if isinstance(raw, dict) else {}
        ids = stream_ids.get(stream_name, [])
        if stream_name in {"memory_palace", "english"}:
            order = raw_palace_order(stream_name)
            return {
                **config,
                "content": {"mindmap_branch": True, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "specific_palace_ids": ids,
                "subject_scope": stream_subjects.get(stream_name, "all"),
                # Exam order is pre-applied to palace_meta; the builder then walks it sequentially.
                "palace_order": PALACE_ORDER_SEQUENTIAL if order == PALACE_ORDER_EXAM_PRIORITY else order,
                "due_policy": "due_only",
                "unit_order": raw.get("unit_order") or "structured",
                "queue_length": 100,
            }
        return {
            **config,
            "content": {"mindmap_branch": False, "quiz_question": True},
            "mix_mode": "quiz_only",
            "specific_palace_ids": ids,
            "subject_scope": stream_subjects.get(stream_name, "all"),
            "question_type": raw.get("question_type") or "all",
            "quiz_mastery_buckets": raw.get("mastery_buckets") or config.get("quiz_mastery_buckets"),
            "quiz_scope": raw.get("quiz_scope") or "cross_palace_random",
            "weak_quiz_priority": raw.get("weak_priority", True),
            "queue_length": 100,
        }

    stream_results: dict[str, Any] = {}
    stream_cards: dict[str, list[dict[str, Any]]] = {}
    for stream_name in active_streams:
        scoped_ids = stream_ids.get(stream_name) or list(palace_meta.keys())
        result = assemble_queue(
            config=stream_config(stream_name),
            palace_meta=stream_palace_meta(stream_name, scoped_ids),
            units_by_palace=subset(units_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            due_by_palace=subset(due_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            mastery_by_palace=subset(mastery_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            recent_practice_rank=subset(recent_practice_rank, scoped_ids),
            quizzes=quizzes if stream_name == "quiz" else [],
            completed_ids=completed_ids or [],
            hidden_ids=hidden_ids or [],
            operation_id=f"{op_id}:{stream_name}",
        )
        stream_results[stream_name] = result
        stream_cards[stream_name] = result.cards

    raw_mix = config.get("mix")
    mix: dict[str, Any] = raw_mix if isinstance(raw_mix, dict) else {}
    raw_ratios = mix.get("ratios")
    ratios: dict[str, Any] = raw_ratios if isinstance(raw_ratios, dict) else {}
    combined = merge_content_streams(
        stream_cards,
        active_streams=active_streams,
        strategy=str(mix.get("strategy") or "ratio") if isinstance(mix, dict) else "ratio",
        ratios={str(key): int(value) for key, value in ratios.items()},
        seed=int(config.get("seed") or 17),
    )
    completed = {str(item) for item in completed_ids or [] if item}
    hidden = {str(item) for item in hidden_ids or [] if item}
    remaining = [
        card for card in combined
        if str(card.get("id") or "") not in completed
        and str(card.get("id") or "") not in hidden
    ]
    quiz_only = str(training_mode or "") == "quiz"
    queue_length = int(config.get("queue_length") or 20)
    full_limited = remaining[:queue_length] if quiz_only else remaining
    # Cold start only: a prefix of the same order (8 cards, or the first palace
    # boundary, whichever comes first). The tail is not a reshuffle.
    tail_pending = False
    limited = full_limited
    if study_window and not quiz_only:
        limited = take_study_window(full_limited)
        tail_pending = len(limited) < len(full_limited)
    card_palace_ids = sorted({int(card.get("palace_id") or 0) for card in limited} - {0})
    stars_by_palace = resolve_stars_for_palaces(session, card_palace_ids) if card_palace_ids else {}
    limited = [
        {**card, "exam_stars": stars_by_palace.get(int(card.get("palace_id") or 0), 1)}
        for card in limited
    ]
    phase_stats = {
        "candidate_count": len(remaining),
        "scheduled_count": len(limited),
        "queue_limit": queue_length if quiz_only else len(full_limited),
        "limit_reached": len(remaining) > len(full_limited),
        # Preserve the former top-level diagnostic while each palace stream
        # now owns its own due-policy evaluation.
        "due_unit_count": sum(
            int(stream_results[name].phase_stats.get("due_unit_count") or 0)
            for name in ("memory_palace", "english")
            if name in stream_results
        ),
        "training_mode": training_mode,
        "active_streams": ",".join(active_streams),
    }
    for stream_name, result in stream_results.items():
        phase_stats[f"{stream_name}_candidate_count"] = int(result.phase_stats.get("candidate_count") or 0)
        phase_stats[f"{stream_name}_scheduled_count"] = len(result.cards)

    palace_leftover_due = merge_leftover_due(
        *(
            result.phase_stats.get("palace_leftover_due")
            for result in stream_results.values()
        ),
        leftover_due_by_palace(remaining, full_limited),
    )
    phase_stats["palace_leftover_due"] = palace_leftover_due

    return {
        "operation_id": op_id,
        "round_id": str(round_id or ""),
        "config": config,
        "cards": limited,
        "phase_stats": phase_stats,
        "round_meta": {
            "candidate_count": len(remaining),
            "scheduled_count": len(limited),
            "queue_limit": queue_length if quiz_only else len(full_limited),
            "limit_reached": len(remaining) > len(full_limited),
            "tail_pending": tail_pending,
            "palace_leftover_due": palace_leftover_due,
        },
        "counts": {
            "mindmap_branch": sum(1 for card in limited if card.get("type") == "mindmap_branch"),
            "anki_card": 0,
            "quiz_question": sum(1 for card in limited if card.get("type") == "quiz_question"),
            "total": len(limited),
        },
    }


__all__ = ["build_freestyle_queue"]
