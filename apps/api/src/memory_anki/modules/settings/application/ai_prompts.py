from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.settings.application.ai_prompt_templates import (
    AI_LEARNING_WORKBENCH_PROMPT,
    BATCH_PALACE_GENERATION_PROMPT,
    BATCH_QUIZ_GENERATION_PROMPT,
    ENGLISH_READING_GENERATE_PROMPT,
    ENGLISH_TRANSLATION_BATCH_PROMPT,
    ENGLISH_TRANSLATION_SINGLE_PROMPT,
    IMPORT_DOCUMENT_MINDMAP_PROMPT,
    IMPORT_IMAGE_MINDMAP_PROMPT,
    IMPORT_IMAGE_TEXT_PROMPT,
    IMPORT_OCR_MINDMAP_FORMAT_PROMPT,
    MINDMAP_AI_SPLIT_SYSTEM_PROMPT,
    PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT,
    PALACE_QUIZ_GENERATE_PROMPT,
    PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT,
    PALACE_QUIZ_NODE_BINDING_PROMPT,
    PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT,
    PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT,
    PEG_ASSOCIATION_PROMPT,
    build_palace_quiz_generation_user_text,
    build_palace_quiz_review_mindmap_prompt,
    build_palace_quiz_text_formatting_prompt,
)

