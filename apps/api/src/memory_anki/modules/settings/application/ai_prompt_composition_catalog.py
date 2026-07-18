from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .ai_prompt_split_seeds import AI_SPLIT_BLOCK_SEEDS, AI_SPLIT_SCENE_SEEDS
from .ai_prompts import PROMPT_DEFINITIONS

LAYER_ORDER = {
    "role": 10,
    "task": 20,
    "content": 30,
    "boundary": 40,
    "output": 50,
    "quality": 60,
}

LAYER_LABELS = {
    "role": "角色",
    "task": "任务",
    "content": "内容规则",
    "boundary": "边界",
    "output": "输出格式",
    "quality": "质量自检",
}


@dataclass(frozen=True, slots=True)
class PromptBlockSeed:
    key: str
    label: str
    description: str
    layer: str
    sort_order: int
    template: str


@dataclass(frozen=True, slots=True)
class PromptSceneSeed:
    scene_key: str
    prompt_key: str
    block_keys: tuple[str, ...]
    scene_instruction: str
    recommended_block_keys: tuple[str, ...] = ()
    label: str | None = None
    description: str | None = None
    category: str = "其他"
    is_compatibility: bool = False


def _scene_seed_from_mapping(seed: Mapping[str, Any]) -> PromptSceneSeed:
    return PromptSceneSeed(
        scene_key=str(seed["scene_key"]),
        prompt_key=str(seed["prompt_key"]),
        block_keys=tuple(seed["block_keys"]),
        scene_instruction=str(seed["scene_instruction"]),
        recommended_block_keys=tuple(seed.get("recommended_block_keys") or ()),
        label=str(seed["label"]) if seed.get("label") else None,
        description=str(seed["description"]) if seed.get("description") else None,
        category=str(seed.get("category") or "其他"),
        is_compatibility=bool(seed.get("is_compatibility", False)),
    )


def _scene_display_label(seed: PromptSceneSeed) -> str:
    if seed.label:
        return seed.label
    definition = PROMPT_DEFINITIONS.get(seed.prompt_key)
    return definition.label if definition else seed.scene_key


def _scene_display_description(seed: PromptSceneSeed) -> str:
    if seed.description:
        return seed.description
    definition = PROMPT_DEFINITIONS.get(seed.prompt_key)
    return definition.description if definition else ""


SCENE_CATEGORY_ORDER = (
    "脑图分卡",
    "脑图导入",
    "OCR 与整理",
    "记忆与复习",
    "做题",
    "英语",
    "批量生成",
    "其他",
)


