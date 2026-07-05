from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Config
from memory_anki.modules.settings.application.ai_prompt_templates import (
    ENGLISH_READING_GENERATE_PROMPT,
    IMPORT_BATCH_MINDMAP_PROMPT,
    IMPORT_IMAGE_MINDMAP_PROMPT,
    IMPORT_IMAGE_TEXT_PROMPT,
    MINDMAP_AI_SPLIT_SYSTEM_PROMPT,
    PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT,
    PALACE_QUIZ_GENERATE_PROMPT,
    PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT,
    PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT,
)

PROMPT_CONFIG_KEYS = (
    "ai_prompt_import_image_mindmap",
    "ai_prompt_import_image_text",
    "ai_prompt_import_batch_mindmap",
    "ai_prompt_mindmap_ai_split_system",
    "ai_prompt_palace_quiz_generate",
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace",
    "ai_prompt_palace_quiz_group_by_mini_palace",
    "ai_prompt_palace_quiz_short_answer_feedback",
    "ai_prompt_english_reading_generate",
)

PROMPT_KEY_ALIASES = {
    "import_text_ocr": "ai_prompt_import_image_text",
    "ai_prompt_english_reading_adapt_sentence": "ai_prompt_english_reading_generate",
    "ai_prompt_english_reading_classify_words": "ai_prompt_english_reading_generate",
}

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


_DEFAULT_BATCH_PROMPT_TEMPLATE = (
    f"{IMPORT_BATCH_MINDMAP_PROMPT}\n\n"
    "下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：\n"
    "{{structure_tree_json}}\n\n"
    "接下来会按顺序提供结构图和正文图片。请综合所有图片后输出增强后的完整脑图 JSON。"
)

_DEFAULT_PALACE_QUIZ_GENERATE_TEMPLATE = PALACE_QUIZ_GENERATE_PROMPT

_DEFAULT_PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_TEMPLATE = (
    PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT
)

_DEFAULT_PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_TEMPLATE = (
    PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT
)

_DEFAULT_PALACE_QUIZ_GROUP_BY_MINI_PALACE_TEMPLATE = (
    PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT
)

