"""Freestyle immersive queue composition through public context facades."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import (
    list_active_palace_ids_by_subject_scope,
    list_active_palace_tree_structures,
)
from memory_anki.modules.memory.public.queries import project_palace_review_summaries
from memory_anki.modules.quiz.public.queries import (
    list_mastery_profiles_for_palaces,
    list_node_bindings_for_palaces,
    list_published_questions_for_palaces,
)

from ..domain.feed_config import sanitize_feed_config
from ..domain.leftover_due import leftover_due_by_palace, merge_leftover_due
from ..domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
    merge_content_streams,
)
from ..domain.review_units import candidate_from_projection


def build_freestyle_queue(
    session: Session,
    *,
    config_raw: dict[str, Any] | None,
    operation_id: str,
    round_id: str = "",
    completed_ids: list[str] | None = None,
    hidden_ids: list[str] | None = None,
) -> dict[str, Any]:
    config = sanitize_feed_config(config_raw or {})
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")

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
        subject_ids = list_active_palace_ids_by_subject_scope(session, subject_scope)
        specific_ids = [int(value) for value in raw.get("specific_palace_ids") or []]
        if subject_scope != "all":
            # Subject presets are broad inclusion scopes; explicit IDs are additive.
            specific_ids = list(dict.fromkeys([*subject_ids, *specific_ids]))
        return specific_ids, subject_scope

    stream_ids: dict[str, list[int]] = {}
    stream_subjects: dict[str, str] = {}
    for stream_name in active_streams:
        stream_ids[stream_name], stream_subjects[stream_name] = resolve_stream_ids(stream_name)

    all_selected_ids = sorted({item for values in stream_ids.values() for item in values})
    trees = list_active_palace_tree_structures(
        session,
        palace_ids=all_selected_ids or None,
    )
    # Drop trees with no root / no stable nodes.
    trees = [tree for tree in trees if tree.get("root_uid") and tree.get("nodes")]
    palace_ids = [int(tree["palace_id"]) for tree in trees]

    palace_meta: dict[int, dict[str, Any]] = {}
    units_by_palace: dict[int, list[Any]] = {}
    due_by_palace: dict[int, set[str]] = {}
    mastery_by_palace: dict[int, float] = {}
    recent_practice_rank: dict[int, int] = {}

    if palace_ids:
        # Batch path expects palace ids (or Palace rows); never raw tree dicts.
        projections = project_palace_review_summaries(session, palace_ids)
        for tree in trees:
            palace_id = int(tree["palace_id"])
            palace_meta[palace_id] = {
                "title": str(tree.get("title") or ""),
            }
            nodes = tree["nodes"]
            projection = projections.get(palace_id, {"units": []})
            projected_units = list(projection.get("units") or [])
            units_by_palace[palace_id] = [
                candidate_from_projection(
                    palace_id=palace_id,
                    nodes=nodes,
                    projection=item,
                )
                for item in projected_units
            ]
            due_by_palace[palace_id] = {
                uid
                for item in projected_units
                if item.get("due")
                for uid in item.get("node_uids") or []
            }
            mastery_by_palace[palace_id] = (
                sum(int(item.get("stage_index") or 0) for item in projected_units)
                / max(1, len(projected_units) * 8)
            )

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
        mastery_rows = list_mastery_profiles_for_palaces(
            session,
            palace_ids=quiz_filter,
        )
        mastery_by_question = {
            int(row["question_id"]): row
            for row in mastery_rows
            if row.get("question_id") is not None
        }
        for question in questions:
            qid = int(question.get("id") or 0)
            palace_id = int(question.get("palace_id") or 0)
            if qid <= 0 or palace_id <= 0:
                continue
            if palace_ids and palace_id not in palace_meta:
                continue
            mastery = mastery_by_question.get(qid) or {}
            raw_score = mastery.get("score")
            score = float(raw_score if raw_score is not None else 0.35)
            label = str(mastery.get("label") or "unseen")
            quizzes.append(
                QuizCandidate(
                    question_id=qid,
                    palace_id=palace_id,
                    bound_node_uids=tuple(bound_map.get(qid) or ()),
                    mastery_score=score,
                    mastery_label=label,
                    question=question,
                )
            )
            if palace_id not in palace_meta:
                palace_meta[palace_id] = {
                    "title": str(question.get("palace_title") or f"宫殿 {palace_id}"),
                }

    nodes_by_palace = {
        int(tree["palace_id"]): tree.get("nodes") or {}
        for tree in trees
    }

    def subset(mapping: dict[int, Any], ids: list[int]) -> dict[int, Any]:
        allowed = set(ids) if ids else set(mapping)
        return {key: value for key, value in mapping.items() if key in allowed}

    def stream_config(stream_name: str) -> dict[str, Any]:
        raw = stream_configs.get(stream_name) if isinstance(stream_configs, dict) else {}
        raw = raw if isinstance(raw, dict) else {}
        ids = stream_ids.get(stream_name, [])
        if stream_name in {"memory_palace", "english"}:
            return {
                **config,
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "specific_palace_ids": ids,
                "subject_scope": stream_subjects.get(stream_name, "all"),
                "palace_order": raw.get("palace_order") or "finish_palace_then_next",
                "due_policy": raw.get("due_policy") or "due_first_then_expand",
                "unit_order": raw.get("unit_order") or "structured",
                "queue_length": 100,
            }
        return {
            **config,
            "content": {"mindmap_branch": False, "anki_card": False, "quiz_question": True},
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
        scoped_ids = stream_ids.get(stream_name) or palace_ids
        result = assemble_queue(
            config=stream_config(stream_name),
            palace_meta=subset(palace_meta, scoped_ids),
            units_by_palace=subset(units_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            due_by_palace=subset(due_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            mastery_by_palace=subset(mastery_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
            recent_practice_rank=subset(recent_practice_rank, scoped_ids),
            quizzes=quizzes if stream_name == "quiz" else [],
            completed_ids=completed_ids or [],
            hidden_ids=hidden_ids or [],
            operation_id=f"{op_id}:{stream_name}",
            nodes_by_palace=subset(nodes_by_palace, scoped_ids) if stream_name in {"memory_palace", "english"} else {},
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
    queue_length = int(config.get("queue_length") or 20)
    limited = remaining[:queue_length]
    phase_stats = {
        "candidate_count": len(remaining),
        "scheduled_count": len(limited),
        "queue_limit": queue_length,
        "limit_reached": len(remaining) > len(limited),
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
        leftover_due_by_palace(remaining, limited),
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
            "queue_limit": queue_length,
            "limit_reached": len(remaining) > len(limited),
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
