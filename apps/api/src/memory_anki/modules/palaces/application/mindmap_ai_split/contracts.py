from __future__ import annotations

from dataclasses import dataclass
from typing import Any

AI_SPLIT_CONFIG_KEYS = (
    "mindmap_ai_split_api_key",
    "mindmap_ai_split_base_url",
    "mindmap_ai_split_model",
    "mindmap_ai_split_temperature",
    "mindmap_ai_split_max_children",
    "mindmap_ai_split_include_note",
    "mindmap_ai_split_custom_instruction",
)
AI_SPLIT_FALLBACK_BUCKET = "待归类"
AI_SPLIT_DEFAULT_TEMPERATURE = 0.2
AI_SPLIT_DEFAULT_MAX_CHILDREN = 5
AI_SPLIT_MAX_CHILDREN_LIMIT = 12

AI_SPLIT_SYSTEM_PROMPT = """你是一个严格输出 JSON 的脑图 AI 分卡助手。

任务：把当前目标节点拆成多个新的并列一级分类节点，并把已有一级子节点整体归类到这些新分类下面。

强制规则：
1. 只能输出 JSON 对象，不要输出 markdown，不要输出解释。
2. 绝对不要改写、重命名、拆分或合并任何“已有一级子节点”及其后代文字；它们只能整体搬家。
3. 只能新建“目标节点下一层”的并列分类节点；不要生成更深层的新结构。
4. new_children 只描述新建分类节点本身；child_assignments 只负责把已有一级子节点映射到某个新分类。
5. child_assignments 只能引用输入里提供的 source_ref；不能编造不存在的标识。
6. 新分类节点数量不要超过输入里的 max_children。
7. 输出格式必须严格为：
{
  "new_children": [
    {"id": "category_1", "text": "分类标题"}
  ],
  "child_assignments": [
    {"source_ref": "child_1", "target_new_child_id": "category_1"}
  ]
}
8. 如果目标节点当前没有旧子节点，child_assignments 返回空数组。
9. new_children 里的 text 必须简洁、适合做脑图小节点标题。
"""


class MindMapAiSplitError(ValueError):
    pass


@dataclass
class MindMapAiSplitConfig:
    api_key: str
    base_url: str
    model: str
    temperature: float
    max_children: int
    include_note: bool
    custom_instruction: str


@dataclass
class MindMapAiSplitResult:
    editor_doc: dict[str, Any]
    generated_children_count: int
    reassigned_existing_children_count: int
    model: str
    ai_call_log_id: str | None = None
