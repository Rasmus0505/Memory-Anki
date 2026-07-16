from __future__ import annotations

from typing import NotRequired, TypedDict


class PromptBlockSeedData(TypedDict):
    key: str
    label: str
    description: str
    layer: str
    sort_order: int
    template: str


class PromptSceneSeedData(TypedDict):
    scene_key: str
    prompt_key: str
    block_keys: tuple[str, ...]
    scene_instruction: str
    recommended_block_keys: tuple[str, ...]
    label: NotRequired[str]
    description: NotRequired[str]
    category: NotRequired[str]


AI_SPLIT_BLOCK_SEEDS: tuple[PromptBlockSeedData, ...] = (
    {
        "key": "content.split_source_fidelity",
        "label": "分卡内容完整保留",
        "description": "拆分长卡片时保留全部原始知识信息与原句，不总结、删减或编造。",
        "layer": "content",
        "sort_order": 40,
        "template": (
            "必须完整保留目标卡片中的全部知识信息、限定条件、顺序和原意；"
            "叶子节点尽量保留原句，只允许按原意切分与必要的短标题提炼；"
            "不得总结、删减、改写合并或编造。简化与删减留给用户后续人工处理。"
        ),
    },
    {
        "key": "task.split_structure_judgment",
        "label": "分卡结构自判",
        "description": "由 AI 判断并列拆分还是层级拆分，避免强制单一形态。",
        "layer": "task",
        "sort_order": 20,
        "template": (
            "根据目标卡片内容自行判断结构：\n"
            "1. 多个并列要点、并列事件或并列论断 → 拆成多个顶层节点，children 为空数组。\n"
            "2. 存在分类、时间线、目的/内容、概念展开等内在层级 → 生成父子树；"
            "优先最少且必要的层级，最多四层。\n"
            "3. 多时间点事件并列；「此后…」「其中…」等延伸说明挂在对应事件下作子节点。\n"
            "4. 可分主题时使用简短中间层标题（如「目的」「内容」），"
            "中间标题不得替代原文信息；事实仍落在保留原句的叶子节点上。\n"
            "5. 可去掉编号前缀（如 1. / 2.），但不得丢失编号所承载的知识内容。"
        ),
    },
    {
        "key": "task.split_examples",
        "label": "分卡样例对照",
        "description": "用真实教材长卡前后对照示例，说明并列与层级拆法。",
        "layer": "task",
        "sort_order": 30,
        "template": (
            "参考下列拆法（只学结构与保真，不要照抄到无关内容）：\n\n"
            "【例 A 时间线并列 + 延伸子节点】\n"
            "输入："
            "德国的实科教育因工商业的发展和城市生活的日渐丰富而走在欧洲各国的前列。"
            "弗兰克于1695年在哈勒开办了一所国民学校，以实科内容和直观方法施教并给贫家子弟免费提供教材，"
            "此后又设立科学学校、诊所、印刷厂、师范学校及文科中学等。"
            "1708年，席姆勒创办了数学、机械学、经济学实科学校。"
            "1747年赫克建立了类似的学校，所开设的实科课程更为广泛，影响更大。\n"
            "输出树：\n"
            "- 实科中学\n"
            "  - 德国的实科教育因工商业的发展和城市生活的日渐丰富而走在欧洲各国的前列。\n"
            "  - 1695年-弗兰克在哈勒开办了一所国民学校，以实科内容和直观方法施教并给贫家子弟免费提供教材\n"
            "    - 此后又设立科学学校、诊所、印刷厂、师范学校及文科中学等。\n"
            "  - 1708年，席姆勒创办了数学、机械学、经济学实科学校。\n"
            "  - 1747年赫克建立了类似的学校，所开设的实科课程更为广泛，影响更大。\n\n"
            "【例 B 主题分组层级】\n"
            "输入：目的、特点与课程内容混写的骑士学院长段。\n"
            "输出树：\n"
            "- 骑士学院\n"
            "  - 目的\n"
            "    - 德意志各邦国为了培养文武官员、巩固政治，面向上层贵族子弟设立“骑士学院”。\n"
            "    - 骑士学院实际上是一种培养新贵族即资产阶级人才的特殊学校。\n"
            "  - 内容\n"
            "    - 现代外语和自然科学占首要地位，法律、军事、工艺、建筑、机械等课程占很大比重，"
            "不学拉丁文、希腊文。"
        ),
    },
    {
        "key": "boundary.split_in_place",
        "label": "原位置替换边界",
        "description": "只替换当前目标卡片，不改动父级、兄弟节点或其他子树。",
        "layer": "boundary",
        "sort_order": 40,
        "template": (
            "只处理输入中的 target_node，并生成用于原位置替换的节点；"
            "服务端会删除原目标卡片并在同一位置插入 replacement_nodes；"
            "不得修改父节点、兄弟节点或脑图中的其他内容。"
        ),
    },
    {
        "key": "output.mindmap_split_json",
        "label": "分卡替换 JSON Schema",
        "description": "定义 replacement_nodes 递归节点协议。",
        "layer": "output",
        "sort_order": 20,
        "template": (
            '顶层格式必须为 {"replacement_nodes":[{"text":"卡片文字","note":"可选备注","children":[]}]}。'
            "每个节点必须有非空 text 和数组 children；无子节点也必须输出 children: []。"
        ),
    },
)