BUILTIN_BLOCKS = (
    PromptBlockSeed(
        key="role.strict_json",
        label="严格 JSON 助手",
        description="要求模型只输出可解析 JSON，不输出解释或 Markdown。",
        layer="role",
        sort_order=10,
        template="你是一个严格输出 JSON 的助手。只输出 JSON，不要输出 Markdown，不要输出解释。",
    ),
    PromptBlockSeed(
        key="role.source_extractor",
        label="忠实资料提取助手",
        description="用于 OCR、转写和资料抽取，不主动组织或补充内容。",
        layer="role",
        sort_order=20,
        template="你是一个忠实的资料提取助手，只处理输入中实际可见或明确提供的内容。",
    ),
    PromptBlockSeed(
        key="content.fidelity",
        label="忠实原文与禁止编造",
        description="保留来源措辞和信息，不总结、删减、改写或编造。",
        layer="content",
        sort_order=10,
        template=(
            "严格保留目标范围内的原文信息，不要总结、删减、改写或补充来源中不存在的内容；"
            "允许按原意拆分并列要点。"
        ),
    ),
    PromptBlockSeed(
        key="content.semantic_preservation",
        label="语义保持",
        description="允许调整表达，但必须保持原意、事实和关键限制。",
        layer="content",
        sort_order=20,
        template="允许调整表达和组织方式，但必须保持原意、事实、条件和关键限制，不得引入新结论。",
    ),
    PromptBlockSeed(
        key="content.literal_ocr",
        label="OCR 逐字提取",
        description="用于文字识别，禁止总结和结构化改写。",
        layer="content",
        sort_order=30,
        template="按自然阅读顺序逐字提取正文；不要总结、解释、补全缺失文字或改写表达。",
    ),
    PromptBlockSeed(
        key="content.knowledge_emphasis",
        label="知识重点标记",
        description="当用户提供重点视觉线索时，用 emphasis_marks 标出原文重点片段。",
        layer="content",
        sort_order=40,
        template=(
            "若本次运行提供了“重点标记线索”，请按该线索识别教材中的知识重点原文片段，"
            "并在对应节点输出可选字段 emphasis_marks："
            '[{"kind":"highlight","text":"原文子串"}]。'
            "text 字段保持纯文本；emphasis_marks.text 必须是该节点 text 的子串，不要改写。"
            "未提供线索时可以不输出 emphasis_marks。"
            "不要用 markdown 标记重点；产品侧会把 emphasis_marks 渲染为黄色底色。"
        ),
    ),
    PromptBlockSeed(
        key="boundary.document_chapter",
        label="教材章节边界",
        description="综合正文层级，保留跨页续文并在下一同级章节停止。",
        layer="boundary",
        sort_order=10,
        template=(
            "不要假设任何页面天然是结构页。综合标题、编号、段落、缩进和并列关系判断层级；"
            "精华提要、目录、表格和示意图只能辅助判断，不能代替正文。"
            "保留跨页续文，遇到下一同级章节标题时立即停止。"
        ),
    ),
    PromptBlockSeed(
        key="boundary.noise_filter",
        label="页面噪声排除",
        description="排除页眉页脚、页码、广告、群号和水印。",
        layer="boundary",
        sort_order=20,
        template="排除页眉、页脚、页码、广告、群号、版权信息和扫描水印。",
    ),
    PromptBlockSeed(
        key="boundary.explicit_structure",
        label="显式结构图补全",
        description="仅在用户明确指定结构图时，以其为骨架补充正文。",
        layer="boundary",
        sort_order=30,
        template=(
            "用户已显式指定结构图。以识别出的结构为主骨架，用其余正文补全节点；"
            "不得让正文中的下一同级章节扩展当前结构。"
        ),
    ),
    PromptBlockSeed(
        key="output.mindmap_json",
        label="脑图 JSON Schema",
        description="统一脑图根节点和 children 递归结构。",
        layer="output",
        sort_order=10,
        template=(
            '顶层格式必须为 {"title":"根节点标题","children":[{"text":"节点文字","children":[]}]}。'
            "每个节点必须有非空 text 和数组 children；无子节点也必须输出 children: []。"
            "多个并列要点必须拆成并列 children。"
            "可选：节点可含 emphasis_marks（数组），每项为 "
            '{"kind":"highlight","text":"原文子串"}，用于标识知识重点。'
        ),
    ),
    PromptBlockSeed(
        key="quality.json_integrity",
        label="JSON 完整性自检",
        description="输出前检查 JSON、必填字段和有效内容节点。",
        layer="quality",
        sort_order=10,
        template="输出前检查括号、引号和数组完整闭合，并确认至少包含一个有效内容节点。",
    ),
    PromptBlockSeed(
        key="quality.source_grounding",
        label="来源证据自检",
        description="检查生成内容是否都能回溯到输入证据。",
        layer="quality",
        sort_order=20,
        template="输出前逐项检查：每个事实、题目或结论都必须能回溯到输入资料，不得凭常识补写。",
    ),
    *(PromptBlockSeed(**seed) for seed in AI_SPLIT_BLOCK_SEEDS),
)


PROMPT_SCENE_BINDINGS = {
    "ai_prompt_import_image_mindmap": "vision_image_mindmap",
    "ai_prompt_import_image_text": "vision_image_text",
    "ai_prompt_import_document_mindmap": "vision_batch_mindmap",
    "ai_prompt_import_batch_mindmap": "vision_structure_mindmap",
    "ai_prompt_import_ocr_mindmap_format": "mindmap_ocr_formatter",
    "ai_prompt_mindmap_ai_split_system": "ai_split",
    "ai_prompt_peg_association": "peg_association_suggestions",
    "ai_prompt_ai_learning_workbench": "review_ai_learning",
    "ai_prompt_batch_palace_generation": "batch_palace_generation",
    "ai_prompt_batch_quiz_generation": "batch_quiz_generation",
    "ai_prompt_palace_quiz_generate": "quiz_image_generation",
    "ai_prompt_palace_quiz_short_answer_feedback": "quiz_short_answer_feedback",
    "ai_prompt_palace_quiz_group_by_mini_palace": "quiz_mini_palace_grouping",
    "ai_prompt_palace_quiz_node_binding": "quiz_node_binding",
    "ai_prompt_palace_quiz_classify_existing_to_mini_palace": "quiz_mini_palace_grouping_existing",
    "ai_prompt_palace_quiz_text_formatting": "quiz_text_generation",
    "ai_prompt_palace_quiz_review_mindmap": "quiz_review_mindmap_generation",
    "ai_prompt_palace_quiz_source_pair_transcription": "quiz_source_pair_transcription",
    "ai_prompt_english_reading_generate": "english_reading",
    "ai_prompt_english_translation_batch": "translation_course_batch",
    "ai_prompt_english_translation_single": "translation_reading_sentence",
}

