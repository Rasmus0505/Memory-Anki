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
# Settings default cap for mindmap_ai_split_max_children config key.
AI_SPLIT_MAX_CHILDREN_LIMIT = 12
# Soft target for user-specified card/group count (no tight UI cap; server safety only).
AI_SPLIT_TARGET_CARD_COUNT_HARD_CAP = 99
# auto: unified replacement mode where the model chooses flat vs hierarchical structure.
# parallel/hierarchy remain accepted aliases for older clients.
AI_SPLIT_REPLACEMENT_MODES = ("auto", "parallel", "hierarchy")
# add_children: insert intermediate group cards under a parent and re-home first-level children.
# legacy_children is the historical alias for the same path.
AI_SPLIT_ADD_CHILDREN_MODE = "add_children"
AI_SPLIT_ADD_CHILDREN_ALIASES = (AI_SPLIT_ADD_CHILDREN_MODE, "legacy_children")
AI_SPLIT_DEFAULT_MAX_DEPTH = 4
AI_SPLIT_MAX_TOTAL_NODES = 40


MindMapAiSplitMode = str

class MindMapAiSplitError(ValueError):
    pass


@dataclass
class MindMapAiSplitConfig:
    api_key: str
    base_url: str
    model: str
    provider: str
    temperature: float
    max_children: int
    include_note: bool
    custom_instruction: str
    extra_payload: dict[str, Any] | None
    supports_temperature: bool


@dataclass
class MindMapAiSplitResult:
    editor_doc: dict[str, Any]
    generated_children_count: int
    reassigned_existing_children_count: int
    model: str
    ai_call_log_id: str | None = None
    resolved_ai: dict[str, Any] | None = None
    review_preview: dict[str, Any] | None = None
    split_mode: MindMapAiSplitMode = "add_children"
    replacement_node_count: int = 0
    replacement_nodes: list[dict[str, Any]] | None = None
    owner_id: str | None = None
    operation_id: str | None = None
