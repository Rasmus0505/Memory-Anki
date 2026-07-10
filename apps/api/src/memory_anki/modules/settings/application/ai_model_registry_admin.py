from __future__ import annotations

import time
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import AiModelCatalog, Config
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    call_chat_completion_text,
)

from .ai_model_registry_catalog import (
    CATEGORY_BY_KEY,
    MODEL_TYPE_LABELS,
    PROVIDER_API_KEY_CONFIG_KEYS,
    PROVIDER_BASE_URL_CONFIG_KEYS,
    PROVIDER_LABELS,
    SCENES,
    category_model_config_key,
    category_thinking_config_key,
    ensure_ai_model_catalog_seed,
    normalize_model_name,
    normalize_provider_key,
)
from .ai_model_registry_contracts import AiModelRegistryError, AiModelType, AiProviderKey
from .ai_model_registry_insights import (
    _aggregate_provider_insights_by_config_scope as _aggregate_provider_insights_by_config_scope,
)
from .ai_model_registry_insights import (
    _load_ai_log_insights as _load_ai_log_insights,
)
from .ai_model_registry_runtime import (
    normalize_bool,
    resolve_provider_model_id,
    resolve_provider_setting,
    resolve_provider_setting_source,
    serialize_model_row,
)
from .ai_model_registry_scenarios import (
    _query_category_candidate_rows as _query_category_candidate_rows,
)
from .ai_model_registry_scenarios import (
    _query_scene_candidate_rows as _query_scene_candidate_rows,
)
from .ai_model_registry_scenarios import (
    get_ai_model_impact as get_ai_model_impact,
)
from .ai_model_registry_scenarios import (
    list_model_scenarios as list_model_scenarios,
)
from .ai_model_registry_scenarios import (
    list_provider_settings as list_provider_settings,
)

__all__ = [
    "_aggregate_provider_insights_by_config_scope",
    "_load_ai_log_insights",
    "_pick_provider_test_model",
    "_query_category_candidate_rows",
    "_query_scene_candidate_rows",
    "_upsert_config_value",
    "delete_ai_model_catalog_item",
    "get_ai_model_impact",
    "list_model_scenarios",
    "list_provider_settings",
    "save_ai_model_settings",
    "test_model_connection",
    "test_provider_connection",
    "upsert_ai_model_catalog_item",
]


def save_ai_model_settings(
    session: Session,
    *,
    scene_updates: dict[str, Any] | None = None,
    category_updates: dict[str, Any] | None = None,
    provider_updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    for category_key, payload in dict(category_updates or {}).items():
        normalized_category = str(category_key or "").strip().lower()
        if normalized_category not in CATEGORY_BY_KEY or not isinstance(payload, dict):
            continue
        typed_category = normalized_category  # type: ignore[assignment]
        model_name = normalize_model_name(payload.get("default_model"))
        if model_name:
            _upsert_config_value(session, category_model_config_key(typed_category), model_name)
            _upsert_config_value(
                session,
                category_thinking_config_key(typed_category),
                "true" if normalize_bool(payload.get("default_thinking_enabled")) else "false",
            )
            if normalize_bool(payload.get("apply_to_scenes"), default=True):
                for scene in SCENES:
                    if scene.category_key != typed_category:
                        continue
                    _upsert_config_value(session, scene.config_key, model_name)
                    _upsert_config_value(
                        session,
                        scene.thinking_config_key,
                        "true" if normalize_bool(payload.get("default_thinking_enabled")) else "false",
                    )

    for scene_key, payload in dict(scene_updates or {}).items():
        scene = next((item for item in SCENES if item.key == str(scene_key or "").strip()), None)
        if scene is None or not isinstance(payload, dict):
            continue
        model_name = normalize_model_name(payload.get("default_model") or payload.get("current_model"))
        if model_name:
            _upsert_config_value(session, scene.config_key, model_name)
        if "default_thinking_enabled" in payload or "current_thinking_enabled" in payload:
            raw_thinking = (
                payload.get("default_thinking_enabled")
                if "default_thinking_enabled" in payload
                else payload.get("current_thinking_enabled")
            )
            _upsert_config_value(
                session,
                scene.thinking_config_key,
                "true" if normalize_bool(raw_thinking) else "false",
            )

    for provider_key, payload in dict(provider_updates or {}).items():
        normalized_provider = normalize_provider_key(provider_key)
        if normalized_provider is None or not isinstance(payload, dict):
            continue
        if "api_key" in payload:
            _upsert_config_value(
                session,
                PROVIDER_API_KEY_CONFIG_KEYS[normalized_provider],
                str(payload.get("api_key") or "").strip(),
            )
        if "base_url" in payload:
            _upsert_config_value(
                session,
                PROVIDER_BASE_URL_CONFIG_KEYS[normalized_provider],
                str(payload.get("base_url") or "").strip(),
            )
    session.commit()
    return list_model_scenarios(session)


def _pick_provider_test_model(
    session: Session,
    provider: AiProviderKey,
    *,
    model_key: str | None = None,
) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_model_key = normalize_model_name(model_key)
    if normalized_model_key:
        row = session.query(AiModelCatalog).filter_by(key=normalized_model_key).first()
        if row is None:
            raise AiModelRegistryError("要测试的模型不存在。", code="model_not_found")
        return serialize_model_row(row)

    ordered_model_types: tuple[AiModelType, ...] = ("llm", "translation", "vl", "asr")
    for model_type in ordered_model_types:
        row = (
            session.query(AiModelCatalog)
            .filter(
                AiModelCatalog.is_active.is_(True),
                AiModelCatalog.provider == provider,
                AiModelCatalog.model_type == model_type,
            )
            .order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc())
            .first()
        )
        if row is not None:
            return serialize_model_row(row)
    raise AiModelRegistryError("当前 Provider 下没有可用于测试的活跃模型。", code="model_not_found")


