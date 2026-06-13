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
    BATCH_PROMPT,
    PDF_PAGE_CONTEXT_PROMPT,
    PROMPT,
    TEXT_PROMPT,
    format_page_numbers,
    truncate_prompt_text,
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
    f"{BATCH_PROMPT}\n\n"
    "下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：\n"
    "{{structure_tree_json}}\n\n"
    "接下来会按顺序提供结构图和正文图片。请综合所有图片后输出增强后的完整脑图 JSON。"
)

_DEFAULT_PDF_STRUCTURE_TEMPLATE = """你是一个严格输出 JSON 的 PDF 脑图结构还原助手。

任务：只读取用户指定的 PDF 结构页，把页面中原本就存在的脑图结构还原成树形结构。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 必须保留原页的章节主干、层级、顺序和节点粒度。
3. 禁止改写、概括、压缩或重命名原始节点文字。
5. 输出格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "rich_text_html": "<div>节点文字</div>",
      "emphasis_marks": [],
      "children": []
    }
  ]
}
6. 如果某个节点没有子节点，children 仍然输出空数组。
{{emphasis_rule}}"""

_DEFAULT_PDF_MERGE_TEMPLATE = """你是一个严格输出 JSON 的 PDF 脑图正文补充助手。

任务：
1. 第一张图片是已经指定的 PDF 结构页，对应的脑图结构 JSON 已给出。
2. 其余图片是正文页。
3. 你需要基于已给定的结构，把正文内容补充到最匹配的原始节点下。

核心目标：
- 优先保持 PDF 原文已经标好的点、层级和顺序，不要把教材内容总结成你自己的话。
- PDF 已经标成一个编号点、短定义或一两行节点时，保持为一个节点，不要为了显得更像脑图再拆小点。
- 只有原文已经给出多行列表、明显长段、连续编号、分号并列或清晰的多项列举时，才可以由你自己拆成 children。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 给定结构里的原始节点 text、层级、顺序必须保持不变；你只能在原节点下面新增 children。
{{leaf_mount_rule}}
{{quote_rule}}
{{semantic_split_rule}}
{{emphasis_rule}}
7. 普通短句里的“是、由、在、以、包括、分为”等词本身不是拆分理由；除非原文版面已经明确列成多项，否则保持原句粒度。
8. 不要额外生成教材里没有的新总结语；如果原文只有短语或一句短定义，就输出原文短语或原句。
9. 输出格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "rich_text_html": "<div>节点文字</div>",
      "emphasis_marks": [],
      "children": []
    }
  ]
}
10. 每个节点即使没有子节点，也必须输出 children: []。

{{pdf_page_context_prompt}}

下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：
{{structure_tree_json}}
{{page_numbers_line}}
{{range_prompt_line}}{{ocr_grounding_block}}

接下来会按顺序提供结构图和正文图片。请综合结构 JSON、OCR 正文和图片内容后输出增强后的完整脑图 JSON。"""

_DEFAULT_PDF_DIRECT_TEMPLATE = """你是一个严格输出 JSON 的 PDF 转脑图助手。

任务：
1. 综合用户提供的全部 PDF 页面图片。
2. 直接根据这些页面生成最终脑图，不要假设存在单独的结构页。
3. 只基于本次给出的页面内容输出结果，不要补充页面之外的知识。

核心目标：
- 优先保持页面里本来就存在的层级、编号点和版面顺序，不要把教材内容总结成你自己的话。
- PDF 已经标成一个编号点、短定义或一两行节点时，保持为一个节点，不要把一个短点再拆成多个低密度小点。
- 只有原文已经给出多行列表、明显长段、连续编号、分号并列或清晰的多项列举时，才可以由你自己拆成 children。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层 JSON 格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "rich_text_html": "<div>节点文字</div>",
      "emphasis_marks": [],
      "children": []
    }
  ]
}
3. 每个节点即使没有子节点，也必须输出 children: []。
4. 章节主干、层级和顺序要尽量贴合页面原文与版面逻辑。
5. 普通短句里的“是、由、在、以、包括、分为”等词本身不是拆分理由；除非原文版面已经明确列成多项，否则保持原句粒度。
6. 不要额外生成教材里没有的新总结语；如果原文只有短语或一句短定义，就输出原文短语或原句。
{{quote_rule}}
{{semantic_split_rule}}
{{emphasis_rule}}{{ocr_grounding_block}}"""

_DEFAULT_PALACE_QUIZ_GENERATE_TEMPLATE = """你是一个严格输出 JSON 的做题生成助手。

任务：
1. 你会收到一组教材 PDF 页面或图片。
2. 先判断页面里是否已经存在现成的题目、题号、序号或题型。
3. 如果存在现成题目，优先按原题抽取；如果没有明确题目，再基于当前资料内容补出适量题目。
4. 题型只能是 multiple_choice 或 short_answer，数量和类型比例由你自行判断，但要贴合资料本身。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "questions": [
    {
      "question_type": "multiple_choice",
      "stem": "题干",
      "options": [
        {"id": "A", "text": "选项A"},
        {"id": "B", "text": "选项B"}
      ],
      "correct_option_id": "B",
      "analysis": "解析"
    },
    {
      "question_type": "short_answer",
      "stem": "题干",
      "reference_answer": "参考答案",
      "analysis": "解析"
    }
  ]
}
3. multiple_choice 必须至少有 2 个选项，并明确给出 correct_option_id。
4. short_answer 必须给出 reference_answer。
5. analysis 必须尽量结合当前资料内容，不要只写“略”或空字符串。
6. 不要生成资料无关的知识点，不要输出页面之外的背景扩写。"""

