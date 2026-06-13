from __future__ import annotations

from collections.abc import Generator
from typing import Any

from .contracts import ImportStreamEvent, PdfImportOptions
from .events import stream_text_deltas_as_events
from .prompts import PROMPT
from .runtime import (
    DashscopeImportRuntime,
    call_dashscope_batch_json,
    call_dashscope_json,
    call_dashscope_pdf_json,
    call_dashscope_text,
    call_dashscope_text_with_images,
    ensure_dashscope_image_ready,
    extract_dashscope_stream_delta,
    extract_dashscope_text_from_response_body,
    extract_message_content_text,
    parse_dashscope_response_stream,
    prepare_batch_image_items,
    stream_call_dashscope_batch_json,
    stream_call_dashscope_json,
    stream_call_dashscope_pdf_json,
    stream_call_dashscope_text,
)


def build_runtime(
    *,
    api_key: str,
    base_url: str,
    model: str,
    provider: str = "dashscope",
    extra_payload: dict[str, Any] | None = None,
) -> DashscopeImportRuntime:
    return DashscopeImportRuntime(
        api_key=api_key or "",
        base_url=base_url,
        model=model,
        provider=provider,
        extra_payload=extra_payload,
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
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    return prepare_batch_image_items(
        runtime=runtime,
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def call_json(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return call_dashscope_json(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        disable_rebalance=disable_rebalance,
        external_log_context=external_log_context,
    )


def call_text(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_text(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        external_log_context=external_log_context,
    )


def call_text_with_images(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_text_with_images(
        runtime=runtime,
        image_items=image_items,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
        external_log_context=external_log_context,
    )


def call_batch_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return call_dashscope_batch_json(
        runtime=runtime,
        image_items=image_items,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
        external_log_context=external_log_context,
    )


def call_pdf_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return call_dashscope_pdf_json(
        runtime=runtime,
        image_items=image_items,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
        external_log_context=external_log_context,
    )


def stream_json(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_json(
                runtime=runtime,
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
                image_items=image_items,
                page_numbers=page_numbers,
                range_prompt=range_prompt,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )


def stream_batch_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    channel: str,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_batch_json(
                runtime=runtime,
                image_items=image_items,
                structure_tree=structure_tree,
                range_prompt=range_prompt,
                page_numbers=page_numbers,
                disable_rebalance=disable_rebalance,
                import_options=import_options,
                extracted_text=extracted_text,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )


def stream_pdf_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    channel: str,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from stream_text_deltas_as_events(
            generator=stream_call_dashscope_pdf_json(
                runtime=runtime,
                image_items=image_items,
                range_prompt=range_prompt,
                page_numbers=page_numbers,
                disable_rebalance=disable_rebalance,
                import_options=import_options,
                extracted_text=extracted_text,
                external_log_context=external_log_context,
            ),
            channel=channel,
        )
    )


parse_response_stream = parse_dashscope_response_stream
extract_stream_delta = extract_dashscope_stream_delta
extract_text_from_response_body = extract_dashscope_text_from_response_body
extract_message_content = extract_message_content_text
