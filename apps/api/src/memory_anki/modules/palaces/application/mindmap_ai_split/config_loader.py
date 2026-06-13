from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_scenario_runtime,
)

from .contracts import (
    AI_SPLIT_CONFIG_KEYS,
    AI_SPLIT_DEFAULT_MAX_CHILDREN,
    AI_SPLIT_DEFAULT_TEMPERATURE,
    AI_SPLIT_MAX_CHILDREN_LIMIT,
    MindMapAiSplitConfig,
    MindMapAiSplitError,
)
from .primitives import coerce_bool, coerce_float, coerce_int, first_non_empty


def _config_value(session: Session, key: str) -> str:
    row = session.query(Config).filter_by(key=key).first()
    return str(row.value or "").strip() if row else ""


def resolve_config(
    session: Session,
    *,
    ai_options: AiRuntimeOptions | None = None,
    legacy_defaults: dict[str, Any] | None = None,
) -> MindMapAiSplitConfig:
    rows = session.query(Config).filter(Config.key.in_(AI_SPLIT_CONFIG_KEYS)).all()
    values = {row.key: row.value for row in rows}
    runtime = resolve_scenario_runtime(session, "ai_split", ai_options=ai_options)
    legacy_values = legacy_defaults or {}
    provider_api_key_key = f"{runtime.provider}_api_key"
    provider_base_url_key = f"{runtime.provider}_base_url"
    has_provider_api_key = bool(_config_value(session, provider_api_key_key))
    has_provider_base_url = bool(_config_value(session, provider_base_url_key))

    api_key = first_non_empty(values.get("mindmap_ai_split_api_key"))
    if not api_key:
        api_key = (
            str(runtime.api_key or "").strip()
            if has_provider_api_key
            else str(legacy_values.get("api_key") or "").strip()
        )
    if not api_key:
        raise MindMapAiSplitError(
            "未配置 AI 分卡 API Key。请在个人中心填写 DashScope 或 Zhipu 配置后再试。"
        )

    base_url = first_non_empty(values.get("mindmap_ai_split_base_url"))
    if not base_url:
        base_url = (
            str(runtime.base_url or "").strip()
            if has_provider_base_url
            else first_non_empty(legacy_values.get("base_url"), runtime.base_url)
        )
    if not base_url:
        raise MindMapAiSplitError("AI 分卡缺少 base_url 配置。")

    model = first_non_empty(
        values.get("mindmap_ai_split_model"),
        runtime.model if ai_options and ai_options.model else "",
        legacy_values.get("model"),
        runtime.model,
    )
    if not model:
        raise MindMapAiSplitError("AI 分卡缺少 model 配置。")

    return MindMapAiSplitConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        provider=runtime.provider,
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
        extra_payload=runtime.extra_payload,
        supports_temperature=runtime.supports_temperature,
    )
