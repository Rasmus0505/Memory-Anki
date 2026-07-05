from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import AiModelCatalog, Config, ExternalAiCallLog
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    call_chat_completion_text,
)

from .ai_model_registry_catalog import (
    CATEGORIES,
    CATEGORY_BY_KEY,
    CONFIGURABLE_PROVIDER_KEYS,
    MODEL_TYPE_LABELS,
    PROVIDER_API_KEY_CONFIG_KEYS,
    PROVIDER_BASE_URL_CONFIG_KEYS,
    PROVIDER_LABELS,
    SCENES,
    AiSceneDefinition,
    canonicalize_provider_config_scope,
    category_model_config_key,
    category_thinking_config_key,
    ensure_ai_model_catalog_seed,
    normalize_provider_key,
    normalize_model_name,
)
from .ai_model_registry_contracts import AiModelRegistryError, AiModelType, AiProviderKey
from .ai_model_registry_runtime import (
    build_fallback_model_metadata,
    infer_provider_for_unknown_model,
    mask_secret,
    normalize_bool,
    resolve_category_config,
    resolve_current_model,
    resolve_current_thinking_enabled,
    resolve_provider_model_id,
    resolve_provider_setting,
    resolve_provider_setting_source,
    serialize_model_row,
)


def _aggregate_provider_insights_by_config_scope(
    provider_insights: dict[str, Any],
) -> dict[AiProviderKey, dict[str, Any]]:
    aggregated: dict[AiProviderKey, dict[str, Any]] = {}
    for provider_key, activity in provider_insights.items():
        canonical_provider = canonicalize_provider_config_scope(provider_key)
        if canonical_provider is None or not isinstance(activity, dict):
            continue
        existing = aggregated.setdefault(
            canonical_provider,
            {
                "last_called_at": None,
                "last_status": None,
                "last_model": None,
                "last_success_at": None,
                "last_error_at": None,
            },
        )
        last_called_at = activity.get("last_called_at")
        if last_called_at and (existing["last_called_at"] is None or last_called_at > existing["last_called_at"]):
            existing["last_called_at"] = last_called_at
            existing["last_status"] = activity.get("last_status")
            existing["last_model"] = activity.get("last_model")
        last_success_at = activity.get("last_success_at")
        if last_success_at and (
            existing["last_success_at"] is None or last_success_at > existing["last_success_at"]
        ):
            existing["last_success_at"] = last_success_at
        last_error_at = activity.get("last_error_at")
        if last_error_at and (
            existing["last_error_at"] is None or last_error_at > existing["last_error_at"]
        ):
            existing["last_error_at"] = last_error_at
    return aggregated


def _load_ai_log_insights(session: Session, *, limit: int = 800) -> dict[str, Any]:
    rows = (
        session.query(ExternalAiCallLog)
        .order_by(ExternalAiCallLog.created_at.desc(), ExternalAiCallLog.id.desc())
        .limit(max(1, min(limit, 5000)))
        .all()
    )
    latest_scene_success_runtime: dict[str, dict[str, Any]] = {}
    latest_scene_activity: dict[str, dict[str, Any]] = {}
    latest_provider_activity: dict[str, dict[str, Any]] = {}
    latest_model_activity: dict[str, dict[str, Any]] = {}
    recent_success_count = 0

    for row in rows:
        if row.status == "success":
            recent_success_count += 1
        created_at = row.created_at.isoformat() if row.created_at else None
        provider_entry = latest_provider_activity.setdefault(
            row.provider,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "last_model": row.model,
                "last_success_at": None,
                "last_error_at": None,
            },
        )
        if row.status == "success" and provider_entry["last_success_at"] is None:
            provider_entry["last_success_at"] = created_at
        if row.status == "error" and provider_entry["last_error_at"] is None:
            provider_entry["last_error_at"] = created_at

        model_entry = latest_model_activity.setdefault(
            row.model,
            {
                "last_used_at": created_at,
                "last_status": row.status,
            },
        )
        if model_entry["last_used_at"] is None:
            model_entry["last_used_at"] = created_at
            model_entry["last_status"] = row.status

        try:
            request_payload = json.loads(row.request_json or "{}")
        except json.JSONDecodeError:
            continue
        resolved_ai = request_payload.get("resolved_ai")
        if not isinstance(resolved_ai, dict):
            continue
        scene_key = str(resolved_ai.get("scene_key") or "").strip()
        if not scene_key:
            continue
        latest_scene_activity.setdefault(
            scene_key,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "resolved_provider": resolved_ai.get("provider"),
                "resolved_model_label": resolved_ai.get("model_label"),
                "latest_resolved_model": resolved_ai,
            },
        )
        if row.status == "success" and scene_key not in latest_scene_success_runtime:
            latest_scene_success_runtime[scene_key] = resolved_ai

    return {
        "recent_success_count": recent_success_count,
        "providers": latest_provider_activity,
        "models": latest_model_activity,
        "scenes": latest_scene_activity,
        "latest_scene_success_runtime": latest_scene_success_runtime,
    }


