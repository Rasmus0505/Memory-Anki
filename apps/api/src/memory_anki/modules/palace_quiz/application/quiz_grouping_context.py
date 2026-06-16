"""Mini-palace grouping context builders."""

from __future__ import annotations

from typing import Any

from memory_anki.modules.palaces.application.mini_palace_service import (
    parse_mini_palace_node_uids,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    collect_doc_nodes_with_descendants,
)


def build_mini_palace_context(palace: Any) -> list[dict[str, Any]]:
    _, labels = collect_doc_nodes_with_descendants(getattr(palace, "editor_doc", None))
    contexts: list[dict[str, Any]] = []
    for mini_palace in getattr(palace, "mini_palaces", []) or []:
        node_uids = parse_mini_palace_node_uids(getattr(mini_palace, "node_uids_json", None))
        node_texts = [labels.get(uid, uid) for uid in node_uids if labels.get(uid, uid)]
        contexts.append(
            {
                "mini_palace_id": mini_palace.id,
                "name": mini_palace.name,
                "node_uids": node_uids,
                "node_texts": node_texts[:24],
                "node_text_summary": "；".join(node_texts[:12]),
            }
        )
    return contexts


def question_payload_for_grouping(question: dict[str, Any], index: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "question_index": index,
        "question_type": question.get("question_type"),
        "stem": question.get("stem"),
        "analysis": question.get("analysis"),
    }
    if question.get("question_type") == "multiple_choice":
        payload["options"] = question.get("options") or []
        payload["correct_option_id"] = (
            question.get("answer_payload", {}) or {}
        ).get("correct_option_id")
    else:
        payload["reference_answer"] = (
            question.get("answer_payload", {}) or {}
        ).get("reference_answer")
    return payload


__all__ = [
    "build_mini_palace_context",
    "question_payload_for_grouping",
]