_AI_SPLIT_DEFAULT_BLOCKS: tuple[str, ...] = (
    "role.strict_json",
    "content.split_source_fidelity",
    "task.split_structure_judgment",
    "task.split_examples",
    "boundary.split_in_place",
    "output.mindmap_split_json",
    "quality.json_integrity",
)

_AI_SPLIT_SCENE_INSTRUCTION = (
    "任务：把目标长卡片在原位置替换为结构清晰的卡片树（或并列小卡片）。\n"
    "由你判断应使用并列还是层级：有内在分类/时间线/目的-内容关系时生成父子树，"
    "纯并列要点时顶层 children 为空。最多四层，优先最少必要层级。\n"
    "叶子尽量保留原句，禁止总结删减；中间标题只作组织，不得吞掉原文信息。\n"
    "只输出 replacement_nodes；服务端将删除原卡片并在同位置插入新节点。"
)

AI_SPLIT_SCENE_SEEDS: tuple[PromptSceneSeedData, ...] = (
    {
        "scene_key": "ai_split",
        "prompt_key": "ai_prompt_mindmap_ai_split_system",
        "block_keys": _AI_SPLIT_DEFAULT_BLOCKS,
        "scene_instruction": _AI_SPLIT_SCENE_INSTRUCTION,
        "recommended_block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "task.split_structure_judgment",
            "boundary.split_in_place",
            "output.mindmap_split_json",
        ),
        "label": "AI 分卡",
        "description": "脑图编辑页右键：把无子节点的长内容卡片原位拆成并列或层级小卡片，保留原句。",
        "category": "脑图分卡",
    },
    # Compatibility aliases for older UI entrypoints / localStorage keys.
    {
        "scene_key": "ai_split_parallel",
        "prompt_key": "ai_prompt_mindmap_ai_split_system",
        "block_keys": _AI_SPLIT_DEFAULT_BLOCKS,
        "scene_instruction": _AI_SPLIT_SCENE_INSTRUCTION,
        "recommended_block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "task.split_structure_judgment",
            "boundary.split_in_place",
            "output.mindmap_split_json",
        ),
        "label": "AI 分卡（兼容·并列入口）",
        "description": "旧「并列分卡」入口兼容场景，默认与统一 AI 分卡相同。",
        "category": "脑图分卡",
    },
    {
        "scene_key": "ai_split_hierarchy",
        "prompt_key": "ai_prompt_mindmap_ai_split_system",
        "block_keys": _AI_SPLIT_DEFAULT_BLOCKS,
        "scene_instruction": _AI_SPLIT_SCENE_INSTRUCTION,
        "recommended_block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "task.split_structure_judgment",
            "boundary.split_in_place",
            "output.mindmap_split_json",
        ),
        "label": "AI 分卡（兼容·层级入口）",
        "description": "旧「层级分卡」入口兼容场景，默认与统一 AI 分卡相同。",
        "category": "脑图分卡",
    },
)