def list_provider_settings(
    session: Session,
    *,
    active_models: list[AiModelCatalog] | None = None,
    ai_log_insights: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    model_rows = active_models or []
    provider_model_counts: dict[AiProviderKey, int] = {}
    for row in model_rows:
        canonical_provider = canonicalize_provider_config_scope(str(row.provider or "").strip().lower())
        if canonical_provider is None:
            continue
        provider_model_counts[canonical_provider] = provider_model_counts.get(canonical_provider, 0) + 1
    provider_insights = _aggregate_provider_insights_by_config_scope(
        dict((ai_log_insights or {}).get("providers") or {})
    )
    providers: list[dict[str, Any]] = []
    for normalized_provider in CONFIGURABLE_PROVIDER_KEYS:
        api_key = resolve_provider_setting(session, normalized_provider, kind="api_key")
        base_url = resolve_provider_setting(session, normalized_provider, kind="base_url")
        provider_activity = provider_insights.get(normalized_provider, {})
        providers.append(
            {
                "key": normalized_provider,
                "label": PROVIDER_LABELS[normalized_provider],
                "api_key_masked": mask_secret(api_key),
                "has_api_key": bool(api_key),
                "base_url": base_url,
                "api_key_config_key": PROVIDER_API_KEY_CONFIG_KEYS[normalized_provider],
                "base_url_config_key": PROVIDER_BASE_URL_CONFIG_KEYS[normalized_provider],
                "api_key_source": resolve_provider_setting_source(session, normalized_provider, kind="api_key"),
                "base_url_source": resolve_provider_setting_source(session, normalized_provider, kind="base_url"),
                "model_count": provider_model_counts.get(normalized_provider, 0),
                "last_called_at": provider_activity.get("last_called_at"),
                "last_status": provider_activity.get("last_status"),
                "last_success_at": provider_activity.get("last_success_at"),
                "last_error_at": provider_activity.get("last_error_at"),
                "last_model": provider_activity.get("last_model"),
            }
        )
    return providers


def _query_scene_candidate_rows(session: Session, scene: AiSceneDefinition) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if scene.category_key == "vl" and scene.allow_visual_llm:
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | ((AiModelCatalog.model_type == "llm") & (AiModelCatalog.has_vision.is_(True)))
        )
    else:
        query = query.filter(AiModelCatalog.model_type == scene.category_key)
    return query.order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()).all()


def _query_category_candidate_rows(session: Session, category_key: AiModelType) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if category_key == "vl":
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | ((AiModelCatalog.model_type == "llm") & (AiModelCatalog.has_vision.is_(True)))
        )
    else:
        query = query.filter(AiModelCatalog.model_type == category_key)
    return query.order_by(AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()).all()


