from __future__ import annotations

from typing import TypedDict


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

AI_SPLIT_BLOCK_SEEDS: tuple[PromptBlockSeedData, ...] = (
    {
        "key": "content.split_source_fidelity",
        "label": "分卡内容完整保留",
        "description": "拆分长卡片时保留全部原始知识信息，不总结或编造。",
        "layer": "content",
        "sort_order": 40,
        "template": (
            "必须完整保留目标卡片中的全部知识信息、限定条件、顺序和原意；"
            "只允许按原意切分，不得总结、删减、改写、合并或编造。"
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

AI_SPLIT_SCENE_SEEDS: tuple[PromptSceneSeedData, ...] = (
    {
        "scene_key": "ai_split_parallel",
        "prompt_key": "ai_prompt_mindmap_ai_split_system",
        "block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "boundary.split_in_place",
            "output.mindmap_split_json",
            "quality.json_integrity",
        ),
        "scene_instruction": (
            "任务：把目标长卡片替换为多个并列小卡片。"
            "replacement_nodes 中所有顶层节点的 children 必须为空数组。"
        ),
        "recommended_block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "boundary.split_in_place",
            "output.mindmap_split_json",
        ),
    },
    {
        "scene_key": "ai_split_hierarchy",
        "prompt_key": "ai_prompt_mindmap_ai_split_system",
        "block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "boundary.split_in_place",
            "output.mindmap_split_json",
            "quality.json_integrity",
        ),
        "scene_instruction": (
            "任务：把目标长卡片替换为结构清晰的卡片树。"
            "可生成父子层级，但最多三层，并优先使用最少且必要的层级。"
        ),
        "recommended_block_keys": (
            "role.strict_json",
            "content.split_source_fidelity",
            "boundary.split_in_place",
            "output.mindmap_split_json",
        ),
    },
)