PROMPT_CONFIG_KEYS = (
    "ai_prompt_import_image_mindmap",
    "ai_prompt_import_image_text",
    "ai_prompt_import_document_mindmap",
    "ai_prompt_import_ocr_mindmap_format",
    "ai_prompt_mindmap_ai_split_system",
    "ai_prompt_peg_association",
    "ai_prompt_ai_learning_workbench",
    "ai_prompt_batch_palace_generation",
    "ai_prompt_batch_quiz_generation",
    "ai_prompt_palace_quiz_generate",
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace",
    "ai_prompt_palace_quiz_group_by_mini_palace",
    "ai_prompt_palace_quiz_node_binding",
    "ai_prompt_palace_quiz_short_answer_feedback",
    "ai_prompt_palace_quiz_source_pair_transcription",
    "ai_prompt_palace_quiz_generation_user_text",
    "ai_prompt_palace_quiz_source_pair_user_text",
    "ai_prompt_palace_quiz_text_formatting",
    "ai_prompt_palace_quiz_review_mindmap",
    "ai_prompt_english_reading_generate",
    "ai_prompt_english_reading_word_explain",
    "ai_prompt_english_reading_sentence_explain",
    "ai_prompt_english_reading_target_article",
    "ai_prompt_english_translation_batch",
    "ai_prompt_english_translation_single",
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


_DEFAULT_PALACE_QUIZ_GENERATE_TEMPLATE = PALACE_QUIZ_GENERATE_PROMPT

_DEFAULT_PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_TEMPLATE = PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT

_DEFAULT_PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_TEMPLATE = (
    PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT
)

_DEFAULT_PALACE_QUIZ_GROUP_BY_MINI_PALACE_TEMPLATE = PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT
_DEFAULT_PALACE_QUIZ_NODE_BINDING_TEMPLATE = PALACE_QUIZ_NODE_BINDING_PROMPT

PROMPT_DEFINITIONS: dict[str, PromptTemplateDefinition] = {
    "ai_prompt_import_image_mindmap": PromptTemplateDefinition(
        key="ai_prompt_import_image_mindmap",
        label="图片转脑图（兼容）",
        description="兼容旧配置键；运行时为「识别全文 → 整理 JSON」。",
        default_template=IMPORT_IMAGE_MINDMAP_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_import_image_text": PromptTemplateDefinition(
        key="ai_prompt_import_image_text",
        label="图片转文字",
        description="阶段 A：识别上传页全部文字。",
        default_template=IMPORT_IMAGE_TEXT_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_import_document_mindmap": PromptTemplateDefinition(
        key="ai_prompt_import_document_mindmap",
        label="教材转脑图（兼容）",
        description="兼容旧配置键；主路径已改为先识别全文再整理 JSON。",
        default_template=IMPORT_DOCUMENT_MINDMAP_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/runtime.py",
    ),
    "ai_prompt_import_ocr_mindmap_format": PromptTemplateDefinition(
        key="ai_prompt_import_ocr_mindmap_format",
        label="识别原文整理脑图",
        description="阶段 B：按范围删除多余内容并输出脑图 JSON。",
        default_template=IMPORT_OCR_MINDMAP_FORMAT_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/runtime.py",
        available_placeholders=(
            _placeholder("target_title", "当前宫殿的目标章节标题；占位标题时为空。"),
            _placeholder("ocr_text", "带页码标记的已识别全文。"),
        ),
        required_placeholders=("target_title", "ocr_text"),
    ),
    "ai_prompt_mindmap_ai_split_system": PromptTemplateDefinition(
        key="ai_prompt_mindmap_ai_split_system",
        label="AI 分卡系统提示词",
        description="脑图 AI 分卡（原位替换叶节点）的系统提示词；默认由场景组合块编译，此完整模板仅用于兼容旧路径。",
        default_template=MINDMAP_AI_SPLIT_SYSTEM_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split/contracts.py",
    ),
    "ai_prompt_peg_association": PromptTemplateDefinition(
        key="ai_prompt_peg_association",
        label="记忆桩联想建议",
        description="根据记忆桩和知识点生成可挂载的联想建议。",
        default_template=PEG_ASSOCIATION_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/peg_association_service.py",
    ),
    "ai_prompt_ai_learning_workbench": PromptTemplateDefinition(
        key="ai_prompt_ai_learning_workbench",
        label="复习 AI 学习工作台",
        description="复习中的提问、讲解、出题和纠错共用提示词。",
        default_template=AI_LEARNING_WORKBENCH_PROMPT,
        source_location="apps/api/src/memory_anki/modules/ai_learning/application/service.py",
        available_placeholders=(
            _placeholder("task_instruction", "当前学习任务的专用要求。"),
        ),
        required_placeholders=("task_instruction",),
    ),
    "ai_prompt_batch_palace_generation": PromptTemplateDefinition(
        key="ai_prompt_batch_palace_generation",
        label="整本教材批量生成宫殿",
        description="整本教材工作区按章节生成宫殿草稿。",
        default_template=BATCH_PALACE_GENERATION_PROMPT,
        source_location="apps/api/src/memory_anki/modules/batch_generation/application/workspace_service.py",
    ),
    "ai_prompt_batch_quiz_generation": PromptTemplateDefinition(
        key="ai_prompt_batch_quiz_generation",
        label="整本教材批量生成题目",
        description="整本教材工作区按章节生成题目草稿。",
        default_template=BATCH_QUIZ_GENERATION_PROMPT,
        source_location="apps/api/src/memory_anki/modules/batch_generation/application/workspace_service.py",
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
        label="宫殿题库归类到学习组",
        description="把现有大宫殿题目按学习组语义归类时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_group_by_mini_palace": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_group_by_mini_palace",
        label="生成题目按学习组分组",
        description="把视觉模型刚生成的题目草稿按学习组语义分组时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_GROUP_BY_MINI_PALACE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_node_binding": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_node_binding",
        label="题库结合（题目绑定知识点）",
        description="把宫殿题库题目绑定到思维导图知识点卡片时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_NODE_BINDING_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_short_answer_feedback": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_short_answer_feedback",
        label="宫殿简答题点评",
        description="为宫殿简答题的学生作答生成 AI 点评时使用的系统提示词。",
        default_template=_DEFAULT_PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
    ),
    "ai_prompt_palace_quiz_source_pair_transcription": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_source_pair_transcription",
        label="宫殿做题题目答案配对",
        description="区分题目来源与答案来源时使用的严格抄录系统提示词。",
        default_template=PALACE_QUIZ_SOURCE_PAIR_TRANSCRIPTION_PROMPT,
    ),
    "ai_prompt_palace_quiz_generation_user_text": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_generation_user_text",
        label="宫殿做题生成用户指令",
        description="普通资料生成题目时的用户消息模板。",
        default_template=build_palace_quiz_generation_user_text(
            source_label="{{source_label}}",
            is_source_pair_transcription=False,
        ),
        available_placeholders=(_placeholder("source_label", "当前资料来源标签。"),),
        required_placeholders=("source_label",),
    ),
    "ai_prompt_palace_quiz_source_pair_user_text": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_source_pair_user_text",
        label="宫殿做题配对用户指令",
        description="题目来源与答案来源配对时的用户消息模板。",
        default_template=build_palace_quiz_generation_user_text(
            source_label="{{source_label}}",
            is_source_pair_transcription=True,
        ),
        available_placeholders=(_placeholder("source_label", "当前资料来源标签。"),),
        required_placeholders=("source_label",),
    ),
    "ai_prompt_palace_quiz_text_formatting": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_text_formatting",
        label="宫殿题库文本整理",
        description="将文本、Markdown 或半结构数据整理为题库 JSON。",
        default_template=build_palace_quiz_text_formatting_prompt("{{extra_prompt}}"),
        available_placeholders=(_placeholder("extra_prompt", "用户补充要求。"),),
    ),
    "ai_prompt_palace_quiz_review_mindmap": PromptTemplateDefinition(
        key="ai_prompt_palace_quiz_review_mindmap",
        label="复习脑图出题",
        description="根据复习脑图和关联宫殿摘要生成题目。",
        default_template=build_palace_quiz_review_mindmap_prompt(),
    ),
    "ai_prompt_english_translation_batch": PromptTemplateDefinition(
        key="ai_prompt_english_translation_batch",
        label="英语课程批量翻译",
        description="英语课程生成时按稳定句子编号批量翻译。",
        default_template=ENGLISH_TRANSLATION_BATCH_PROMPT,
        available_placeholders=(_placeholder("source_text", "带稳定编号的英文句子。"),),
        required_placeholders=("source_text",),
    ),
    "ai_prompt_english_translation_single": PromptTemplateDefinition(
        key="ai_prompt_english_translation_single",
        label="英语课程单句翻译",
        description="批量翻译结果不匹配时的单句降级翻译。",
        default_template=ENGLISH_TRANSLATION_SINGLE_PROMPT,
        available_placeholders=(_placeholder("source_text", "待翻译的单句英文。"),),
        required_placeholders=("source_text",),
    ),
    "ai_prompt_english_reading_generate": PromptTemplateDefinition(
        key="ai_prompt_english_reading_generate",
        label="英语阅读单次生成",
        description="一次性完成未识别词形补全与句子 i+1 改写。运行时会在末尾追加输入数据 JSON。",
        default_template=ENGLISH_READING_GENERATE_PROMPT,
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    "ai_prompt_english_reading_word_explain": PromptTemplateDefinition(
        key="ai_prompt_english_reading_word_explain",
        label="英语阅读词语英文解释",
        description="按用户 CEFR 用纯英文解释词语在上下文中的含义和常见用法。",
        default_template="""Return one JSON object only. Every string value must be plain English at CEFR {{cefr}} or easier. Never use Chinese characters.

Target word: {{target}}
Context: {{context}}

Required shape:
{"meaningHere":"one short English gloss for this context","otherCommonUses":[{"partOfSpeech":"noun|verb|adjective|adverb","meaning":"English meaning","example":"short English example"}]}

Rules:
1. Use exact camelCase keys: meaningHere, otherCommonUses, partOfSpeech, meaning, example.
2. otherCommonUses may be an empty array.
3. Do not wrap the object in markdown or another field such as data/result.
4. Do not include Chinese, bilingual notes, or pinyin.""",
        available_placeholders=(
            _placeholder("cefr", "用户手动选择的 CEFR。"),
            _placeholder("target", "目标词语。"),
            _placeholder("context", "目标所在上下文。"),
        ),
        required_placeholders=("cefr", "target", "context"),
    ),
    "ai_prompt_english_reading_sentence_explain": PromptTemplateDefinition(
        key="ai_prompt_english_reading_sentence_explain",
        label="英语阅读句子英文讲解",
        description="按用户 CEFR 用纯英文解释句意和句法关系。",
        default_template="""Return one JSON object only. Every string value must be plain English at CEFR {{cefr}} or easier. Never use Chinese characters.

Sentence: {{target}}
Context: {{context}}

Required shape:
{"englishExplanation":"simple English paraphrase","howItWorks":[{"part":"phrase from the sentence","role":"subject|verb|object|modifier","explanation":"how this part works in English"}]}

Rules:
1. Use exact camelCase keys: englishExplanation, howItWorks, part, role, explanation.
2. howItWorks may be an empty array.
3. Do not wrap the object in markdown or another field such as data/result.
4. Do not include Chinese, bilingual notes, or pinyin.""",
        available_placeholders=(
            _placeholder("cefr", "用户手动选择的 CEFR。"),
            _placeholder("target", "目标句子。"),
            _placeholder("context", "目标所在上下文。"),
        ),
        required_placeholders=("cefr", "target", "context"),
    ),
    "ai_prompt_english_reading_target_article": PromptTemplateDefinition(
        key="ai_prompt_english_reading_target_article",
        label="英语阅读定向文章",
        description="围绕所选词句生成纯英文可理解输入文章和覆盖报告。",
        default_template="""Return JSON only and use English only. Write a natural {{genre}} article of about {{word_count}} words at CEFR {{cefr}}. Topic: {{topic}}. Syntax density: {{syntax_density}}. Word targets should appear naturally about {{word_repetitions}} times. Sentence targets must become about {{sentence_variants}} different structural variants, not copied sentences. Targets: {{targets_json}}. Return {\"title\": \"...\", \"content\": \"...\", \"coverage\": {\"targets\": [{\"id\": 1, \"uses\": 3, \"note\": \"...\"}]}}.""",
        available_placeholders=(
            _placeholder("cefr", "用户手动选择的 CEFR。"),
            _placeholder("word_count", "目标篇幅。"),
            _placeholder("genre", "文章文体。"),
            _placeholder("topic", "主题要求。"),
            _placeholder("syntax_density", "句法密度。"),
            _placeholder("word_repetitions", "词汇复现次数。"),
            _placeholder("sentence_variants", "句式变体次数。"),
            _placeholder("targets_json", "目标列表 JSON。"),
        ),
        required_placeholders=("cefr", "word_count", "genre", "topic", "syntax_density", "word_repetitions", "sentence_variants", "targets_json"),
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
    from memory_anki.infrastructure.db._tables.misc import AiPromptVersion

    from .ai_prompt_versions import ensure_prompt_versions

    ensure_prompt_versions(session)
    from .ai_prompt_composition import PROMPT_SCENE_BINDINGS, compile_prompt_for_key

    overrides = _get_template_override_map(session)
    items: list[dict[str, Any]] = []
    for key in PROMPT_CONFIG_KEYS:
        definition = _definition_for(key)
        compiled = compile_prompt_for_key(key, session=session)
        current_template = _normalize_template(compiled["text"])
        default_compiled = compile_prompt_for_key(key, session=None)
        active_version = (
            session.query(AiPromptVersion)
            .filter_by(prompt_key=key, status="active")
            .order_by(AiPromptVersion.activated_at.desc())
            .first()
        )
        latest_candidate = (
            session.query(AiPromptVersion)
            .filter(
                AiPromptVersion.prompt_key == key,
                AiPromptVersion.status.in_(("candidate", "passed", "failed")),
            )
            .order_by(AiPromptVersion.created_at.desc())
            .first()
        )
        items.append(
            {
                "key": definition.key,
                "label": definition.label,
                "description": definition.description,
                "template": current_template,
                "default_template": default_compiled["text"],
                "is_customized": key in overrides
                and _normalize_template(overrides[key])
                != _normalize_template(definition.default_template),
                "source_location": definition.source_location,
                "required_placeholders": list(definition.required_placeholders),
                "active_version_id": active_version.id if active_version else None,
                "candidate_version": (
                    {
                        "id": latest_candidate.id,
                        "status": latest_candidate.status,
                        "eval_summary": json.loads(latest_candidate.eval_summary_json or "{}"),
                    }
                    if latest_candidate
                    else None
                ),
                "available_placeholders": [
                    {"name": item.name, "description": item.description}
                    for item in definition.available_placeholders
                ],
                "scene_key": PROMPT_SCENE_BINDINGS.get(key),
                "composition": compiled,
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


