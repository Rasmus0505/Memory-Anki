from __future__ import annotations

from collections.abc import Generator
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_VISION_MODEL,
)

from . import PROMPT, llm_gateway
from .contracts import ImportStreamEvent, PdfImportOptions
from .runtime import DashscopeImportRuntime


def dashscope_runtime(
    session: Session | None = None,
    ai_options=None,
    *,
    scenario_key: str = "vision_image_mindmap",
) -> DashscopeImportRuntime:
    if session is None and ai_options is None:
        from memory_anki.modules.settings.application.ai_model_registry import resolve_current_model

        return llm_gateway.build_runtime(
            api_key=DASHSCOPE_API_KEY or "",
            base_url=DASHSCOPE_BASE_URL,
            model=resolve_current_model(session, "ai_model_vision", DASHSCOPE_VISION_MODEL),
        )

    from memory_anki.modules.settings.application.ai_model_registry import (
        resolve_scenario_runtime,
    )

    resolved_runtime = resolve_scenario_runtime(session, scenario_key, ai_options=ai_options)
    return llm_gateway.build_runtime(
        api_key=resolved_runtime.api_key,
        base_url=resolved_runtime.base_url,
        model=resolved_runtime.model,
        provider=resolved_runtime.provider,
        extra_payload=resolved_runtime.extra_payload,
    )


def ensure_dashscope_image_ready(
    *,
    image_bytes: bytes,
    missing_api_key_message: str,
) -> None:
    llm_gateway.ensure_image_ready(
        runtime=dashscope_runtime(),
        image_bytes=image_bytes,
        missing_api_key_message=missing_api_key_message,
    )


def prepare_batch_image_items(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    return llm_gateway.prepare_batch_items(
        runtime=dashscope_runtime(),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def call_dashscope_json(
    *,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
) -> dict[str, Any]:
    return llm_gateway.call_json(
        runtime=dashscope_runtime(),
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        disable_rebalance=disable_rebalance,
    )


def call_dashscope_text(*, image_bytes: bytes, filename: str | None) -> str:
    return llm_gateway.call_text(
        runtime=dashscope_runtime(),
        image_bytes=image_bytes,
        filename=filename,
    )


def call_dashscope_text_with_images(
    *,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
) -> str:
    return llm_gateway.call_text_with_images(
        runtime=dashscope_runtime(),
        image_items=image_items,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
    )


def call_dashscope_batch_json(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    return llm_gateway.call_batch_json(
        runtime=dashscope_runtime(),
        image_items=image_items,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def call_dashscope_pdf_json(
    *,
    image_items: list[tuple[bytes, str | None]],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    return llm_gateway.call_pdf_json(
        runtime=dashscope_runtime(),
        image_items=image_items,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def stream_call_dashscope_json(
    *,
    runtime: DashscopeImportRuntime | None = None,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from llm_gateway.stream_json(
            runtime=runtime or dashscope_runtime(),
            image_bytes=image_bytes,
            filename=filename,
            prompt=prompt,
            disable_rebalance=disable_rebalance,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def stream_call_dashscope_text(
    *,
    runtime: DashscopeImportRuntime | None = None,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, str]:
    return (
        yield from llm_gateway.stream_text(
            runtime=runtime or dashscope_runtime(),
            image_items=image_items,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def stream_call_dashscope_batch_json(
    *,
    runtime: DashscopeImportRuntime | None = None,
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
        yield from llm_gateway.stream_batch_json(
            runtime=runtime or dashscope_runtime(),
            image_items=image_items,
            structure_tree=structure_tree,
            channel=channel,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=disable_rebalance,
            import_options=import_options,
            extracted_text=extracted_text,
            external_log_context=external_log_context,
        )
    )


def stream_call_dashscope_pdf_json(
    *,
    runtime: DashscopeImportRuntime | None = None,
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
        yield from llm_gateway.stream_pdf_json(
            runtime=runtime or dashscope_runtime(),
            image_items=image_items,
            channel=channel,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=disable_rebalance,
            import_options=import_options,
            extracted_text=extracted_text,
            external_log_context=external_log_context,
        )
    )


def parse_dashscope_response_stream(response: Any) -> Generator[str, None, str]:
    return llm_gateway.parse_response_stream(response)


def extract_dashscope_stream_delta(payload_text: str) -> str:
    return llm_gateway.extract_stream_delta(payload_text)


def extract_dashscope_text_from_response_body(response_body: str) -> str:
    return llm_gateway.extract_text_from_response_body(response_body)


def extract_message_content_text(content: Any) -> str:
    return llm_gateway.extract_message_content(content)