PROMPT_DEFINITIONS: dict[str, PromptTemplateDefinition] = {
    "ai_prompt_import_image_mindmap": PromptTemplateDefinition(
        key="ai_prompt_import_image_mindmap",
        label="图片转脑图（兼容）",
        description="旧版单图脑图提示词键。当前推荐使用 PDF 直接生成语义，保留此键仅用于兼容。",
        default_template=IMPORT_IMAGE_MINDMAP_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_import_image_text": PromptTemplateDefinition(
        key="ai_prompt_import_image_text",
        label="图片转文字",
        description="图片/PDF OCR 的基础纯文本提示词。PDF 页码范围提示会在运行时追加。",
        default_template=IMPORT_IMAGE_TEXT_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_import_batch_mindmap": PromptTemplateDefinition(
        key="ai_prompt_import_batch_mindmap",
        label="多图转脑图（兼容）",
        description="批量图片导入脑图时的结构补全提示词。",
        default_template=_DEFAULT_BATCH_PROMPT_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
        available_placeholders=(
            _placeholder("structure_tree_json", "结构图提取出的原始脑图 JSON。"),
        ),
        required_placeholders=("structure_tree_json",),
    ),
    "ai_prompt_mindmap_ai_split_system": PromptTemplateDefinition(
        key="ai_prompt_mindmap_ai_split_system",
        label="AI 分卡系统提示词",
        description="脑图 AI 分卡发送给文本模型的系统提示词。",
        default_template=MINDMAP_AI_SPLIT_SYSTEM_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split/contracts.py",
    ),
    "ai_prompt_palace_quiz_generate": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_generate",
        label="宫殿做题生成",
        description="基于 PDF 页面或图片资料生成宫殿配套习题时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_GENERATE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_classify_existing_to_mini_palace",
        label="宫殿题库归类到小宫殿",
        description="把现有大宫殿题目按小宫殿语义归类时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_group_by_mini_palace": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_group_by_mini_palace",
        label="生成题目按小宫殿分组",
        description="把视觉模型刚生成的题目草稿按小宫殿语义分组时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_GROUP_BY_MINI_PALACE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_short_answer_feedback": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_short_answer_feedback",
        label="宫殿简答题点评",
        description="为宫殿简答题的学生作答生成 AI 点评时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_english_reading_generate": PromptTemplateDefinition(
        key="ai_prompt_english_reading_generate",
        label="英语阅读单次生成",
        description="一次性完成未识别词形补全与句子 i+1 改写。运行时会在末尾追加输入数据 JSON。",
        default_template=ENGLISH_READING_GENERATE_PROMPT,
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
}


class AiPromptValidationError(ValueError):
    pass


def _normalize_template(value: str) -> str:
    return str(value or "").replace("\r\n", "\n").strip()


def _get_template_override_map(session: Session) -> dict[str, str]:
    rows = session.query(Config).filter(Config.key.in_(PROMPT_CONFIG_KEYS)).all()
    return {row.key: row.value for row in rows}


def _definition_for(key: str) -> PromptTemplateDefinition:
    key = PROMPT_KEY_ALIASES.get(key, key)
    definition = PROMPT_DEFINITIONS.get(key)
    if definition is None:
        raise AiPromptValidationError(f"未知的提示词键：{key}")
    return definition


def _extract_placeholders(template: str) -> set[str]:
    return {match.group(1) for match in PLACEHOLDER_PATTERN.finditer(template)}


def validate_prompt_template(key: str, template: str) -> str:
    key = PROMPT_KEY_ALIASES.get(key, key)
    definition = _definition_for(key)
    normalized_template = _normalize_template(template)
    placeholders = _extract_placeholders(normalized_template)
    allowed = {item.name for item in definition.available_placeholders}
    unknown = sorted(name for name in placeholders if name not in allowed)
    if unknown:
        raise AiPromptValidationError(f"{definition.label} 含有未知占位符：{', '.join(unknown)}")
    missing = sorted(name for name in definition.required_placeholders if name not in placeholders)
    if missing:
        raise AiPromptValidationError(f"{definition.label} 缺少必填占位符：{', '.join(missing)}")
    return normalized_template


def get_prompt_template(session: Session | None, key: str) -> str:
    key = PROMPT_KEY_ALIASES.get(key, key)
    definition = _definition_for(key)
    if session is None:
        return definition.default_template
    overrides = _get_template_override_map(session)
    return _normalize_template(overrides.get(key) or definition.default_template)


def list_prompt_templates(session: Session) -> list[dict[str, Any]]:
    overrides = _get_template_override_map(session)
    items: list[dict[str, Any]] = []
    for key in PROMPT_CONFIG_KEYS:
        definition = _definition_for(key)
        current_template = _normalize_template(overrides.get(key) or definition.default_template)
        items.append(
            {
                "key": definition.key,
                "label": definition.label,
                "description": definition.description,
                "template": current_template,
                "default_template": definition.default_template,
                "is_customized": key in overrides
                and _normalize_template(overrides[key])
                != _normalize_template(definition.default_template),
                "source_location": definition.source_location,
                "required_placeholders": list(definition.required_placeholders),
                "available_placeholders": [
                    {"name": item.name, "description": item.description}
                    for item in definition.available_placeholders
                ],
            }
        )
    return items


def save_prompt_templates(session: Session, templates: dict[str, str]) -> list[dict[str, Any]]:
    for key, value in templates.items():
        normalized_value = validate_prompt_template(key, value)
        row = session.query(Config).filter_by(key=key).first()
        if row:
            row.value = normalized_value
            row.updated_at = utc_now_naive()
        else:
            session.add(Config(key=key, value=normalized_value))
    session.commit()
    return list_prompt_templates(session)


def reset_prompt_templates(
    session: Session,
    *,
    keys: list[str] | None = None,
) -> list[dict[str, Any]]:
    target_keys = keys or list(PROMPT_CONFIG_KEYS)
    for key in target_keys:
        _definition_for(key)
    (session.query(Config).filter(Config.key.in_(target_keys)).delete(synchronize_session=False))
    session.commit()
    return list_prompt_templates(session)


def render_prompt(
    key: str, variables: dict[str, Any] | None = None, *, session: Session | None = None
) -> str:
    template = get_prompt_template(session, key)
    variables = variables or {}

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in variables:
            return ""
        value = variables[name]
        return "" if value is None else str(value)

    return PLACEHOLDER_PATTERN.sub(_replace, template).strip()


def build_import_batch_prompt(
    *,
    structure_tree: dict[str, Any],
    session: Session | None = None,
) -> str:
    return render_prompt(
        "ai_prompt_import_batch_mindmap",
        {
            "structure_tree_json": json.dumps(structure_tree, ensure_ascii=False),
        },
        session=session,
    )
