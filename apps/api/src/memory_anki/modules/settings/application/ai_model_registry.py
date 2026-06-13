from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_ASR_MODEL,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
    DASHSCOPE_VISION_MODEL,
    ENGLISH_TRANSLATION_MODEL,
    ZHIPU_API_KEY,
    ZHIPU_BASE_URL,
)
from memory_anki.infrastructure.db.models import Config

AiProviderKey = Literal["dashscope", "zhipu"]
AiModality = Literal["text", "vision", "translation", "tts", "asr"]

PROVIDER_API_KEY_CONFIG_KEYS = {
    "dashscope": "dashscope_api_key",
    "zhipu": "zhipu_api_key",
}
PROVIDER_BASE_URL_CONFIG_KEYS = {
    "dashscope": "dashscope_base_url",
    "zhipu": "zhipu_base_url",
}
PROVIDER_ENV_DEFAULTS = {
    "dashscope": {
        "api_key": str(DASHSCOPE_API_KEY or "").strip(),
        "base_url": str(DASHSCOPE_BASE_URL or "").strip(),
    },
    "zhipu": {
        "api_key": str(ZHIPU_API_KEY or "").strip(),
        "base_url": str(ZHIPU_BASE_URL or "").strip(),
    },
}
THINKING_PAYLOADS: dict[AiProviderKey, tuple[str, str]] = {
    "dashscope": ("enable_thinking", "thinking"),
    "zhipu": ("enabled", "disabled"),
}


@dataclass(frozen=True, slots=True)
class AiModelDefinition:
    key: str
    label: str
    provider: AiProviderKey
    modality: AiModality
    supports_thinking: bool
    supports_temperature: bool
    default_base_url: str


@dataclass(frozen=True, slots=True)
class AiModelScenario:
    key: str
    label: str
    description: str
    category: str
    config_key: str
    thinking_config_key: str
    default_model: str
    available_models: tuple[str, ...]
    source_location: str


@dataclass(frozen=True, slots=True)
class AiRuntimeOptions:
    model: str | None = None
    thinking_enabled: bool | None = None


@dataclass(frozen=True, slots=True)
class ResolvedAiModelRuntime:
    scenario: AiModelScenario
    model: str
    thinking_enabled: bool
    provider: AiProviderKey
    modality: AiModality
    supports_thinking: bool
    supports_temperature: bool
    api_key: str
    base_url: str
    extra_payload: dict[str, Any] | None


