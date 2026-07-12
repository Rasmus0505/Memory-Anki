from __future__ import annotations

from dataclasses import replace
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import (
    is_dashscope_compatible_provider,
    normalize_ai_runtime_options,
    resolve_provider_setting,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)
from memory_anki.modules.settings.application.ai_model_registry_contracts import (
    AiRuntimeOptions as RegistryAiRuntimeOptions,
)
from memory_anki.platform.application import (
    AiRuntimeOptions,
    PersistedAiRuntime,
    ResolvedAiRuntime,
)


class SettingsAiRuntimeProvider:
    """Session-bound adapter from the settings registry to the platform port."""

    def __init__(self, session: Session | None) -> None:
        self._session = session

    def normalize_options(self, value: Any) -> AiRuntimeOptions:
        options = normalize_ai_runtime_options(value)
        return AiRuntimeOptions(
            model=options.model,
            thinking_enabled=options.thinking_enabled,
            prompt_override=options.prompt_override,
        )

    def resolve(
        self,
        scenario_key: str,
        *,
        options: AiRuntimeOptions | None = None,
    ) -> ResolvedAiRuntime:
        registry_options = RegistryAiRuntimeOptions(
            model=options.model if options else None,
            thinking_enabled=options.thinking_enabled if options else None,
            prompt_override=options.prompt_override if options else None,
        )
        runtime = resolve_scenario_runtime(
            self._session,
            scenario_key,
            ai_options=registry_options,
        )
        metadata = serialize_resolved_ai_runtime(runtime)
        return ResolvedAiRuntime(
            scene_key=runtime.scene.key,
            scene_label=runtime.scene.label,
            model_key=runtime.model_key,
            model_label=runtime.model_label,
            model=runtime.model,
            provider=runtime.provider,
            model_type=runtime.model_type,
            has_vision=runtime.has_vision,
            thinking_enabled=runtime.thinking_enabled,
            supports_temperature=runtime.supports_temperature,
            structured_output_mode=runtime.structured_output_mode,
            input_price_per_million=runtime.input_price_per_million,
            output_price_per_million=runtime.output_price_per_million,
            cached_input_price_per_million=runtime.cached_input_price_per_million,
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            extra_payload=runtime.extra_payload,
            prompt_override=runtime.prompt_override,
            public_metadata=metadata,
        )
    def restore(self, snapshot: PersistedAiRuntime) -> ResolvedAiRuntime:
        resolved = self.resolve(
            snapshot.scenario_key,
            options=AiRuntimeOptions(
                model=snapshot.model,
                prompt_override=snapshot.prompt_override,
            ),
        )
        provider = snapshot.provider.strip().lower()
        if provider == "zhipu":
            api_key = resolve_provider_setting(self._session, "zhipu", kind="api_key")
        elif provider == "siliconflow":
            api_key = resolve_provider_setting(
                self._session,
                "siliconflow",
                kind="api_key",
            )
        elif provider == "deepseek":
            api_key = resolve_provider_setting(self._session, "deepseek", kind="api_key")
        elif is_dashscope_compatible_provider(provider):
            api_key = resolve_provider_setting(
                self._session,
                "dashscope",
                kind="api_key",
            )
        else:
            api_key = resolved.api_key
        return replace(
            resolved,
            model=snapshot.model,
            provider=snapshot.provider,
            api_key=api_key,
            base_url=snapshot.base_url,
            extra_payload=snapshot.extra_payload,
            prompt_override=snapshot.prompt_override,
        )

