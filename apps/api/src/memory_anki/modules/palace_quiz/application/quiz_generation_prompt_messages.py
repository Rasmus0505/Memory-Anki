"""Prompt and multimodal message builders for quiz generation."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.palaces.application.mindmap_import.model_io import (
    build_image_content_part,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt
from memory_anki.modules.settings.application.ai_prompt_templates import (
    PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT,
    build_palace_quiz_generation_user_text,
)


def build_generation_messages(
    *,
    session: Session,
    extra_prompt: str,
    source_label: str,
    image_items: list[tuple[bytes, str | None]],
    source_context: str | None = None,
    prompt_override: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    is_pdf_question_answer_pairing = bool(
        source_context
        and "题目来源" in source_context
        and "答案与解析来源" in source_context
    )
    system_prompt = (
        PALACE_QUIZ_PDF_TRANSCRIPTION_PROMPT
        if is_pdf_question_answer_pairing
        else render_prompt("ai_prompt_palace_quiz_generate", {}, session=session)
    )
    if prompt_override and str(prompt_override).strip():
        system_prompt = str(prompt_override).strip()
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": build_palace_quiz_generation_user_text(
                source_label=source_label,
                is_pdf_question_answer_pairing=is_pdf_question_answer_pairing,
            ),
        }
    ]
    if source_context:
        user_content.append({"type": "text", "text": source_context})
    if is_pdf_question_answer_pairing:
        user_content.append(
            {
                "type": "text",
                "text": (
                    "请严格按接下来图片出现的顺序处理。"
                    "每张图片只能写入它在上方“图片顺序与角色绑定”里指定的候选池。"
                    "如果某张图是题目来源，即使没有选项，只要题型标题或题面显示为简答题、论述题、材料分析题等主观题，"
                    "也必须写入 question_candidates。"
                ),
            }
        )
    for image_bytes, filename in image_items:
        user_content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    normalized_extra_prompt = str(extra_prompt or "").strip()
    if normalized_extra_prompt:
        range_guard = ""
        if "只要" in normalized_extra_prompt or "仅" in normalized_extra_prompt:
            range_guard = (
                "\n如果材料中有不符合该范围限定的原题，必须直接跳过，不要改写成题目；"
                "最终 questions 数组只能包含满足限定范围的题目。"
            )
        messages.append(
            {
                "role": "system",
                "content": (
                    "用户临时补充要求必须优先严格遵守；如果补充要求限定范围，"
                    "不要生成范围外题目。\n"
                    f"{normalized_extra_prompt}{range_guard}"
                ),
            }
        )
    messages.append({"role": "user", "content": user_content})
    return messages, system_prompt


__all__ = ["build_generation_messages"]
