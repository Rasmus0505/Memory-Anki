from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.settings.application.ai_prompt_templates import (
    ENGLISH_TRANSLATION_BATCH_PROMPT,
    PEG_ASSOCIATION_PROMPT,
)

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


@dataclass(frozen=True)
class PromptPlaceholder:
    name: str
    description: str


@dataclass(frozen=True)
class PromptTemplateDefinition:
    key: str
    label: str
    description: str
    default_template: str
    source_location: str = ""
    available_placeholders: tuple[PromptPlaceholder, ...] = ()
    required_placeholders: tuple[str, ...] = ()


def _placeholder(name: str, description: str) -> PromptPlaceholder:
    return PromptPlaceholder(name=name, description=description)


PROMPT_DEFINITIONS: dict[str, PromptTemplateDefinition] = {
    'ai_prompt_peg_association': PromptTemplateDefinition(
        key="ai_prompt_peg_association",
        label="记忆桩联想建议",
        description="根据记忆桩和知识点生成可挂载的联想建议。",
        default_template=PEG_ASSOCIATION_PROMPT,
        source_location="apps/api/src/memory_anki/modules/content/application/peg_association_service.py",
    ),
    'ai_prompt_english_translation_batch': PromptTemplateDefinition(
        key="ai_prompt_english_translation_batch",
        label="英语课程批量翻译",
        description="英语课程生成时按稳定句子编号批量翻译。",
        default_template=ENGLISH_TRANSLATION_BATCH_PROMPT,
        available_placeholders=(_placeholder("source_text", "带稳定编号的英文句子。"),),
        required_placeholders=("source_text",),
    ),
    'ai_prompt_asr_course_transcription': PromptTemplateDefinition(
        key="ai_prompt_asr_course_transcription",
        label="英语课程音频转写",
        description="课程音视频转写由 ASR 模型完成，此键只保留场景登记。",
        default_template="英语课程音频转写使用 ASR 模型，不额外拼接文本提示词。",
    ),
}


class AiPromptValidationError(ValueError):
    pass


def _normalize_template(value: str) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _get_template_override_map(session: Session) -> dict[str, str]:
    rows = session.query(Config).all()
    return {row.key: row.value for row in rows if row.key in PROMPT_DEFINITIONS}


def _definition_for(key: str) -> PromptTemplateDefinition:
    definition = PROMPT_DEFINITIONS.get(key)
    if definition is None:
        raise AiPromptValidationError(f"未知的提示词键：{key}")
    return definition


def _extract_placeholders(template: str) -> set[str]:
    return {match.group(1) for match in PLACEHOLDER_PATTERN.finditer(template)}


def get_prompt_template(session: Session | None, key: str) -> str:
    definition = _definition_for(key)
    if session is None:
        return definition.default_template
    overrides = _get_template_override_map(session)
    return _normalize_template(overrides.get(key) or definition.default_template)


def render_prompt(
    key: str, variables: dict[str, Any] | None = None, *, session: Session | None = None
) -> str:
    from .ai_prompt_composition import compile_prompt_for_key

    compiled = compile_prompt_for_key(key, variables, session=session)
    template = compiled["text"]
    variables = variables or {}

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in variables:
            return ""
        value = variables[name]
        return "" if value is None else str(value)

    return PLACEHOLDER_PATTERN.sub(_replace, template).strip()
