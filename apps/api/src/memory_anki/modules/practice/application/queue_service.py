"""Freestyle immersive queue composition through public context facades."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import list_active_palace_tree_structures
from memory_anki.modules.memory.public.queries import get_palace_memory_projection, list_due_nodes
from memory_anki.modules.quiz.public.queries import (
    list_mastery_profiles_for_palaces,
    list_node_bindings_for_palaces,
    list_published_questions_for_palaces,
)

from ..domain.feed_config import sanitize_feed_config
from ..domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
    build_palace_units,
)


def build_freestyle_queue(
    session: Session,
    *,
    config_raw: dict[str, Any] | None,
    operation_id: str,
    completed_ids: list[str] | None = None,
    hidden_ids: list[str] | None = None,
) -> dict[str, Any]:
    config = sanitize_feed_config(config_raw or {})
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")

    specific_ids = list(config.get("specific_palace_ids") or [])
    trees = list_active_palace_tree_structures(
        session,
        palace_ids=specific_ids or None,
    )
    # Drop trees with no root / no stable nodes.
    trees = [tree for tree in trees if tree.get("root_uid") and tree.get("nodes")]
    palace_ids = [int(tree["palace_id"]) for tree in trees]

    palace_meta: dict[int, dict[str, Any]] = {}
    units_by_palace: dict[int, list[Any]] = {}
    due_by_palace: dict[int, set[str]] = {}
    mastery_by_palace: dict[int, float] = {}
    recent_practice_rank: dict[int, int] = {}

    for tree in trees:
        palace_id = int(tree["palace_id"])
        palace_meta[palace_id] = {
            "title": str(tree.get("title") or ""),
        }
        units_by_palace[palace_id] = build_palace_units(
            palace_id=palace_id,
            nodes=tree["nodes"],
            root_uid=tree.get("root_uid"),
            node_limit=int(config["node_limit"]),
            within_palace_order=str(config["within_palace_order"]),
            seed=int(config["seed"]),
        )
        try:
            # Progress scopes select which memory buckets enter freestyle units
            # (overdue / due / calendar_today / reinforcement / new).
            due_by_palace[palace_id] = set(
                list_due_nodes(
                    session,
                    palace_id,
                    progress_scopes=list(config.get("progress_scopes") or []),
                )
            )
        except ValueError:
            due_by_palace[palace_id] = set()
        try:
            projection = get_palace_memory_projection(session, palace_id)
            mastery_by_palace[palace_id] = float(projection.get("mastery_progress") or 0.5)
        except ValueError:
            mastery_by_palace[palace_id] = 0.5

    # Quiz projections only when enabled.
    quizzes: list[QuizCandidate] = []
    if config["content"].get("quiz_question"):
        questions = list_published_questions_for_palaces(
            session,
            palace_ids=palace_ids or None,
            question_type=str(config.get("question_type") or "all"),
        )
        bindings = list_node_bindings_for_palaces(session, palace_ids=palace_ids or None)
        bound_map: dict[int, list[str]] = {}
        for row in bindings:
            qid = int(row["question_id"])
            bound_map.setdefault(qid, []).append(str(row["node_uid"]))
        mastery_rows = list_mastery_profiles_for_palaces(
            session,
            palace_ids=palace_ids or None,
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

    result = assemble_queue(
        config=config,
        palace_meta=palace_meta,
        units_by_palace=units_by_palace,
        due_by_palace=due_by_palace,
        mastery_by_palace=mastery_by_palace,
        recent_practice_rank=recent_practice_rank,
        quizzes=quizzes,
        completed_ids=completed_ids or [],
        hidden_ids=hidden_ids or [],
        operation_id=op_id,
        nodes_by_palace=nodes_by_palace,
    )

    return {
        "operation_id": result.operation_id,
        "config": config,
        "cards": result.cards,
        "phase_stats": result.phase_stats,
        "counts": {
            "mindmap_branch": sum(1 for card in result.cards if card.get("type") == "mindmap_branch"),
            "anki_card": sum(1 for card in result.cards if card.get("type") == "anki_card"),
            "quiz_question": sum(1 for card in result.cards if card.get("type") == "quiz_question"),
            "total": len(result.cards),
        },
    }


__all__ = ["build_freestyle_queue"]