MODEL_DEFINITIONS: tuple[AiModelDefinition, ...] = (
    AiModelDefinition(
        key="qwen3-vl-flash",
        label="Qwen3 VL Flash",
        provider="dashscope",
        modality="vision",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen3-vl-plus",
        label="Qwen3 VL Plus",
        provider="dashscope",
        modality="vision",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-vl-max",
        label="Qwen VL Max",
        provider="dashscope",
        modality="vision",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-vl-plus",
        label="Qwen VL Plus",
        provider="dashscope",
        modality="vision",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="glm-4.6v-flash",
        label="GLM 4.6V Flash",
        provider="zhipu",
        modality="vision",
        supports_thinking=True,
        supports_temperature=True,
        default_base_url=ZHIPU_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen3.6-flash",
        label="Qwen3.6 Flash",
        provider="dashscope",
        modality="text",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-plus",
        label="Qwen Plus",
        provider="dashscope",
        modality="text",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-max",
        label="Qwen Max",
        provider="dashscope",
        modality="text",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-turbo",
        label="Qwen Turbo",
        provider="dashscope",
        modality="text",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen3-235b-a22b",
        label="Qwen3 235B A22B",
        provider="dashscope",
        modality="text",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="glm-4.7-flash",
        label="GLM 4.7 Flash",
        provider="zhipu",
        modality="text",
        supports_thinking=True,
        supports_temperature=True,
        default_base_url=ZHIPU_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-mt-flash",
        label="Qwen MT Flash",
        provider="dashscope",
        modality="translation",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-mt-plus",
        label="Qwen MT Plus",
        provider="dashscope",
        modality="translation",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen-mt-turbo",
        label="Qwen MT Turbo",
        provider="dashscope",
        modality="translation",
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="cosyvoice-v3-flash",
        label="CosyVoice V3 Flash",
        provider="dashscope",
        modality="tts",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="cosyvoice-v3",
        label="CosyVoice V3",
        provider="dashscope",
        modality="tts",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="cosyvoice-v2",
        label="CosyVoice V2",
        provider="dashscope",
        modality="tts",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="qwen3-asr-flash-filetrans",
        label="Qwen3 ASR Flash Filetrans",
        provider="dashscope",
        modality="asr",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="paraformer-v2",
        label="Paraformer V2",
        provider="dashscope",
        modality="asr",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
    AiModelDefinition(
        key="fun-asr",
        label="Fun ASR",
        provider="dashscope",
        modality="asr",
        supports_thinking=False,
        supports_temperature=False,
        default_base_url=DASHSCOPE_BASE_URL,
    ),
)

MODEL_DEFINITION_BY_KEY = {item.key: item for item in MODEL_DEFINITIONS}

MODEL_SCENARIOS: tuple[AiModelScenario, ...] = (
    AiModelScenario(
        key="vision",
        label="视觉识别（PDF/图片导入）",
        description="将 PDF 页面或图片识别为脑图结构、正文 OCR 和页面合并时使用的视觉模型。",
        category="视觉",
        config_key="ai_model_vision",
        thinking_config_key="ai_model_vision_thinking_enabled",
        default_model=DASHSCOPE_VISION_MODEL,
        available_models=(
            "qwen3-vl-flash",
            "qwen3-vl-plus",
            "qwen-vl-max",
            "qwen-vl-plus",
            "glm-4.6v-flash",
        ),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_import_service.py",
    ),
    AiModelScenario(
        key="ai_split",
        label="AI 分卡（脑图节点拆分）",
        description="将脑图节点的已有子节点按语义拆分成新的分类节点时使用的文本模型。",
        category="文本",
        config_key="mindmap_ai_split_model",
        thinking_config_key="mindmap_ai_split_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        available_models=(
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen-turbo",
            "qwen3-235b-a22b",
            "glm-4.7-flash",
        ),
        source_location="apps/api/src/memory_anki/modules/palaces/application/mindmap_ai_split/config_loader.py",
    ),
    AiModelScenario(
        key="english_reading",
        label="英语阅读（句子改编+词形分类）",
        description="英语阅读材料生成与句子改编使用的文本模型。",
        category="文本",
        config_key="ai_model_text",
        thinking_config_key="ai_model_text_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        available_models=(
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen-turbo",
            "qwen3-235b-a22b",
            "glm-4.7-flash",
        ),
        source_location="apps/api/src/memory_anki/modules/english_reading/application/service.py",
    ),
    AiModelScenario(
        key="quiz_text",
        label="宫殿做题（简答点评）",
        description="为宫殿简答题生成 AI 点评时使用的文本模型。",
        category="文本",
        config_key="ai_model_quiz_text",
        thinking_config_key="ai_model_quiz_text_thinking_enabled",
        default_model=DASHSCOPE_TEXT_MODEL,
        available_models=(
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen-turbo",
            "qwen3-235b-a22b",
            "glm-4.7-flash",
        ),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiModelScenario(
        key="quiz_mini_palace",
        label="宫殿做题（小宫殿归类）",
        description="把大宫殿题目归类到小宫殿，或把新生成题目按小宫殿分组时使用的文本模型。",
        category="文本",
        config_key="ai_model_quiz_mini_palace",
        thinking_config_key="ai_model_quiz_mini_palace_thinking_enabled",
        default_model="qwen-turbo",
        available_models=(
            "qwen-turbo",
            "qwen3.6-flash",
            "qwen-plus",
            "qwen-max",
            "qwen3-235b-a22b",
            "glm-4.7-flash",
        ),
        source_location="apps/api/src/memory_anki/modules/palace_quiz/application/ai_service.py",
    ),
    AiModelScenario(
        key="translation",
        label="英语翻译",
        description="将英语句子或英语课程句子批量翻译为中文时使用的翻译模型。",
        category="翻译",
        config_key="ai_model_translation",
        thinking_config_key="ai_model_translation_thinking_enabled",
        default_model=ENGLISH_TRANSLATION_MODEL,
        available_models=(
            "qwen-mt-flash",
            "qwen-mt-plus",
            "qwen-mt-turbo",
        ),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
    AiModelScenario(
        key="tts",
        label="语音教练（TTS 语音合成）",
        description="复习与练习过程中的语音提示合成模型。",
        category="语音",
        config_key="flow_voice_model",
        thinking_config_key="flow_voice_thinking_enabled",
        default_model="cosyvoice-v3-flash",
        available_models=(
            "cosyvoice-v3-flash",
            "cosyvoice-v3",
            "cosyvoice-v2",
        ),
        source_location="apps/api/src/memory_anki/modules/voice_coach/application.py",
    ),
    AiModelScenario(
        key="asr",
        label="英语语音识别（ASR）",
        description="将英语课程视频或音频转录为句子时使用的语音识别模型。",
        category="语音",
        config_key="ai_model_asr",
        thinking_config_key="ai_model_asr_thinking_enabled",
        default_model=DASHSCOPE_ASR_MODEL,
        available_models=(
            "qwen3-asr-flash-filetrans",
            "paraformer-v2",
            "fun-asr",
        ),
        source_location="apps/api/src/memory_anki/modules/english/infrastructure/dashscope_gateway.py",
    ),
)

SCENARIO_BY_KEY = {item.key: item for item in MODEL_SCENARIOS}
SCENARIO_BY_CONFIG_KEY = {item.config_key: item for item in MODEL_SCENARIOS}


def _normalize_model_name(value: str | None) -> str:
    return str(value or "").strip()


def _normalize_bool(value: Any, default: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return bool(default)


def _mask_secret(value: str) -> str:
    secret = str(value or "").strip()
    if not secret:
        return ""
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}{'*' * max(4, len(secret) - 8)}{secret[-4:]}"


def _provider_from_model_name(model_name: str, *, fallback_modality: AiModality) -> AiModelDefinition:
    normalized = _normalize_model_name(model_name)
    defined = MODEL_DEFINITION_BY_KEY.get(normalized)
    if defined is not None:
        return defined
    provider: AiProviderKey = "zhipu" if normalized.lower().startswith("glm-") else "dashscope"
    return AiModelDefinition(
        key=normalized,
        label=normalized,
        provider=provider,
        modality=fallback_modality,
        supports_thinking=False,
        supports_temperature=True,
        default_base_url=(
            PROVIDER_ENV_DEFAULTS["zhipu"]["base_url"]
            if provider == "zhipu"
            else PROVIDER_ENV_DEFAULTS["dashscope"]["base_url"]
        ),
    )


def _scenario_modality(scenario: AiModelScenario) -> AiModality:
    model_definition = MODEL_DEFINITION_BY_KEY.get(scenario.default_model)
    if model_definition is not None:
        return model_definition.modality
    if scenario.key == "vision":
        return "vision"
    if scenario.key == "translation":
        return "translation"
    if scenario.key == "tts":
        return "tts"
    if scenario.key == "asr":
        return "asr"
    return "text"


def normalize_ai_runtime_options(value: Any) -> AiRuntimeOptions:
    if not isinstance(value, dict):
        return AiRuntimeOptions()
    model = _normalize_model_name(value.get("model"))
    raw_thinking = value.get("thinking_enabled")
    thinking_enabled = None if raw_thinking is None else _normalize_bool(raw_thinking)
    return AiRuntimeOptions(
        model=model or None,
        thinking_enabled=thinking_enabled,
    )


def resolve_current_model(
    session: Session | None,
    config_key: str,
    env_default: str,
) -> str:
    if session is not None and config_key:
        row = session.query(Config).filter_by(key=config_key).first()
        if row and row.value:
            return row.value.strip()
    return _normalize_model_name(env_default)


def resolve_current_thinking_enabled(
    session: Session | None,
    thinking_config_key: str,
    *,
    default: bool = False,
) -> bool:
    if session is not None and thinking_config_key:
        row = session.query(Config).filter_by(key=thinking_config_key).first()
        if row is not None:
            return _normalize_bool(row.value, default=default)
    return bool(default)


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


def build_model_metadata(model_name: str, *, fallback_modality: AiModality) -> dict[str, Any]:
    model = _provider_from_model_name(model_name, fallback_modality=fallback_modality)
    return {
        "key": model.key,
        "label": model.label,
        "provider": model.provider,
        "modality": model.modality,
        "supports_thinking": model.supports_thinking,
        "supports_temperature": model.supports_temperature,
        "default_base_url": model.default_base_url,
    }


def list_provider_settings(session: Session) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    for provider in ("dashscope", "zhipu"):
        api_key = resolve_provider_setting(session, provider, kind="api_key")
        base_url = resolve_provider_setting(session, provider, kind="base_url")
        providers.append(
            {
                "key": provider,
                "label": "DashScope" if provider == "dashscope" else "Zhipu",
                "api_key_masked": _mask_secret(api_key),
                "has_api_key": bool(api_key),
                "base_url": base_url,
                "api_key_config_key": PROVIDER_API_KEY_CONFIG_KEYS[provider],
                "base_url_config_key": PROVIDER_BASE_URL_CONFIG_KEYS[provider],
            }
        )
    return providers


def list_model_scenarios(session: Session) -> dict[str, Any]:
    scenarios: list[dict[str, Any]] = []
    for scenario in MODEL_SCENARIOS:
        default_model = resolve_current_model(
            session,
            scenario.config_key,
            scenario.default_model,
        )
        default_thinking_enabled = resolve_current_thinking_enabled(
            session,
            scenario.thinking_config_key,
            default=False,
        )
        fallback_modality = _scenario_modality(scenario)
        available_models = [build_model_metadata(model_name, fallback_modality=fallback_modality) for model_name in scenario.available_models]
        if default_model and default_model not in scenario.available_models:
            available_models.append(
                build_model_metadata(default_model, fallback_modality=fallback_modality)
            )
        scenarios.append(
            {
                "key": scenario.key,
                "label": scenario.label,
                "description": scenario.description,
                "category": scenario.category,
                "config_key": scenario.config_key,
                "thinking_config_key": scenario.thinking_config_key,
                "default_model": default_model,
                "default_thinking_enabled": default_thinking_enabled,
                "available_models": available_models,
                "source_location": scenario.source_location,
            }
        )
    return {
        "scenarios": scenarios,
        "providers": list_provider_settings(session),
    }


def save_ai_model_settings(
    session: Session,
    *,
    scenario_updates: dict[str, Any] | None = None,
    provider_updates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    for scenario_key, payload in dict(scenario_updates or {}).items():
        scenario = SCENARIO_BY_KEY.get(str(scenario_key))
        if scenario is None or not isinstance(payload, dict):
            continue
        model_name = _normalize_model_name(payload.get("default_model"))
        if model_name:
            _upsert_config_value(session, scenario.config_key, model_name)
        if "default_thinking_enabled" in payload:
            _upsert_config_value(
                session,
                scenario.thinking_config_key,
                "true" if _normalize_bool(payload.get("default_thinking_enabled")) else "false",
            )

    for provider_key, payload in dict(provider_updates or {}).items():
        normalized_provider = str(provider_key or "").strip().lower()
        if normalized_provider not in PROVIDER_API_KEY_CONFIG_KEYS or not isinstance(payload, dict):
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


def resolve_scenario_runtime(
    session: Session | None,
    scenario_key: str,
    *,
    ai_options: AiRuntimeOptions | None = None,
) -> ResolvedAiModelRuntime:
    scenario = SCENARIO_BY_KEY.get(str(scenario_key))
    if scenario is None:
        raise KeyError(f"unknown ai scenario: {scenario_key}")
    runtime_options = ai_options or AiRuntimeOptions()
    fallback_modality = _scenario_modality(scenario)
    default_model = resolve_current_model(session, scenario.config_key, scenario.default_model)
    resolved_model_name = runtime_options.model or default_model
    model_definition = _provider_from_model_name(
        resolved_model_name,
        fallback_modality=fallback_modality,
    )
    default_thinking_enabled = resolve_current_thinking_enabled(
        session,
        scenario.thinking_config_key,
        default=False,
    )
    requested_thinking_enabled = (
        runtime_options.thinking_enabled
        if runtime_options.thinking_enabled is not None
        else default_thinking_enabled
    )
    effective_thinking_enabled = bool(requested_thinking_enabled and model_definition.supports_thinking)
    api_key = resolve_provider_setting(session, model_definition.provider, kind="api_key")
    base_url = resolve_provider_setting(session, model_definition.provider, kind="base_url") or model_definition.default_base_url
    extra_payload = _build_thinking_payload(
        provider=model_definition.provider,
        supports_thinking=model_definition.supports_thinking,
        thinking_enabled=(
            bool(requested_thinking_enabled) if model_definition.supports_thinking else False
        ),
    )
    return ResolvedAiModelRuntime(
        scenario=scenario,
        model=model_definition.key,
        thinking_enabled=effective_thinking_enabled,
        provider=model_definition.provider,
        modality=model_definition.modality,
        supports_thinking=model_definition.supports_thinking,
        supports_temperature=model_definition.supports_temperature,
        api_key=api_key,
        base_url=base_url,
        extra_payload=extra_payload,
    )


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


def _upsert_config_value(session: Session, key: str, value: str) -> None:
    row = session.query(Config).filter_by(key=key).first()
    if row is not None:
        row.value = value
        return
    session.add(Config(key=key, value=value))
