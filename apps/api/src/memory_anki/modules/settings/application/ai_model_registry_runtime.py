from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import AiModelCatalog, Config

from .ai_model_registry_catalog import (
    CATEGORY_BY_KEY,
    MODEL_TYPE_LABELS,
    PROVIDER_API_KEY_CONFIG_KEYS,
    PROVIDER_BASE_URL_CONFIG_KEYS,
    PROVIDER_ENV_DEFAULTS,
    PROVIDER_HARDCODED_DEFAULTS,
    PROVIDER_LABELS,
    PROVIDER_MODEL_ALIASES,
    SCENE_BY_KEY,
    THINKING_PAYLOADS,
    category_model_config_key,
    category_thinking_config_key,
    normalize_model_name,
)
from .ai_model_registry_contracts import (
    AiCategoryConfig,
    AiModelType,
    AiProviderKey,
    AiRuntimeOptions,
    ResolvedAiModelRuntime,
)


def normalize_bool(value: Any, default: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return bool(default)


def mask_secret(value: str) -> str:
    secret = str(value or "").strip()
    if not secret:
        return ""
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}{'*' * max(4, len(secret) - 8)}{secret[-4:]}"


def serialize_model_row(row: AiModelCatalog) -> dict[str, Any]:
    label = row.display_name
    if row.model_type == "llm":
        label = f"{label}（{'有视觉' if row.has_vision else '无视觉'}）"
    return {
        "key": row.key,
        "label": label,
        "display_name": row.display_name,
        "provider": row.provider,
        "provider_label": PROVIDER_LABELS.get(row.provider, row.provider),
        "model_type": row.model_type,
        "model_type_label": MODEL_TYPE_LABELS.get(row.model_type, row.model_type),
        "has_vision": bool(row.has_vision),
        "supports_thinking": bool(row.supports_thinking),
        "supports_temperature": bool(row.supports_temperature),
        "is_builtin": bool(row.is_builtin),
        "is_active": bool(row.is_active),
        "default_base_url": PROVIDER_ENV_DEFAULTS.get(
            str(row.provider or "dashscope"), PROVIDER_ENV_DEFAULTS["dashscope"]
        )["base_url"],
    }


def build_fallback_model_metadata(
    model_key: str,
    *,
    model_type: AiModelType,
    provider: AiProviderKey = "dashscope",
    has_vision: bool = False,
) -> dict[str, Any]:
    row = AiModelCatalog(
        key=model_key,
        display_name=model_key,
        provider=provider,
        model_type=model_type,
        has_vision=has_vision,
        supports_thinking=False,
        supports_temperature=model_type != "asr",
        is_builtin=False,
        is_active=True,
    )
    return serialize_model_row(row)


def infer_provider_for_unknown_model(model_key: str) -> AiProviderKey:
    normalized = str(model_key or "").strip()
    lowered = normalized.lower()
    if lowered.startswith("deepseek-"):
        return "deepseek"
    if lowered.startswith("qwen"):
        return "qwen"
    if normalized in {"GLM-Z1-9B-0414", "Hunyuan-MT-7B"}:
        return "siliconflow"
    if normalized.lower().startswith("glm-"):
        return "zhipu"
    return "dashscope"


def is_dashscope_compatible_provider(provider: AiProviderKey | str) -> bool:
    return str(provider or "").strip().lower() in {"dashscope", "qwen"}


def first_config_value(session: Session | None, keys: tuple[str, ...]) -> str:
    if session is None:
        return ""
    for key in keys:
        row = session.query(Config).filter_by(key=key).first()
        if row and str(row.value or "").strip():
            return str(row.value or "").strip()
    return ""


def has_config_value(session: Session | None, keys: tuple[str, ...]) -> bool:
    return bool(first_config_value(session, keys))


def _load_config_snapshot(
    session: Session | None,
    keys: Iterable[str],
) -> dict[str, str]:
    normalized_keys = tuple(dict.fromkeys(key for key in keys if key))
    if session is None or not normalized_keys:
        return {}
    rows = session.query(Config).filter(Config.key.in_(normalized_keys)).all()
    return {str(row.key): str(row.value or "") for row in rows}


