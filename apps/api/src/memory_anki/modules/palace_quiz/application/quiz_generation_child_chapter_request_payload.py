"""Payload assembly for child-chapter grouping requests."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_prompts import render_prompt

from .quiz_grouping_context import question_payload_for_grouping


def build_child_chapter_grouping_model_input(
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
) -> dict[str, Any]:
    return {
        "mini_palaces": child_contexts,
        "questions": [
            question_payload_for_grouping(question, index)
            for index, question in enumerate(drafts)
        ],
    }


def build_child_chapter_grouping_messages(
    *,
    session: Session,
    model_input: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    system_prompt = render_prompt(
        "ai_prompt_palace_quiz_group_by_mini_palace",
        {},
        session=session,
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages


__all__ = [
    "build_child_chapter_grouping_messages",
    "build_child_chapter_grouping_model_input",
]
