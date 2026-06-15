from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Config
from memory_anki.modules.palaces.application.mindmap_ai_split.contracts import (
    AI_SPLIT_SYSTEM_PROMPT,
)
from memory_anki.modules.palaces.application.mindmap_import.prompts import (
    format_page_numbers,
    truncate_prompt_text,
)
from memory_anki.modules.settings.application.ai_prompt_templates import (
    ENGLISH_READING_GENERATE_PROMPT,
    IMPORT_BATCH_MINDMAP_PROMPT,
    IMPORT_IMAGE_MINDMAP_PROMPT,
    IMPORT_IMAGE_TEXT_PROMPT,
    IMPORT_PDF_DIRECT_TEMPLATE,
    IMPORT_PDF_MERGE_TEMPLATE,
    IMPORT_PDF_PAGE_CONTEXT_PROMPT,
    IMPORT_PDF_STRUCTURE_TEMPLATE,
    PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_PROMPT,
    PALACE_QUIZ_GENERATE_PROMPT,
    PALACE_QUIZ_GROUP_BY_MINI_PALACE_PROMPT,
    PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_PROMPT,
)

PROMPT_CONFIG_KEYS = (
    "ai_prompt_import_image_mindmap",
    "ai_prompt_import_image_text",
    "ai_prompt_import_batch_mindmap",
    "ai_prompt_import_pdf_structure",
    "ai_prompt_import_pdf_merge",
    "ai_prompt_import_pdf_direct",
    "ai_prompt_import_pdf_page_context",
    "ai_prompt_mindmap_ai_split_system",
    "ai_prompt_palace_quiz_generate",
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace",
    "ai_prompt_palace_quiz_group_by_mini_palace",
    "ai_prompt_palace_quiz_short_answer_feedback",
    "ai_prompt_english_reading_generate",
)

