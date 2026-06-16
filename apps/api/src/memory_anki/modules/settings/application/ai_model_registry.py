from __future__ import annotations

from .ai_model_registry_admin import (
    delete_ai_model_catalog_item,
    get_ai_model_impact,
    list_model_scenarios,
    save_ai_model_settings,
    test_model_connection,
    test_provider_connection,
    upsert_ai_model_catalog_item,
)
from .ai_model_registry_catalog import ensure_ai_model_catalog_seed
from .ai_model_registry_contracts import (
    AiCategoryConfig,
    AiModelCategoryDefinition,
    AiModelRegistryError,
    AiModelSeed,
    AiModelType,
    AiProviderKey,
    AiRuntimeOptions,
    AiSceneDefinition,
    ResolvedAiModelRuntime,
)
from .ai_model_registry_runtime import (
    is_dashscope_compatible_provider,
    normalize_ai_runtime_options,
    resolve_current_model,
    resolve_current_thinking_enabled,
    resolve_provider_setting,
    resolve_provider_setting_source,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

__all__ = [
    "AiCategoryConfig",
    "AiModelCategoryDefinition",
    "AiModelRegistryError",
    "AiModelSeed",
    "AiModelType",
    "AiProviderKey",
    "AiRuntimeOptions",
    "AiSceneDefinition",
    "ResolvedAiModelRuntime",
    "delete_ai_model_catalog_item",
    "ensure_ai_model_catalog_seed",
    "get_ai_model_impact",
    "is_dashscope_compatible_provider",
    "list_model_scenarios",
    "normalize_ai_runtime_options",
    "resolve_current_model",
    "resolve_current_thinking_enabled",
    "resolve_provider_setting",
    "resolve_provider_setting_source",
    "resolve_scenario_runtime",
    "save_ai_model_settings",
    "serialize_resolved_ai_runtime",
    "test_model_connection",
    "test_provider_connection",
    "upsert_ai_model_catalog_item",
]
