from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import AiModelCatalog

from .ai_model_registry_catalog import (
    CATEGORIES,
    CATEGORY_BY_KEY,
    CONFIGURABLE_PROVIDER_KEYS,
    PROVIDER_API_KEY_CONFIG_KEYS,
    PROVIDER_BASE_URL_CONFIG_KEYS,
    PROVIDER_LABELS,
    SCENES,
    AiSceneDefinition,
    canonicalize_provider_config_scope,
    ensure_ai_model_catalog_seed,
    normalize_model_name,
)
from .ai_model_registry_contracts import AiModelType, AiProviderKey
from .ai_model_registry_insights import (
    _aggregate_provider_insights_by_config_scope,
    _load_ai_log_insights,
)
from .ai_model_registry_runtime import (
    build_fallback_model_metadata,
    infer_provider_for_unknown_model,
    mask_secret,
    resolve_category_config,
    resolve_current_model,
    resolve_current_thinking_enabled,
    resolve_provider_setting,
    resolve_provider_setting_source,
    serialize_model_row,
)


def list_provider_settings(
    session: Session,
    *,
    active_models: list[AiModelCatalog] | None = None,
    ai_log_insights: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    model_rows = active_models or []
    provider_model_counts: dict[AiProviderKey, int] = {}
    for row in model_rows:
        canonical_provider = canonicalize_provider_config_scope(
            str(row.provider or "").strip().lower()
        )
        if canonical_provider is None:
            continue
        provider_model_counts[canonical_provider] = (
            provider_model_counts.get(canonical_provider, 0) + 1
        )
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
                "base_url_config_key": PROVIDER_BASE_URL_CONFIG_KEYS[
                    normalized_provider
                ],
                "api_key_source": resolve_provider_setting_source(
                    session, normalized_provider, kind="api_key"
                ),
                "base_url_source": resolve_provider_setting_source(
                    session, normalized_provider, kind="base_url"
                ),
                "model_count": provider_model_counts.get(normalized_provider, 0),
                "last_called_at": provider_activity.get("last_called_at"),
                "last_status": provider_activity.get("last_status"),
                "last_success_at": provider_activity.get("last_success_at"),
                "last_error_at": provider_activity.get("last_error_at"),
                "last_model": provider_activity.get("last_model"),
            }
        )
    return providers


def _query_scene_candidate_rows(
    session: Session, scene: AiSceneDefinition
) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if scene.category_key == "vl" and scene.allow_visual_llm:
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | (
                (AiModelCatalog.model_type == "llm")
                & (AiModelCatalog.has_vision.is_(True))
            )
        )
    else:
        query = query.filter(AiModelCatalog.model_type == scene.category_key)
    return query.order_by(
        AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()
    ).all()


def _query_category_candidate_rows(
    session: Session, category_key: AiModelType
) -> list[AiModelCatalog]:
    query = session.query(AiModelCatalog).filter(AiModelCatalog.is_active.is_(True))
    if category_key == "vl":
        query = query.filter(
            (AiModelCatalog.model_type == "vl")
            | (
                (AiModelCatalog.model_type == "llm")
                & (AiModelCatalog.has_vision.is_(True))
            )
        )
    else:
        query = query.filter(AiModelCatalog.model_type == category_key)
    return query.order_by(
        AiModelCatalog.is_builtin.desc(), AiModelCatalog.display_name.asc()
    ).all()


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
            category_config.thinking_enabled
            if inherits_category_default
            else scene_thinking_enabled
        )
        scene_activity = latest_scene_activity.get(scene.key, {})
        available_models = [
            serialize_model_row(row) for row in _query_scene_candidate_rows(session, scene)
        ]
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
        scene_usage_by_model.setdefault(str(scene["effective_model"]), []).append(
            str(scene["label"])
        )
    categories = [
        {
            "key": category.key,
            "label": category.label,
            "description": category.description,
            "shared_model": category_configs[category.key].model,
            "shared_thinking_enabled": category_configs[category.key].thinking_enabled,
            "has_shared_config": category_configs[category.key].has_shared_config,
            "available_models": [
                serialize_model_row(row)
                for row in _query_category_candidate_rows(session, category.key)
            ],
            "scene_keys": [
                scene.key for scene in SCENES if scene.category_key == category.key
            ],
            "scene_details": [
                {
                    "key": scene.key,
                    "label": scene.label,
                    "description": scene.description,
                }
                for scene in SCENES
                if scene.category_key == category.key
            ],
            "scene_count": sum(
                1 for scene in scenes if scene["category_key"] == category.key
            ),
            "custom_scene_count": sum(
                1
                for scene in scenes
                if scene["category_key"] == category.key
                and not bool(scene["inherits_category_default"])
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
