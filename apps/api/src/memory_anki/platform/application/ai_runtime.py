from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class AiRuntimeOptions:
    model: str | None = None
    thinking_enabled: bool | None = None
    prompt_override: str | None = None


@dataclass(frozen=True, slots=True)
class PersistedAiRuntime:
    scenario_key: str
    model: str
    provider: str
    base_url: str
    extra_payload: dict[str, Any] | None = None
    prompt_override: str | None = None


@dataclass(frozen=True, slots=True)
class ResolvedAiRuntime:
    scene_key: str
    scene_label: str
    model_key: str
    model_label: str
    model: str
    provider: str
    model_type: str
    has_vision: bool
    thinking_enabled: bool
    supports_temperature: bool
    structured_output_mode: str
    input_price_per_million: float | None
    output_price_per_million: float | None
    cached_input_price_per_million: float | None
    api_key: str
    base_url: str
    extra_payload: dict[str, Any] | None
    prompt_override: str | None
    public_metadata: dict[str, Any]


class AiRuntimeProvider(Protocol):
    """Resolve configured AI runtime details without exposing settings internals."""

    def normalize_options(self, value: Any) -> AiRuntimeOptions: ...

    def resolve(
        self,
        scenario_key: str,
        *,
        options: AiRuntimeOptions | None = None,
    ) -> ResolvedAiRuntime: ...

    def restore(self, snapshot: PersistedAiRuntime) -> ResolvedAiRuntime: ...


def persist_ai_runtime(runtime: ResolvedAiRuntime) -> PersistedAiRuntime:
    return PersistedAiRuntime(
        scenario_key=runtime.scene_key,
        model=runtime.model,
        provider=runtime.provider,
        base_url=runtime.base_url,
        extra_payload=runtime.extra_payload,
        prompt_override=runtime.prompt_override,
    )


def serialize_resolved_ai_runtime(runtime: ResolvedAiRuntime) -> dict[str, Any]:
    return dict(runtime.public_metadata)