# Legacy prompt keys still map to composition scenes that may share a prompt_key.
SCENE_CATEGORY_BY_KEY: dict[str, str] = {
    "ai_split": "脑图分卡",
    "ai_split_parallel": "脑图分卡",
    "ai_split_hierarchy": "脑图分卡",
    "vision_image_mindmap": "脑图导入",
    "vision_batch_mindmap": "脑图导入",
    "vision_structure_mindmap": "脑图导入",
    "mindmap_ocr_formatter": "OCR 与整理",
    "vision_image_text": "OCR 与整理",
    "peg_association_suggestions": "记忆与复习",
    "review_ai_learning": "记忆与复习",
    "batch_palace_generation": "批量生成",
    "batch_quiz_generation": "批量生成",
    "quiz_image_generation": "做题",
    "quiz_text_generation": "做题",
    "quiz_review_mindmap_generation": "做题",
    "quiz_short_answer_feedback": "做题",
    "quiz_mini_palace_grouping": "做题",
    "quiz_mini_palace_grouping_existing": "做题",
    "quiz_node_binding": "做题",
    "quiz_source_pair_transcription": "做题",
    "english_reading": "英语",
    "translation_course_batch": "英语",
    "translation_reading_sentence": "英语",
}

SCENE_PROMPT_BINDINGS = {scene: prompt for prompt, scene in PROMPT_SCENE_BINDINGS.items()}


def _mindmap_scene_instruction(task: str) -> str:
    return f"任务：{task}\n根据输入中实际出现的标题、编号、段落、缩进和并列关系建立层级。"


