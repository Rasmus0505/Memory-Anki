from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config

from .contracts import (
    AI_SPLIT_CONFIG_KEYS,
    AI_SPLIT_DEFAULT_MAX_CHILDREN,
    AI_SPLIT_DEFAULT_TEMPERATURE,
    AI_SPLIT_MAX_CHILDREN_LIMIT,
    MindMapAiSplitConfig,
    MindMapAiSplitError,
)
from .primitives import coerce_bool, coerce_float, coerce_int, first_non_empty


def resolve_config(
    session: Session,
    *,
    default_api_key: str | None,
    default_base_url: str | None,
    default_model: str | None,
) -> MindMapAiSplitConfig:
    rows = session.query(Config).filter(Config.key.in_(AI_SPLIT_CONFIG_KEYS)).all()
    values = {row.key: row.value for row in rows}

    api_key = first_non_empty(values.get("mindmap_ai_split_api_key"), default_api_key)
    if not api_key:
        raise MindMapAiSplitError(
            "未配置 AI 分卡 API Key。请在个人中心填写，或设置 DASHSCOPE_API_KEY。"
        )

    base_url = first_non_empty(
        values.get("mindmap_ai_split_base_url"),
        default_base_url,
    )
    if not base_url:
        raise MindMapAiSplitError("AI 分卡缺少 base_url 配置。")

    model = first_non_empty(values.get("mindmap_ai_split_model"), default_model)
    if not model:
        raise MindMapAiSplitError("AI 分卡缺少 model 配置。")

    return MindMapAiSplitConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        temperature=coerce_float(
            values.get("mindmap_ai_split_temperature"),
            default=AI_SPLIT_DEFAULT_TEMPERATURE,
            minimum=0.0,
            maximum=2.0,
        ),
        max_children=coerce_int(
            values.get("mindmap_ai_split_max_children"),
            default=AI_SPLIT_DEFAULT_MAX_CHILDREN,
            minimum=1,
            maximum=AI_SPLIT_MAX_CHILDREN_LIMIT,
        ),
        include_note=coerce_bool(
            values.get("mindmap_ai_split_include_note"),
            default=True,
        ),
        custom_instruction=(values.get("mindmap_ai_split_custom_instruction") or "").strip(),
    )