PROMPT_KEY_ALIASES = {
    "import_mindmap_direct": "ai_prompt_import_pdf_direct",
    "import_mindmap_structured_merge": "ai_prompt_import_pdf_merge",
    "import_text_ocr": "ai_prompt_import_image_text",
    "import_page_context_optional": "ai_prompt_import_pdf_page_context",
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

_DEFAULT_PDF_STRUCTURE_TEMPLATE = IMPORT_PDF_STRUCTURE_TEMPLATE

_DEFAULT_PDF_MERGE_TEMPLATE = IMPORT_PDF_MERGE_TEMPLATE

_DEFAULT_PDF_DIRECT_TEMPLATE = IMPORT_PDF_DIRECT_TEMPLATE

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
        description="旧版多图脑图提示词键。当前多图与 PDF 结构补全共用同一识别语义，保留此键仅用于兼容。",
        default_template=_DEFAULT_BATCH_PROMPT_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
        available_placeholders=(
            _placeholder("structure_tree_json", "结构图提取出的原始脑图 JSON。"),
        ),
        required_placeholders=("structure_tree_json",),
    ),
    "ai_prompt_import_pdf_structure": PromptTemplateDefinition(
        key="ai_prompt_import_pdf_structure",
        label="PDF 结构页识别",
        description="PDF 结构页转脑图骨架时的完整提示词模板。",
        default_template=_DEFAULT_PDF_STRUCTURE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
        available_placeholders=(
            _placeholder("emphasis_rule", "是否保留下划线/波浪线强调的约束语句。"),
        ),
        required_placeholders=("emphasis_rule",),
    ),
    "ai_prompt_import_pdf_merge": PromptTemplateDefinition(
        key="ai_prompt_import_pdf_merge",
        label="PDF 结构补全",
        description="PDF 结构页 + 正文页合并生成脑图时的完整提示词模板。",
        default_template=_DEFAULT_PDF_MERGE_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
        available_placeholders=(
            _placeholder("leaf_mount_rule", "正文优先挂载到叶子节点或允许挂到父节点的约束语句。"),
            _placeholder("quote_rule", "是否要求尽量保留原文措辞的约束语句。"),
            _placeholder("semantic_split_rule", "是否鼓励按语义拆分长段正文的约束语句。"),
            _placeholder("emphasis_rule", "是否保留下划线/波浪线强调的约束语句。"),
            _placeholder("pdf_page_context_prompt", "PDF 页码范围上下文约束段。"),
            _placeholder("structure_tree_json", "结构页提取出的原始脑图 JSON。"),
            _placeholder("page_numbers_line", "本次允许处理的 PDF 页码说明。"),
            _placeholder("range_prompt_line", "用户补充提示。"),
            _placeholder("ocr_grounding_block", "OCR grounding 文本与约束补充段。"),
        ),
        required_placeholders=(
            "leaf_mount_rule",
            "quote_rule",
            "semantic_split_rule",
            "emphasis_rule",
            "pdf_page_context_prompt",
            "structure_tree_json",
            "page_numbers_line",
            "range_prompt_line",
            "ocr_grounding_block",
        ),
    ),
    "ai_prompt_import_pdf_direct": PromptTemplateDefinition(
        key="ai_prompt_import_pdf_direct",
        label="PDF 直接生成",
        description="PDF 选中页面直接生成脑图时的完整提示词模板。",
        default_template=_DEFAULT_PDF_DIRECT_TEMPLATE,
        source_location="apps/api/src/memory_anki/modules/settings/application/ai_prompts.py",
        available_placeholders=(
            _placeholder("quote_rule", "是否要求尽量保留原文措辞的约束语句。"),
            _placeholder("semantic_split_rule", "是否鼓励按语义拆分长段正文的约束语句。"),
            _placeholder("emphasis_rule", "是否保留下划线/波浪线强调的约束语句。"),
            _placeholder("ocr_grounding_block", "OCR grounding 文本与约束补充段。"),
        ),
        required_placeholders=(
            "quote_rule",
            "semantic_split_rule",
            "emphasis_rule",
            "ocr_grounding_block",
        ),
    ),
    "ai_prompt_import_pdf_page_context": PromptTemplateDefinition(
        key="ai_prompt_import_pdf_page_context",
        label="PDF 页码上下文",
        description="追加到 PDF 相关识别请求中的页码范围限制说明。",
        default_template=IMPORT_PDF_PAGE_CONTEXT_PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_mindmap_ai_split_system": PromptTemplateDefinition(
        key="ai_prompt_mindmap_ai_split_system",
        label="AI 分卡系统提示词",
        description="脑图 AI 分卡发送给文本模型的系统提示词。",
        default_template=AI_SPLIT_SYSTEM_PROMPT,
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


def extend_pdf_prompt(
    base_prompt: str,
    *,
    page_numbers: list[int] | None,
    range_prompt: str,
    session: Session | None = None,
) -> str:
    next_prompt = str(base_prompt or "").strip()
    page_context_prompt = render_prompt(
        "ai_prompt_import_pdf_page_context",
        {},
        session=session,
    )
    if page_numbers:
        next_prompt += (
            f"\n\n{page_context_prompt}\n"
            f"本次只允许处理这些 PDF 页面：{format_page_numbers(page_numbers)}。"
        )
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        next_prompt += f"\n用户补充提示：{normalized_range_prompt}"
    return next_prompt


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


def build_import_pdf_structure_prompt(
    *,
    preserve_emphasis_marks: bool,
    page_numbers: list[int] | None,
    range_prompt: str,
    session: Session | None = None,
) -> str:
    prompt = render_prompt(
        "ai_prompt_import_pdf_structure",
        {
            "emphasis_rule": (
                "7. 如果原节点带有下划线或波浪线强调，必须在结果里保留强调信息。"
                if preserve_emphasis_marks
                else "7. 无需额外保留下划线或波浪线强调，只需正确识别节点文字即可。"
            ),
        },
        session=session,
    )
    return extend_pdf_prompt(
        prompt,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
        session=session,
    )


def build_import_pdf_merge_prompt(
    *,
    structure_tree: dict[str, Any],
    range_prompt: str,
    page_numbers: list[int] | None,
    import_options: Any,
    extracted_text: str | None,
    session: Session | None = None,
) -> str:
    normalized_range_prompt = str(range_prompt or "").strip()
    ocr_grounding_block = ""
    if extracted_text:
        ocr_grounding_block = (
            "\n\n下面是同一批 PDF 页面抽取出的 OCR 正文，请把它当作正文 grounding，优先根据这些文字补全节点，避免只停留在结构骨架上：\n"
            f"{truncate_prompt_text(extracted_text)}\n"
            "如果 OCR 正文里出现了比结构页更详细的解释、分点或例子，必须把这些新增信息补到对应原始节点下；除非 OCR 正文本身没有新增信息，否则不要只返回原结构骨架。\n"
            "不要把结构页里已经存在的一级、二级节点原样重抄一遍当作补充结果；你需要继续往下补这些节点对应的正文细节。\n"
            "如果 OCR 正文已经给出了某个结构节点的下一级或下两级展开，请至少下沉一级后再输出。"
        )
    return render_prompt(
        "ai_prompt_import_pdf_merge",
        {
            "leaf_mount_rule": (
                "3. 默认只在最小原始节点下面新增 children；除非叶子节点实在无法承接，否则不要挂到更高层原节点。"
                if getattr(import_options, "mount_on_original_leaf_only", True)
                else "3. 如果正文无法精确匹配到叶子节点，可以挂到最近的相关原始父节点下，但仍然不能改动原始结构节点。"
            ),
            "quote_rule": (
                "4. 补充内容必须尽量使用原话，不要概括或改写；短定义和短编号点保持原文粒度。"
                if getattr(import_options, "quote_original_text_only", True)
                else "4. 补充内容可以提炼成更适合脑图展示的短语，但必须忠实原文，不能捏造，也不要写教材外总结。"
            ),
            "semantic_split_rule": (
                "5. 只有遇到三四行以上长段、连续编号、多行列表、分号并列或清晰多项列举时，才拆成 children；短句、短定义和一两行节点不要拆。"
                if getattr(import_options, "semantic_split_long_paragraphs", True)
                else "5. 不要为了美化结构自动拆分正文；除非 PDF 原文已经明确画出或列出 children，否则保持原文节点粒度。"
            ),
            "emphasis_rule": (
                "6. 如果正文中存在下划线或波浪线强调，必须在对应补充节点保留强调信息。"
                if getattr(import_options, "preserve_emphasis_marks", True)
                else "6. 无需额外保留下划线或波浪线强调，只需保证正文归位正确。"
            ),
            "pdf_page_context_prompt": render_prompt(
                "ai_prompt_import_pdf_page_context",
                {},
                session=session,
            ),
            "structure_tree_json": json.dumps(structure_tree, ensure_ascii=False),
            "page_numbers_line": (
                f"\n本次只允许处理这些 PDF 页面：{format_page_numbers(page_numbers)}。"
                if page_numbers
                else ""
            ),
            "range_prompt_line": (
                f"\n用户补充提示：{normalized_range_prompt}" if normalized_range_prompt else ""
            ),
            "ocr_grounding_block": ocr_grounding_block,
        },
        session=session,
    )


def build_import_pdf_direct_prompt(
    *,
    range_prompt: str,
    page_numbers: list[int] | None,
    import_options: Any,
    extracted_text: str | None,
    session: Session | None = None,
) -> str:
    ocr_grounding_block = ""
    if extracted_text:
        ocr_grounding_block = (
            "\n\n下面是同一批 PDF 页面抽取出的 OCR 正文，请把它当作正文 grounding，优先根据这些文字补全脑图，不能只停留在脑图页自身的结构骨架：\n"
            f"{truncate_prompt_text(extracted_text)}\n"
            "如果 OCR 正文里出现了比页面脑图更详细的解释、分点、例子或并列知识点，必须把这些新增信息补进最终脑图结果。\n"
            "不要只复述第一页或某一页里现成的脑图主干；必须综合所有选中页面的正文信息生成完整结果。\n"
            "如果页面里同时出现脑图结构和正文说明，应优先保留清晰的原有层级，再把正文细节继续下沉到对应节点下。"
        )
    prompt = render_prompt(
        "ai_prompt_import_pdf_direct",
        {
            "quote_rule": (
                "7. 节点内容默认尽量使用原文，不要随意改写；短定义和短编号点保持原文粒度。"
                if getattr(import_options, "quote_original_text_only", True)
                else "7. 允许把原文适度压缩成更适合脑图展示的短语，但必须忠实原意，不能捏造，也不要写教材外总结。"
            ),
            "semantic_split_rule": (
                "8. 只有遇到三四行以上长段、连续编号、多行列表、分号并列或清晰多项列举时，才拆成 children；短句、短定义和一两行节点不要拆。"
                if getattr(import_options, "semantic_split_long_paragraphs", True)
                else "8. 不要为了美化结构主动拆分正文；除非 PDF 原文已经明确画出或列出 children，否则保持原文节点粒度。"
            ),
            "emphasis_rule": (
                "9. 如果页面里存在下划线或波浪线强调，尽量在 rich_text_html 和 emphasis_marks 中保留。"
                if getattr(import_options, "preserve_emphasis_marks", True)
                else "9. 无需额外保留下划线或波浪线强调，只要内容归位正确即可。"
            ),
            "ocr_grounding_block": ocr_grounding_block,
        },
        session=session,
    )
    return extend_pdf_prompt(
        prompt,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
        session=session,
    )