BUILTIN_SCENES: dict[str, PromptSceneSeed] = {
    **{seed["scene_key"]: _scene_seed_from_mapping(seed) for seed in AI_SPLIT_SCENE_SEEDS},
    "vision_image_mindmap": PromptSceneSeed(
        scene_key="vision_image_mindmap",
        prompt_key="ai_prompt_import_image_mindmap",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=_mindmap_scene_instruction("识别单张现成脑图截图，尽量一比一还原图中的层级和顺序。"),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        label="图片转脑图",
        description="识别单张脑图截图并还原层级。",
        category="脑图导入",
    ),
    "vision_batch_mindmap": PromptSceneSeed(
        scene_key="vision_batch_mindmap",
        prompt_key="ai_prompt_import_document_mindmap",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=_mindmap_scene_instruction("读取全部教材正文页面，生成目标章节的完整思维导图。"),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        label="PDF/教材转脑图",
        description="根据教材正文页面生成完整思维导图。",
        category="脑图导入",
    ),
    "vision_structure_mindmap": PromptSceneSeed(
        scene_key="vision_structure_mindmap",
        prompt_key="ai_prompt_import_batch_mindmap",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.explicit_structure",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=(
            "任务：根据用户显式指定的结构图和其余正文图片补全脑图。\n"
            "已识别的结构图 JSON：\n{{structure_tree_json}}"
        ),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.explicit_structure",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        label="结构图补全脑图",
        description="以用户指定结构图为骨架补全正文。",
        category="脑图导入",
    ),
    "mindmap_ocr_formatter": PromptSceneSeed(
        scene_key="mindmap_ocr_formatter",
        prompt_key="ai_prompt_import_ocr_mindmap_format",
        block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        scene_instruction=(
            "任务：把带页码的逐页 OCR 原文整理为目标章节脑图。\n"
            "目标章节标题：{{target_title}}\n\n逐页 OCR 原文：\n{{ocr_text}}"
        ),
        recommended_block_keys=(
            "role.strict_json",
            "content.fidelity",
            "content.knowledge_emphasis",
            "boundary.document_chapter",
            "boundary.noise_filter",
            "output.mindmap_json",
            "quality.json_integrity",
        ),
        label="OCR 整理为脑图",
        description="把逐页 OCR 原文整理成章节脑图。",
        category="OCR 与整理",
    ),
    "vision_image_text": PromptSceneSeed(
        scene_key="vision_image_text",
        prompt_key="ai_prompt_import_image_text",
        block_keys=("role.source_extractor", "content.literal_ocr", "boundary.noise_filter"),
        scene_instruction="任务：提取图片或 PDF 页面中的正文文字，保持自然阅读顺序和段落。",
        recommended_block_keys=("role.source_extractor", "content.literal_ocr", "boundary.noise_filter"),
        label="图片/PDF 转文字",
        description="逐字提取图片或 PDF 页面正文。",
        category="OCR 与整理",
    ),
    "peg_association_suggestions": PromptSceneSeed(
        scene_key="peg_association_suggestions",
        prompt_key="ai_prompt_peg_association",
        block_keys=("role.strict_json", "content.semantic_preservation", "quality.source_grounding"),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_peg_association"].default_template,
        recommended_block_keys=("quality.source_grounding",),
        label="记忆桩联想建议",
        description="为知识点生成可挂载到记忆桩的联想建议。",
        category="记忆与复习",
    ),
    "review_ai_learning": PromptSceneSeed(
        scene_key="review_ai_learning",
        prompt_key="ai_prompt_ai_learning_workbench",
        block_keys=("content.semantic_preservation", "quality.source_grounding"),
        scene_instruction=(
            "任务：在复习 AI 学习工作台中处理冻结的学习上下文。"
            "优先依据上下文，明确区分事实、推断和待核实内容；不要声称已经修改或发布学习内容。"
        ),
        recommended_block_keys=("content.semantic_preservation",),
        label="复习 AI 学习工作台",
        description="在复习场景中基于冻结上下文进行问答或建议。",
        category="记忆与复习",
    ),
    "batch_palace_generation": PromptSceneSeed(
        scene_key="batch_palace_generation",
        prompt_key="ai_prompt_batch_palace_generation",
        block_keys=("content.fidelity", "boundary.document_chapter", "boundary.noise_filter", "quality.source_grounding"),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_batch_palace_generation"].default_template,
        recommended_block_keys=("content.fidelity", "boundary.document_chapter"),
        label="批量生成宫殿草稿",
        description="将本节教材转换为可编辑的记忆宫殿草稿。",
        category="批量生成",
    ),
    "batch_quiz_generation": PromptSceneSeed(
        scene_key="batch_quiz_generation",
        prompt_key="ai_prompt_batch_quiz_generation",
        block_keys=("quality.source_grounding",),
        scene_instruction=PROMPT_DEFINITIONS["ai_prompt_batch_quiz_generation"].default_template,
        recommended_block_keys=("quality.source_grounding",),
        label="批量生成题目草稿",
        description="基于教材与题库证据生成可审阅题目草稿。",
        category="批量生成",
    ),
}


for _prompt_key, _scene_key in PROMPT_SCENE_BINDINGS.items():
    if _scene_key in BUILTIN_SCENES:
        continue
    _definition = PROMPT_DEFINITIONS[_prompt_key]
    _blocks = ("quality.source_grounding",) if "quiz" in _scene_key else ()
    _category = SCENE_CATEGORY_BY_KEY.get(_scene_key, "其他")
    if "quiz" in _scene_key:
        _category = "做题"
    elif "english" in _scene_key or "translation" in _scene_key:
        _category = "英语"
    BUILTIN_SCENES[_scene_key] = PromptSceneSeed(
        scene_key=_scene_key,
        prompt_key=_prompt_key,
        block_keys=_blocks,
        scene_instruction=_definition.default_template,
        recommended_block_keys=_blocks,
        label=_definition.label,
        description=_definition.description,
        category=_category,
        is_compatibility=False,
    )


def block_applicable_scene_keys(block_key: str) -> list[str]:
    """Scenes that ship this block in their modular default combination."""
    scenes = [
        seed.scene_key
        for seed in BUILTIN_SCENES.values()
        if block_key in seed.block_keys or block_key in seed.recommended_block_keys
    ]
    return sorted(set(scenes))