def list_model_scenarios(session: Session) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    active_models = (
        session.query(AiModelCatalog)
        .filter(AiModelCatalog.is_active.is_(True))
        .order_by(AiModelCatalog.model_type.asc(), AiModelCatalog.display_name.asc())
        .all()
    )
    ai_log_insights = _load_ai_log_insights(session)
    latest_scene_runtime = dict(ai_log_insights.get("latest_scene_success_runtime") or {})
    latest_scene_activity = dict(ai_log_insights.get("scenes") or {})
    scenes: list[dict[str, Any]] = []
    category_configs = {
        category.key: resolve_category_config(session, category.key)
        for category in CATEGORIES
    }
    for scene in SCENES:
        scene_model = resolve_current_model(
            session,
            scene.config_key,
            scene.default_model,
            fallback_config_keys=scene.legacy_config_keys,
        )
        scene_thinking_enabled = resolve_current_thinking_enabled(
            session,
            scene.thinking_config_key,
            default=False,
            fallback_config_keys=scene.legacy_thinking_config_keys,
        )
        category_config = category_configs[scene.category_key]
        inherits_category_default = bool(
            category_config.has_shared_config
            and category_config.model
            and scene_model == category_config.model
            and scene_thinking_enabled == category_config.thinking_enabled
        )
        effective_model = category_config.model if inherits_category_default else scene_model
        effective_thinking_enabled = (
            category_config.thinking_enabled if inherits_category_default else scene_thinking_enabled
        )
        scene_activity = latest_scene_activity.get(scene.key, {})
        available_models = [serialize_model_row(row) for row in _query_scene_candidate_rows(session, scene)]
        if scene_model and not any(item["key"] == scene_model for item in available_models):
            available_models.append(
                build_fallback_model_metadata(
                    scene_model,
                    model_type=scene.category_key,
                    provider=infer_provider_for_unknown_model(scene_model),
                    has_vision=(scene.category_key == "vl"),
                )
            )
        scenes.append(
            {
                "key": scene.key,
                "label": scene.label,
                "description": scene.description,
                "category_key": scene.category_key,
                "category_label": CATEGORY_BY_KEY[scene.category_key].label,
                "config_key": scene.config_key,
                "thinking_config_key": scene.thinking_config_key,
                "default_model": scene_model,
                "current_model": scene_model,
                "default_thinking_enabled": scene_thinking_enabled,
                "current_thinking_enabled": scene_thinking_enabled,
                "effective_model": effective_model,
                "effective_thinking_enabled": effective_thinking_enabled,
                "inherits_category_default": inherits_category_default,
                "available_models": available_models,
                "source_location": scene.source_location,
                "latest_resolved_model": latest_scene_runtime.get(scene.key),
                "last_called_at": scene_activity.get("last_called_at"),
                "last_status": scene_activity.get("last_status"),
                "resolved_provider": scene_activity.get("resolved_provider"),
                "resolved_model_label": scene_activity.get("resolved_model_label"),
            }
        )
    scene_usage_by_model: dict[str, list[str]] = {}
    for scene in scenes:
        scene_usage_by_model.setdefault(str(scene["effective_model"]), []).append(str(scene["label"]))
    categories = [
        {
            "key": category.key,
            "label": category.label,
            "description": category.description,
            "shared_model": category_configs[category.key].model,
            "shared_thinking_enabled": category_configs[category.key].thinking_enabled,
            "has_shared_config": category_configs[category.key].has_shared_config,
            "available_models": [
                serialize_model_row(row) for row in _query_category_candidate_rows(session, category.key)
            ],
            "scene_keys": [scene.key for scene in SCENES if scene.category_key == category.key],
            "scene_details": [
                {
                    "key": scene.key,
                    "label": scene.label,
                    "description": scene.description,
                }
                for scene in SCENES
                if scene.category_key == category.key
            ],
            "scene_count": sum(1 for scene in scenes if scene["category_key"] == category.key),
            "custom_scene_count": sum(
                1
                for scene in scenes
                if scene["category_key"] == category.key and not bool(scene["inherits_category_default"])
            ),
        }
        for category in CATEGORIES
    ]
    model_activity = dict(ai_log_insights.get("models") or {})
    serialized_models: list[dict[str, Any]] = []
    for row in active_models:
        serialized = serialize_model_row(row)
        usage_labels = scene_usage_by_model.get(row.key, [])
        latest_activity = model_activity.get(row.key, {})
        serialized.update(
            {
                "usage_count": len(usage_labels),
                "bound_scene_labels": usage_labels[:5],
                "last_used_at": latest_activity.get("last_used_at"),
                "last_status": latest_activity.get("last_status") or "never_used",
            }
        )
        serialized_models.append(serialized)
    providers_payload = list_provider_settings(
        session,
        active_models=active_models,
        ai_log_insights=ai_log_insights,
    )
    return {
        "providers": providers_payload,
        "categories": categories,
        "models": serialized_models,
        "scenes": scenes,
        "scenarios": scenes,
        "summary": {
            "provider_count": len(providers_payload),
            "active_model_count": len(active_models),
            "scene_count": len(scenes),
            "recent_success_call_count": int(ai_log_insights.get("recent_success_count") or 0),
        },
    }


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


def get_ai_model_impact(session: Session, model_key: str) -> dict[str, Any]:
    ensure_ai_model_catalog_seed(session)
    normalized_key = normalize_model_name(model_key)
    row = session.query(AiModelCatalog).filter_by(key=normalized_key).first()
    scene_impacts: list[dict[str, Any]] = []
    category_impacts: list[dict[str, Any]] = []
    for category in CATEGORIES:
        category_config = resolve_category_config(session, category.key)
        if category_config.has_shared_config and category_config.model == normalized_key:
            category_impacts.append(
                {
                    "key": category.key,
                    "label": category.label,
                }
            )
    for scene in SCENES:
        scene_model = resolve_current_model(
            session,
            scene.config_key,
            scene.default_model,
            fallback_config_keys=scene.legacy_config_keys,
        )
        if scene_model != normalized_key:
            continue
        scene_impacts.append(
            {
                "key": scene.key,
                "label": scene.label,
                "category_key": scene.category_key,
                "category_label": CATEGORY_BY_KEY[scene.category_key].label,
                "config_key": scene.config_key,
            }
        )
    return {
        "model_key": normalized_key,
        "model_label": row.display_name if row is not None else normalized_key,
        "exists": row is not None,
        "can_delete": len(scene_impacts) == 0 and len(category_impacts) == 0,
        "usage_count": len(scene_impacts),
        "bound_scene_labels": [item["label"] for item in scene_impacts],
        "scene_impacts": scene_impacts,
        "category_impacts": category_impacts,
    }


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
        return {
            "ok": True,
            "provider": provider,
            "provider_label": PROVIDER_LABELS.get(provider, provider),
            "model": candidate["key"],
            "latency_ms": latency_ms,
            "error": None,
            "source": source,
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
