from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from memory_anki.platform.application import AiRuntimeOptions as AiRuntimeOptions

AiProviderKey = Literal["dashscope", "qwen", "zhipu", "siliconflow", "deepseek"]
AiModelType = Literal["llm", "vl", "translation", "asr"]


class AiModelRegistryError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.details = details or {}
        self.code = code or "ai_model_registry_error"


@dataclass(frozen=True, slots=True)
class AiModelSeed:
    key: str
    display_name: str
    provider: AiProviderKey
    model_type: AiModelType
    has_vision: bool
    supports_thinking: bool
    supports_temperature: bool


@dataclass(frozen=True, slots=True)
class AiModelCategoryDefinition:
    key: AiModelType
    label: str
    description: str


@dataclass(frozen=True, slots=True)
class AiSceneDefinition:
    key: str
    label: str
    description: str
    category_key: AiModelType
    config_key: str
    thinking_config_key: str
    default_model: str
    source_location: str
    allow_visual_llm: bool = False
    legacy_config_keys: tuple[str, ...] = ()
    legacy_thinking_config_keys: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AiCategoryConfig:
    model: str | None
    thinking_enabled: bool
    has_shared_config: bool


@dataclass(frozen=True, slots=True)
class ResolvedAiModelRuntime:
    scene: AiSceneDefinition
    model_key: str
    model_label: str
    api_model: str
    provider: AiProviderKey
    model_type: AiModelType
    has_vision: bool
    thinking_enabled: bool
    supports_thinking: bool
    supports_temperature: bool
    structured_output_mode: str
    input_price_per_million: float | None
    output_price_per_million: float | None
    cached_input_price_per_million: float | None
    api_key: str
    base_url: str
    extra_payload: dict[str, Any] | None
    prompt_override: str | None = None

    @property
    def model(self) -> str:
        return self.api_model

    @property
    def modality(self) -> AiModelType:
        return self.model_type
