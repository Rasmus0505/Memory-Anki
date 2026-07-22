from __future__ import annotations

from collections.abc import Generator
from typing import Any

from memory_anki.platform.application import PromptCatalog

from .contracts import ImportStreamEvent
from .events import stream_text_deltas_as_events
from .runtime import (
    DashscopeImportRuntime,
    call_dashscope_json,
    call_dashscope_text,
    call_dashscope_text_with_images,
    ensure_dashscope_image_ready,
    extract_dashscope_stream_delta,
    extract_dashscope_text_from_response_body,
    extract_message_content_text,
    parse_dashscope_response_stream,
    prepare_batch_image_items,
    stream_call_dashscope_formatter_json,
    stream_call_dashscope_json,
    stream_call_dashscope_text,
)


def build_runtime(
    *,
    api_key: str,
    base_url: str,
    model: str,
    provider: str = "dashscope",
    extra_payload: dict[str, Any] | None = None,
    prompt_override: str | None = None,
) -> DashscopeImportRuntime:
    return DashscopeImportRuntime(
        api_key=api_key or "",
        base_url=base_url,
        model=model,
        provider=provider,
        extra_payload=extra_payload,
        prompt_override=prompt_override,
    )


def ensure_image_ready(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    missing_api_key_message: str,
) -> None:
    ensure_dashscope_image_ready(
        runtime=runtime,
        image_bytes=image_bytes,
        missing_api_key_message=missing_api_key_message,
    )


def prepare_batch_items(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
) -> list[tuple[bytes, str | None]]:
    return prepare_batch_image_items(
        runtime=runtime,
        image_items=image_items,
    )


def call_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str | None = None,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return call_dashscope_json(
        runtime=runtime,
        prompt_catalog=prompt_catalog,
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        disable_rebalance=disable_rebalance,
        external_log_context=external_log_context,
    )


def call_text(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_text(
        runtime=runtime,
        prompt_catalog=prompt_catalog,
        image_bytes=image_bytes,
        filename=filename,
        external_log_context=external_log_context,
    )


def call_text_with_images(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_text_with_images(
        runtime=runtime,
        prompt_catalog=prompt_catalog,
        image_items=image_items,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
        external_log_context=external_log_context,
    )


def stream_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str | None = None,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_json(
                runtime=runtime,
                prompt_catalog=prompt_catalog,
                image_bytes=image_bytes,
                filename=filename,
                prompt=prompt,
                disable_rebalance=disable_rebalance,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )


def stream_text(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, str]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_text(
                runtime=runtime,
                prompt_catalog=prompt_catalog,
                image_items=image_items,
                page_numbers=page_numbers,
                range_prompt=range_prompt,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )


def stream_formatter_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    extracted_text: str,
    target_title: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_formatter_json(
                prompt_catalog=prompt_catalog,
                runtime=runtime,
                extracted_text=extracted_text,
                target_title=target_title,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )

parse_response_stream = parse_dashscope_response_stream
extract_stream_delta = extract_dashscope_stream_delta
extract_text_from_response_body = extract_dashscope_text_from_response_body
extract_message_content = extract_message_content_text
