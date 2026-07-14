from __future__ import annotations

from typing import Any

from memory_anki.platform.application import (
    AiRuntimeProvider,
    PersistedAiRuntime,
    PromptCatalog,
    ResolvedAiRuntime,
    serialize_resolved_ai_runtime,
)

from .mindmap_import import job_state, llm_gateway
from .mindmap_import.runtime import DashscopeImportRuntime

MODE_MINDMAP = job_state.MODE_MINDMAP
MODE_TEXT = job_state.MODE_TEXT
SOURCE_KIND_IMAGE_BATCH = job_state.SOURCE_KIND_IMAGE_BATCH
SOURCE_KIND_PDF_DOCUMENT = job_state.SOURCE_KIND_PDF_DOCUMENT


def _serialize_runtime_payload(runtime: ResolvedAiRuntime) -> dict[str, Any]:
    return {
        "scenario_key": runtime.scene_key,
        "model": runtime.model,
        "provider": runtime.provider,
        "base_url": runtime.base_url,
        "thinking_enabled": runtime.thinking_enabled,
        "supports_thinking": getattr(runtime, "supports_thinking", False),
        "extra_payload": runtime.extra_payload,
        "prompt_override": getattr(runtime, "prompt_override", None),
        "prompt_options": getattr(runtime, "prompt_options", None),
        "resolved_ai": serialize_resolved_ai_runtime(runtime),
    }


def _dashscope_runtime(
    source_meta: dict[str, Any] | None = None,
    *,
    ai_runtime: AiRuntimeProvider,
    runtime_role: str = "vision",
) -> DashscopeImportRuntime:
    runtime_meta = None
    if isinstance(source_meta, dict):
        runtime_key = "formatter_ai_runtime" if runtime_role == "formatter" else "vision_ai_runtime"
        runtime_meta = source_meta.get(runtime_key)
        if not isinstance(runtime_meta, dict) or not runtime_meta.get("model"):
            runtime_meta = source_meta.get("ai_runtime") if runtime_role == "vision" else None
    if isinstance(runtime_meta, dict) and runtime_meta.get("model"):
        runtime = ai_runtime.restore(_runtime_snapshot(runtime_meta))
    else:
        scenario_key = "mindmap_ocr_formatter" if runtime_role == "formatter" else _fallback_scenario_key(source_meta)
        runtime = ai_runtime.resolve(scenario_key)
    return llm_gateway.build_runtime(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        provider=runtime.provider,
        extra_payload=runtime.extra_payload,
        prompt_override=runtime.prompt_override,
    )


def _runtime_snapshot(runtime_meta: dict[str, Any]) -> PersistedAiRuntime:
    return PersistedAiRuntime(
        scenario_key=str(runtime_meta.get("scenario_key") or "vision_image_mindmap"),
        model=str(runtime_meta.get("model") or ""),
        provider=str(runtime_meta.get("provider") or "dashscope"),
        base_url=str(runtime_meta.get("base_url") or ""),
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
        prompt_options=(
            dict(raw_prompt_options)
            if isinstance((raw_prompt_options := runtime_meta.get("prompt_options")), dict)
            else None
        ),
    )


def _fallback_scenario_key(source_meta: dict[str, Any] | None) -> str:
    if isinstance(source_meta, dict):
        if str(source_meta.get("source_kind") or "").strip() in {
            SOURCE_KIND_IMAGE_BATCH,
            SOURCE_KIND_PDF_DOCUMENT,
        }:
            return "vision_batch_mindmap"
        if str(source_meta.get("mode") or "").strip() == MODE_TEXT:
            return "vision_image_text"
    return "vision_image_mindmap"


def _vision_processing_role(source_meta: dict[str, Any] | None) -> str:
    runtime_meta = None
    if isinstance(source_meta, dict):
        runtime_meta = source_meta.get("vision_ai_runtime") or source_meta.get("ai_runtime")
    if not isinstance(runtime_meta, dict):
        return "direct_generation"
    resolved_ai = runtime_meta.get("resolved_ai")
    if isinstance(resolved_ai, dict):
        role = str(resolved_ai.get("vision_processing_role") or "").strip()
        if role in {"direct_generation", "ocr_extraction"}:
            return role
        model_key = str(resolved_ai.get("model_key") or "").strip()
        if model_key in {"qwen3.5-ocr", "qwen-vl-ocr"}:
            return "ocr_extraction"
    model = str(runtime_meta.get("model") or "").strip()
    return "ocr_extraction" if model in {"qwen3.5-ocr", "qwen-vl-ocr"} else "direct_generation"

def _prepare_batch_image_items(
    *,
    ai_runtime: AiRuntimeProvider,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    return llm_gateway.prepare_batch_items(
        runtime=_dashscope_runtime(ai_runtime=ai_runtime),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def _stream_call_dashscope_json(
    *,
    ai_runtime: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
    source_meta: dict[str, Any] | None = None,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str | None = None,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_json(
            prompt_catalog=prompt_catalog,
            runtime=_dashscope_runtime(source_meta, ai_runtime=ai_runtime),
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
    ai_runtime: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    force_default_prompt: bool = False,
    external_log_context: dict[str, Any] | None = None,
):
    runtime = _dashscope_runtime(source_meta, ai_runtime=ai_runtime)
    if force_default_prompt and runtime.prompt_override:
        runtime = DashscopeImportRuntime(
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            model=runtime.model,
            provider=runtime.provider,
            temperature=runtime.temperature,
            timeout_seconds=runtime.timeout_seconds,
            extra_payload=runtime.extra_payload,
            prompt_override=None,
        )
    return (
        yield from llm_gateway.stream_text(
            prompt_catalog=prompt_catalog,
            runtime=runtime,
            image_items=image_items,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_batch_json(
    *,
    ai_runtime: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
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
            prompt_catalog=prompt_catalog,
            runtime=_dashscope_runtime(source_meta, ai_runtime=ai_runtime),
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


def _stream_call_formatter_json(
    *,
    ai_runtime: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
    source_meta: dict[str, Any] | None = None,
    extracted_text: str,
    target_title: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_formatter_json(
            prompt_catalog=prompt_catalog,
            runtime=_dashscope_runtime(
                source_meta,
                ai_runtime=ai_runtime,
                runtime_role="formatter",
            ),
            extracted_text=extracted_text,
            target_title=target_title,
            channel=channel,
            external_log_context=external_log_context,
        )
    )

__all__ = [
    "MODE_MINDMAP",
    "MODE_TEXT",
    "SOURCE_KIND_IMAGE_BATCH",
    "_dashscope_runtime",
    "_prepare_batch_image_items",
    "_serialize_runtime_payload",
    "_stream_call_dashscope_batch_json",
    "_stream_call_dashscope_json",
    "_stream_call_dashscope_text",
    "_stream_call_formatter_json",
    "_vision_processing_role",
]
