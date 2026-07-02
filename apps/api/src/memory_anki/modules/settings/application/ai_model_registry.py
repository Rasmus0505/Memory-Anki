from __future__ import annotations

from memory_anki.infrastructure.llm import call_chat_completion_text as call_chat_completion_text
from . import ai_model_registry_admin as _admin
from . import ai_model_registry_runtime as _runtime
from .ai_model_registry_admin import (
    call_chat_completion_text as call_chat_completion_text,
    delete_ai_model_catalog_item,
    get_ai_model_impact,
    list_model_scenarios,
    save_ai_model_settings,
    test_model_connection,
    test_provider_connection,
    upsert_ai_model_catalog_item,
)
from .ai_model_registry_catalog import (
    PROVIDER_ENV_DEFAULTS as PROVIDER_ENV_DEFAULTS,
    ensure_ai_model_catalog_seed,
)
from .ai_model_registry_catalog import PROVIDER_ENV_DEFAULTS as PROVIDER_ENV_DEFAULTS
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


def _sync_facade_dependencies() -> None:
    _admin.call_chat_completion_text = call_chat_completion_text
    _runtime.PROVIDER_ENV_DEFAULTS = PROVIDER_ENV_DEFAULTS


def test_provider_connection(*args, **kwargs):
    _sync_facade_dependencies()
    return _admin.test_provider_connection(*args, **kwargs)


def test_model_connection(*args, **kwargs):
    _sync_facade_dependencies()
    return _admin.test_model_connection(*args, **kwargs)

__all__ = [
    "AiCategoryConfig",
    "AiModelCategoryDefinition",
    "AiModelRegistryError",
    "AiModelSeed",
    "AiModelType",
    "AiProviderKey",
    "AiRuntimeOptions",
    "call_chat_completion_text",
    "AiSceneDefinition",
    "PROVIDER_ENV_DEFAULTS",
    "ResolvedAiModelRuntime",
    "call_chat_completion_text",
    "delete_ai_model_catalog_item",
    "ensure_ai_model_catalog_seed",
    "get_ai_model_impact",
    "is_dashscope_compatible_provider",
    "list_model_scenarios",
    "normalize_ai_runtime_options",
    "PROVIDER_ENV_DEFAULTS",
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