def test_provider_connection(
    session: Session,
    provider: AiProviderKey,
    *,
    model_key: str | None = None,
) -> dict[str, Any]:
    candidate = _pick_provider_test_model(session, provider, model_key=model_key)
    api_key = resolve_provider_setting(session, provider, kind="api_key")
    source = resolve_provider_setting_source(session, provider, kind="api_key")
    base_url = resolve_provider_setting(session, provider, kind="base_url") or str(candidate["default_base_url"] or "")
    if not api_key:
        return {
            "ok": False,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": 0,
            "error": "未配置对应 Provider 的 API Key。",
            "source": source,
        }
    config = OpenAICompatibleChatConfig(
        api_key=api_key,
        base_url=base_url,
        model=resolve_provider_model_id(provider, str(candidate["key"])),
        temperature=(0.0 if bool(candidate["supports_temperature"]) else None),
        timeout_seconds=15.0,
    )
    started = time.perf_counter()
    try:
        call_chat_completion_text(
            config=config,
            messages=[{"role": "user", "content": "Reply with OK."}],
            extra_payload={"max_tokens": 8},
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        suggested_mode = "prompt_only"
        probe_errors: dict[str, str] = {}
        for mode, response_format in (
            (
                "json_schema",
                {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "connection_probe",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {"ok": {"type": "boolean"}},
                            "required": ["ok"],
                            "additionalProperties": False,
                        },
                    },
                },
            ),
            ("json_object", {"type": "json_object"}),
        ):
            try:
                call_chat_completion_text(
                    config=config,
                    messages=[{"role": "user", "content": 'Return JSON: {"ok": true}'}],
                    response_format=response_format,
                    extra_payload={"max_tokens": 24},
                )
                suggested_mode = mode
                break
            except OpenAICompatibleError as exc:
                probe_errors[mode] = str(exc)
        return {
            "ok": True,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": latency_ms,
            "error": None,
            "source": source,
            "structured_output_probe": {
                "suggested_mode": suggested_mode,
                "current_mode": candidate.get("structured_output_mode", "json_object"),
                "errors": probe_errors,
                "requires_confirmation": suggested_mode != candidate.get("structured_output_mode"),
            },
        }
    except OpenAICompatibleError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": latency_ms,
            "error": str(exc),
            "source": source,
        }


def test_model_connection(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    if row is None:
        raise AiModelRegistryError("要测试的模型不存在。", code="model_not_found")
    return test_provider_connection(session, row.provider, model_key=normalized_key)


def upsert_ai_model_catalog_item(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    model_key = normalize_model_name(payload.get("key"))
    if not model_key:
        raise AiModelRegistryError("模型 key 不能为空。")
    provider = normalize_provider_key(payload.get("provider"))
    if provider is None:
        raise AiModelRegistryError("模型 Provider 无效。")
    model_type = str(payload.get("model_type") or "").strip().lower()
    if model_type not in MODEL_TYPE_LABELS:
        raise AiModelRegistryError("模型类型无效。")
    display_name = normalize_model_name(payload.get("display_name")) or model_key
    row = session.query(AiModelCatalog).filter_by(key=model_key).first()
    if row is None:
        row = AiModelCatalog(key=model_key)
        session.add(row)
    row.display_name = display_name
    row.provider = provider
    row.model_type = model_type
    row.has_vision = bool(payload.get("has_vision"))
    row.supports_thinking = bool(payload.get("supports_thinking"))
    row.supports_temperature = bool(payload.get("supports_temperature", model_type != "asr"))
    structured_output_mode = str(payload.get("structured_output_mode") or "json_object").strip()
    if structured_output_mode not in {"json_schema", "json_object", "prompt_only"}:
        raise AiModelRegistryError("结构化输出模式无效。")
    row.structured_output_mode = structured_output_mode
    for field_name in (
        "input_price_per_million",
        "output_price_per_million",
        "cached_input_price_per_million",
    ):
        value = payload.get(field_name)
        if value in {None, ""}:
            setattr(row, field_name, None)
            continue
        try:
            price = float(value)
        except (TypeError, ValueError) as exc:
            raise AiModelRegistryError("模型价格必须是非负数字。") from exc
        if price < 0:
            raise AiModelRegistryError("模型价格必须是非负数字。")
        setattr(row, field_name, price)
    row.is_builtin = bool(row.is_builtin)
    row.is_active = True
    session.commit()
    return list_model_scenarios(session)


def delete_ai_model_catalog_item(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    if row is None:
        raise AiModelRegistryError("要删除的模型不存在。", code="model_not_found")
    impact = get_ai_model_impact(session, normalized_key)
    if not bool(impact.get("can_delete")):
        raise AiModelRegistryError(
            "该模型仍被场景或分类配置使用，暂时不能删除。",
            details=impact,
            code="model_in_use",
        )
    row.is_active = False
    session.commit()
    return list_model_scenarios(session)


def _upsert_config_value(session: Session, key: str, value: str) -> None:
    row = session.query(Config).filter_by(key=key).first()
    if row is not None:
        row.value = value
        return
    session.add(Config(key=key, value=value))
