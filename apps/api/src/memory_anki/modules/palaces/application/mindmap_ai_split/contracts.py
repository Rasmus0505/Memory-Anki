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