def _first_snapshot_value(config_values: dict[str, str], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = str(config_values.get(key) or "").strip()
        if value:
            return value
    return ""


def _snapshot_has_key(config_values: dict[str, str], keys: tuple[str, ...]) -> bool:
    return any(key in config_values for key in keys)


def _snapshot_has_value(config_values: dict[str, str], keys: tuple[str, ...]) -> bool:
    return bool(_first_snapshot_value(config_values, keys))


def _snapshot_bool(
    config_values: dict[str, str],
    keys: tuple[str, ...],
    *,
    default: bool = False,
) -> bool:
    for key in keys:
        if key in config_values:
            return normalize_bool(config_values[key], default=default)
    return bool(default)


def resolve_current_model(
    session: Session | None,
    config_key: str,
    env_default: str,
    *,
    fallback_config_keys: tuple[str, ...] = (),
) -> str:
    configured = first_config_value(session, (config_key, *fallback_config_keys))
    return configured or normalize_model_name(env_default)


def resolve_current_thinking_enabled(
    session: Session | None,
    thinking_config_key: str,
    *,
    default: bool = False,
    fallback_config_keys: tuple[str, ...] = (),
) -> bool:
    if session is not None:
        for key in (thinking_config_key, *fallback_config_keys):
            row = session.query(Config).filter_by(key=key).first()
            if row is not None:
                return normalize_bool(row.value, default=default)
    return bool(default)


def resolve_category_config(
    session: Session | None,
    category_key: AiModelType,
) -> AiCategoryConfig:
    model_key = category_model_config_key(category_key)
    configured_model = first_config_value(session, (model_key,))
    has_shared_config = has_config_value(session, (model_key,))
    thinking_enabled = False
    if has_shared_config and session is not None:
        row = session.query(Config).filter_by(key=category_thinking_config_key(category_key)).first()
        if row is not None:
            thinking_enabled = normalize_bool(row.value, default=False)
    return AiCategoryConfig(
        model=configured_model or None,
        thinking_enabled=thinking_enabled,
        has_shared_config=has_shared_config,
    )


def resolve_provider_setting(
    session: Session | None,
    provider: AiProviderKey,
    *,
    kind: Literal["api_key", "base_url"],
) -> str:
    config_key = (
        PROVIDER_API_KEY_CONFIG_KEYS[provider]
        if kind == "api_key"
        else PROVIDER_BASE_URL_CONFIG_KEYS[provider]
    )
    env_default = PROVIDER_ENV_DEFAULTS[provider][kind]
    if session is not None:
        row = session.query(Config).filter_by(key=config_key).first()
        if row is not None and str(row.value or "").strip():
            return str(row.value or "").strip()
    return str(env_default or "").strip()


def resolve_provider_setting_source(
    session: Session | None,
    provider: AiProviderKey,
    *,
    kind: Literal["api_key", "base_url"],
) -> Literal["db", "env", "default"]:
    config_key = (
        PROVIDER_API_KEY_CONFIG_KEYS[provider]
        if kind == "api_key"
        else PROVIDER_BASE_URL_CONFIG_KEYS[provider]
    )
    if session is not None:
        row = session.query(Config).filter_by(key=config_key).first()
        if row is not None and str(row.value or "").strip():
            return "db"
    env_default = str(PROVIDER_ENV_DEFAULTS[provider][kind] or "").strip()
    hardcoded_default = str(PROVIDER_HARDCODED_DEFAULTS[provider][kind] or "").strip()
    if env_default and env_default != hardcoded_default:
        return "env"
    if kind == "api_key" and env_default:
        return "env"
    return "default"


def normalize_ai_runtime_options(value: Any) -> AiRuntimeOptions:
    if not isinstance(value, dict):
        return AiRuntimeOptions()
    model = normalize_model_name(value.get("model"))
    raw_thinking = value.get("thinking_enabled")
    thinking_enabled = None if raw_thinking is None else normalize_bool(raw_thinking)
    raw_prompt_override = value.get("prompt_override")
    prompt_override = (
        str(raw_prompt_override).strip()
        if isinstance(raw_prompt_override, str) and raw_prompt_override.strip()
        else None
    )
    return AiRuntimeOptions(
        model=model or None,
        thinking_enabled=thinking_enabled,
        prompt_override=prompt_override,
    )


def _get_catalog_row_by_key(session: Session | None, model_key: str) -> AiModelCatalog | None:
    if session is None or not model_key:
        return None
    return session.query(AiModelCatalog).filter_by(key=model_key).first()


def _build_thinking_payload(
    *,
    provider: AiProviderKey,
    supports_thinking: bool,
    thinking_enabled: bool,
) -> dict[str, Any] | None:
    if not supports_thinking:
        return None
    enabled_value, disabled_value = THINKING_PAYLOADS[provider]
    return {
        "thinking": {
            "type": enabled_value if thinking_enabled else disabled_value,
        }
    }


def resolve_provider_model_id(provider: AiProviderKey, model_key: str) -> str:
    normalized_key = str(model_key or "").strip()
    if not normalized_key:
        return normalized_key
    return PROVIDER_MODEL_ALIASES.get(provider, {}).get(normalized_key, normalized_key)


def resolve_scenario_runtime(
    session: Session | None,
    scenario_key: str,
    *,
    ai_options: AiRuntimeOptions | None = None,
) -> ResolvedAiModelRuntime:
    scene = SCENE_BY_KEY.get(str(scenario_key or ""))
    if scene is None:
        raise KeyError(f"unknown ai scenario: {scenario_key}")
    runtime_options = ai_options or AiRuntimeOptions()
    category_model_key = category_model_config_key(scene.category_key)
    category_thinking_key = category_thinking_config_key(scene.category_key)
    config_values = _load_config_snapshot(
        session,
        (
            scene.config_key,
            *scene.legacy_config_keys,
            scene.thinking_config_key,
            *scene.legacy_thinking_config_keys,
            category_model_key,
            category_thinking_key,
        ),
    )
    scene_model_keys = (scene.config_key, *scene.legacy_config_keys)
    scene_thinking_keys = (scene.thinking_config_key, *scene.legacy_thinking_config_keys)
    scene_has_explicit_model = _snapshot_has_value(config_values, scene_model_keys)
    scene_configured_model = _first_snapshot_value(config_values, scene_model_keys)
    category_config = AiCategoryConfig(
        model=_first_snapshot_value(config_values, (category_model_key,)) or None,
        thinking_enabled=_snapshot_bool(config_values, (category_thinking_key,), default=False),
        has_shared_config=_snapshot_has_value(config_values, (category_model_key,)),
    )
    configured_model = (
        scene_configured_model
        if scene_has_explicit_model
        else category_config.model or normalize_model_name(scene.default_model)
    )
    resolved_model_key = runtime_options.model or configured_model
    row = _get_catalog_row_by_key(session, resolved_model_key)
    if row is None:
        provider = infer_provider_for_unknown_model(resolved_model_key)
        model_meta = build_fallback_model_metadata(
            resolved_model_key,
            model_type=scene.category_key,
            provider=provider,
            has_vision=(scene.category_key == "vl"),
        )
    else:
        model_meta = serialize_model_row(row)
    scene_has_explicit_thinking = _snapshot_has_key(config_values, scene_thinking_keys)
    scene_default_thinking_enabled = _snapshot_bool(config_values, scene_thinking_keys, default=False)
    default_thinking_enabled = (
        scene_default_thinking_enabled
        if scene_has_explicit_thinking
        else category_config.thinking_enabled
        if category_config.has_shared_config and category_config.model
        else scene_default_thinking_enabled
    )
    requested_thinking_enabled = (
        runtime_options.thinking_enabled
        if runtime_options.thinking_enabled is not None
        else default_thinking_enabled
    )
    provider = str(model_meta["provider"])
    supports_thinking = bool(model_meta["supports_thinking"])
    effective_thinking_enabled = bool(requested_thinking_enabled and supports_thinking)
    provider_config_values = _load_config_snapshot(
        session,
        (
            PROVIDER_API_KEY_CONFIG_KEYS[provider],  # type: ignore[index]
            PROVIDER_BASE_URL_CONFIG_KEYS[provider],  # type: ignore[index]
        ),
    )
    api_key = (
        _first_snapshot_value(provider_config_values, (PROVIDER_API_KEY_CONFIG_KEYS[provider],))  # type: ignore[index]
        or str(PROVIDER_ENV_DEFAULTS[provider]["api_key"] or "").strip()  # type: ignore[index]
    )
    base_url = (
        _first_snapshot_value(provider_config_values, (PROVIDER_BASE_URL_CONFIG_KEYS[provider],))  # type: ignore[index]
        or str(PROVIDER_ENV_DEFAULTS[provider]["base_url"] or "").strip()  # type: ignore[index]
        or str(model_meta["default_base_url"] or "")
    )
    return ResolvedAiModelRuntime(
        scene=scene,
        model_key=str(model_meta["key"]),
        model_label=str(model_meta["label"]),
        api_model=resolve_provider_model_id(provider, str(model_meta["key"])),  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        model_type=str(model_meta["model_type"]),  # type: ignore[arg-type]
        has_vision=bool(model_meta["has_vision"]),
        thinking_enabled=effective_thinking_enabled,
        supports_thinking=supports_thinking,
        supports_temperature=bool(model_meta["supports_temperature"]),
        api_key=api_key,
        base_url=base_url,
        extra_payload=_build_thinking_payload(
            provider=provider,  # type: ignore[arg-type]
            supports_thinking=supports_thinking,
            thinking_enabled=effective_thinking_enabled,
        ),
        prompt_override=runtime_options.prompt_override,
    )


def serialize_resolved_ai_runtime(runtime: ResolvedAiModelRuntime) -> dict[str, Any]:
    return {
        "scene_key": runtime.scene.key,
        "scene_label": runtime.scene.label,
        "model_key": runtime.model_key,
        "model_label": runtime.model_label,
        "api_model": runtime.api_model,
        "provider": runtime.provider,
        "provider_label": PROVIDER_LABELS.get(runtime.provider, runtime.provider),
        "model_type": runtime.model_type,
        "model_type_label": MODEL_TYPE_LABELS.get(runtime.model_type, runtime.model_type),
        "has_vision": runtime.has_vision,
        "thinking_enabled": runtime.thinking_enabled,
    }
