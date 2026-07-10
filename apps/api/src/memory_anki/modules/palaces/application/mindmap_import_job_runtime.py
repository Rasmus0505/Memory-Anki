from __future__ import annotations

from typing import Any

from memory_anki.core.config import DASHSCOPE_BASE_URL, DASHSCOPE_VISION_MODEL
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    is_dashscope_compatible_provider,
    resolve_provider_setting,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

from .mindmap_import import PROMPT, job_state, llm_gateway
from .mindmap_import.runtime import DashscopeImportRuntime

MODE_MINDMAP = job_state.MODE_MINDMAP
MODE_TEXT = job_state.MODE_TEXT
SOURCE_KIND_IMAGE_BATCH = job_state.SOURCE_KIND_IMAGE_BATCH


def _serialize_runtime_payload(runtime: Any) -> dict[str, Any]:
    return {
        "model": runtime.model,
        "provider": runtime.provider,
        "base_url": runtime.base_url,
        "thinking_enabled": runtime.thinking_enabled,
        "supports_thinking": runtime.supports_thinking,
        "extra_payload": runtime.extra_payload,
        "prompt_override": getattr(runtime, "prompt_override", None),
        "resolved_ai": serialize_resolved_ai_runtime(runtime),
    }


def _dashscope_runtime(source_meta: dict[str, Any] | None = None) -> DashscopeImportRuntime:
    runtime_meta = source_meta.get("ai_runtime") if isinstance(source_meta, dict) else None
    if isinstance(runtime_meta, dict):
        return llm_gateway.build_runtime(
            api_key=str(_resolve_provider_api_key_for_runtime(runtime_meta) or ""),
            base_url=str(runtime_meta.get("base_url") or DASHSCOPE_BASE_URL),
            model=str(runtime_meta.get("model") or DASHSCOPE_VISION_MODEL),
            provider=str(runtime_meta.get("provider") or "dashscope"),
            extra_payload=(
                dict(raw_extra_payload)
                if isinstance((raw_extra_payload := runtime_meta.get("extra_payload")), dict)
                else None
            ),
            prompt_override=(
                str(runtime_meta.get("prompt_override")).strip()
                if str(runtime_meta.get("prompt_override") or "").strip()
                else None
            ),
        )

    fallback_scenario_key = "vision_image_mindmap"
    if isinstance(source_meta, dict):
        source_kind = str(source_meta.get("source_kind") or "").strip()
        mode = str(source_meta.get("mode") or "").strip()
        if source_kind == SOURCE_KIND_IMAGE_BATCH:
            fallback_scenario_key = "vision_batch_mindmap"
        elif mode == MODE_TEXT:
            fallback_scenario_key = "vision_image_text"

    runtime = resolve_scenario_runtime(None, fallback_scenario_key, ai_options=AiRuntimeOptions())
    return llm_gateway.build_runtime(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        provider=runtime.provider,
        extra_payload=runtime.extra_payload,
        prompt_override=runtime.prompt_override,
    )


def _resolve_provider_api_key_for_runtime(runtime_meta: dict[str, Any]) -> str:
    provider = str(runtime_meta.get("provider") or "dashscope").strip().lower()
    if provider == "zhipu":
        return resolve_provider_setting(None, "zhipu", kind="api_key")
    if provider == "siliconflow":
        return resolve_provider_setting(None, "siliconflow", kind="api_key")
    if is_dashscope_compatible_provider(provider):
        return resolve_provider_setting(None, "dashscope", kind="api_key")
    return resolve_provider_setting(None, "dashscope", kind="api_key")


def _prepare_batch_image_items(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    return llm_gateway.prepare_batch_items(
        runtime=_dashscope_runtime(),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def _stream_call_dashscope_json(
    *,
    source_meta: dict[str, Any] | None = None,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_json(
            runtime=_dashscope_runtime(source_meta),
            image_bytes=image_bytes,
            filename=filename,
            channel=channel,
            prompt=prompt,
            disable_rebalance=disable_rebalance,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_text(
    *,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_text(
            runtime=_dashscope_runtime(source_meta),
            image_items=image_items,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_batch_json(
    *,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    channel: str,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_batch_json(
            runtime=_dashscope_runtime(source_meta),
            image_items=image_items,
            structure_tree=structure_tree,
            channel=channel,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=disable_rebalance,
            extracted_text=extracted_text,
            external_log_context=external_log_context,
        )
    )


__all__ = [
    "MODE_MINDMAP",
    "MODE_TEXT",
    "SOURCE_KIND_IMAGE_BATCH",
    "_dashscope_runtime",
    "_prepare_batch_image_items",
    "_resolve_provider_api_key_for_runtime",
    "_serialize_runtime_payload",
    "_stream_call_dashscope_batch_json",
    "_stream_call_dashscope_json",
    "_stream_call_dashscope_text",
]