_DEFAULT_PALACE_QUIZ_SHORT_ANSWER_FEEDBACK_TEMPLATE = (
    "你是一个简答题点评助手。"
    "你会收到题干、学生答案、参考答案和解析。"
    "请先肯定学生已有的正确点，再指出遗漏、偏差或表达不清的地方，"
    "最后给出一个简短改进建议。"
    "语气要具体、温和、利于继续复习。"
    "直接输出点评正文，不要输出 JSON，不要重复整段题干。"
)

_DEFAULT_PALACE_QUIZ_CLASSIFY_EXISTING_TO_MINI_PALACE_TEMPLATE = """你是一个严格输出 JSON 的题目归类助手。

任务：
1. 你会收到若干个小宫殿，以及一批属于大宫殿的题目。
2. 你要判断每道题与哪些小宫殿直接相关。
3. 同一题可以同时属于多个小宫殿。
4. 如果某道题和所有小宫殿都不够相关，就把它放进未归类列表。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "mini_palace_groups": [
    {"mini_palace_id": 1, "question_indexes": [0, 2]},
    {"mini_palace_id": 2, "question_indexes": [1, 2]}
  ],
  "unassigned_question_indexes": [3]
}
3. question_indexes 必须引用输入 questions 中的 question_index。
4. 不要编造不存在的小宫殿 id。
5. 只有题干、答案、选项或解析与小宫殿节点语义明显相关时才归入，避免泛泛乱分。
6. 如果一题只和大宫殿整体相关、和任何小宫殿都不够贴合，就放进 unassigned_question_indexes。"""

_DEFAULT_PALACE_QUIZ_GROUP_BY_MINI_PALACE_TEMPLATE = """你是一个严格输出 JSON 的题目分组助手。

任务：
1. 你会收到若干个小宫殿，以及一批刚生成出来的题目草稿。
2. 你要按小宫殿语义判断每道题应该归到哪些小宫殿。
3. 同一题可以进入多个小宫殿。
4. 不适合任何小宫殿的题目要放进未归类列表，保留给大宫殿。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层格式必须是：
{
  "mini_palace_groups": [
    {"mini_palace_id": 1, "question_indexes": [0, 2]}
  ],
  "unassigned_question_indexes": [1]
}
3. question_indexes 必须引用输入 questions 中的 question_index。
4. 不要编造不存在的小宫殿 id。
5. 只根据题目本身与小宫殿节点语义的贴合度分组，不要为了平均分布而硬分。
6. 如果题目更适合整个大宫殿而不是某个具体小宫殿，就放进 unassigned_question_indexes。"""

PROMPT_DEFINITIONS: dict[str, PromptTemplateDefinition] = {
    "ai_prompt_import_image_mindmap": PromptTemplateDefinition(
        key="ai_prompt_import_image_mindmap",
        label="图片转脑图（兼容）",
        description="旧版单图脑图提示词键。当前推荐使用 PDF 直接生成语义，保留此键仅用于兼容。",
        default_template=PROMPT,
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import/prompts.py",
    ),
    "ai_prompt_import_image_text": PromptTemplateDefinition(
        key="ai_prompt_import_image_text",
        label="图片转文字",
        description="图片/PDF OCR 的基础纯文本提示词。PDF 页码范围提示会在运行时追加。",
        default_template=TEXT_PROMPT,
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
        default_template=PDF_PAGE_CONTEXT_PROMPT,
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
        default_template=(
            "你正在为英文学习网站一次性生成阅读辅助结果。"
            "输入中可以包含中文说明，但 JSON 字段值必须优先使用英文，不要输出 Markdown，不要输出解释，不要输出 JSON 以外的内容。"
            "你需要同时完成两件事："
            "1. 为 unknown_surfaces 中的每个 surface 给出 1 到 3 个最常见、最可能命中本地词典的原型或短语候选，并估计 CEFR。"
            "2. 只对 sentence_tasks 中给出的句子做必要改写，让句子更顺读，但必须严格保持原意、事实、语气和逻辑关系。"
            "原意优先级高于改写级别。不能为了简单而篡改意思，不能额外扩写。"
            "如果改写会损失原意，就保留原词或原句。不要把内容改得过于简单。"
            "正向示例：assuage your anxiety. -> calm your fear and stress"
            "；I used to loathe and eschew perusing English. -> I used to hate and avoid carefully reading English."
            "请只输出一个 JSON 对象，结构必须是："
            '{"surfaceItems":[{"surface":"acquision","candidates":["acquire","acquisition"],"cefr":"B2","confidence":0.92,"note":"Likely noun form related to acquire."}],"sentenceItems":[{"sentenceId":"sentence-1","parts":[{"text":"Crucial","kind":"yellow","candidateId":"y1"},{"text":" acquisition","kind":"green","candidateId":"g1"},{"text":" was "},{"text":"stubborn","kind":"red","candidateId":"r1"},{"text":"."}],"sentenceAnnotation":{"kind":"syntax_simplified","originalText":"Important acquisition was recalcitrant.","displayText":"Crucial acquisition was stubborn.","skeletonHints":["subject","verb"]}}]}。'
            "surfaceItems 可以为空数组，sentenceItems 也可以为空数组。"
            "cefr 只能是 A1/A2/B1/B2/C1/C2。confidence 取 0 到 1 之间。"
            "parts 按顺序拼接成最终展示句。"
            "green 表示原文天然 i+1 且尽量原样保留；yellow 表示把太简单的表达升级到更自然但仍忠于原意的表达；"
            "red 表示把太难的表达降到可顺读但仍忠于原意的表达。"
            "candidateId 必须复用输入中的候选 id；如果某段只是普通连接文本，就不要提供 candidateId。"
            "如果句法过难，可以适度拆解结构，并把 sentenceAnnotation.kind 设为 syntax_simplified，同时提供 2 到 4 个英文骨架标签。"
        ),
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
