from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Generator
from typing import Any

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_VISION_MODEL,
)
from memory_anki.infrastructure.db.models import SubjectDocument
from memory_anki.modules.knowledge.application.subject_document_service import (
    render_selected_pdf_pages,
)
from memory_anki.modules.settings.application.ai_prompts import (
    build_import_pdf_direct_prompt,
    build_import_pdf_merge_prompt,
    build_import_pdf_structure_prompt,
)

from .mindmap_import import (
    PDF_DIRECT_OCR_FALLBACK_WARNING,
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_IMPORT_MODE_STRUCTURED_MERGE,
    PDF_OCR_FALLBACK_WARNING,
    PROMPT,
    SINGLE_PAGE_PDF_WARNING,
    BatchImportPreviewResult,
    ImportPreviewResult,
    ImportStreamEvent,
    MindMapImportError,
    PdfImportOptions,
    PdfImportPreviewResult,
    PdfTextPreviewResult,
    TextPreviewResult,
    build_editor_doc,
    build_image_content_part,
    build_pdf_batch_prompt,
    build_pdf_direct_prompt,
    build_pdf_structure_prompt,
    build_pdf_text_anchors,
    clean_inline_text,
    ensure_rendered_page_size,
    llm_gateway,
    normalize_extracted_text,
    normalize_pdf_source_tree,
    normalize_page_selection,
    normalize_source_tree,
    parse_source_tree_json,
    preview_events,
    preview_generation,
    preview_streams,
    split_prompt_anchor_parts,
    summarize_model_output,
    trim_pdf_extracted_text,
    truncate_prompt_text,
)
from .mindmap_import.runtime import DashscopeImportRuntime
from .mindmap_import.workflow import (
    build_batch_import_result_payload as workflow_build_batch_import_result_payload,
)
from .mindmap_import.workflow import (
    build_image_import_result_payload as workflow_build_image_import_result_payload,
)
from .mindmap_import.workflow import (
    build_pdf_import_result_payload as workflow_build_pdf_import_result_payload,
)
from .mindmap_import.workflow import (
    build_text_result_payload as workflow_build_text_result_payload,
)
from .mindmap_import.workflow import (
    normalize_pdf_import_mode as workflow_normalize_pdf_import_mode,
)
from .mindmap_import.workflow import (
    order_pdf_image_items as workflow_order_pdf_image_items,
)
from .mindmap_import.workflow import (
    prepare_pdf_ocr_grounding as workflow_prepare_pdf_ocr_grounding,
)
from .mindmap_import.workflow import (
    resolve_pdf_structure_page as workflow_resolve_pdf_structure_page,
)
from .mindmap_import.workflow import (
    split_rendered_pdf_pages as workflow_split_rendered_pdf_pages,
)

_ = (
    urllib.error,
    urllib.request,
    BatchImportPreviewResult,
    ImportPreviewResult,
    MindMapImportError,
    PDF_DIRECT_OCR_FALLBACK_WARNING,
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_IMPORT_MODE_STRUCTURED_MERGE,
    PDF_OCR_FALLBACK_WARNING,
    PdfImportOptions,
    PdfImportPreviewResult,
    PdfTextPreviewResult,
    SINGLE_PAGE_PDF_WARNING,
    TextPreviewResult,
)

_IMAGE_IMPORT_API_KEY_MESSAGE = "未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。"
_TEXT_IMPORT_API_KEY_MESSAGE = "未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。"


def _stream_event(event: str, data: dict[str, Any]) -> ImportStreamEvent:
    return preview_events.stream_event(event, data)


def build_status_event(
    *,
    phase: str,
    message: str,
    step: int,
    total_steps: int,
) -> ImportStreamEvent:
    return preview_events.build_status_event(
        phase=phase,
        message=message,
        step=step,
        total_steps=total_steps,
    )


def build_delta_event(*, text: str, accumulated_text: str, channel: str) -> ImportStreamEvent:
    return preview_events.build_delta_event(
        text=text,
        accumulated_text=accumulated_text,
        channel=channel,
    )


def build_result_event(data: dict[str, Any]) -> ImportStreamEvent:
    return preview_events.build_result_event(data)


def build_error_event(error: str) -> ImportStreamEvent:
    return preview_events.build_error_event(error)


def stream_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
) -> Generator[ImportStreamEvent, None, None]:
    return (
        yield from preview_streams.stream_import_preview(
            image_bytes=image_bytes,
            filename=filename,
            fallback_title=fallback_title,
            missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
            ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            build_image_import_result_payload_fn=_build_image_import_result_payload,
        )
    )


def stream_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
) -> Generator[ImportStreamEvent, None, None]:
    return (
        yield from preview_streams.stream_text_preview(
            image_bytes=image_bytes,
            filename=filename,
            missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
            ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text,
            build_text_result_payload_fn=_build_text_result_payload,
        )
    )


def stream_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None = None,
) -> Generator[ImportStreamEvent, None, None]:
    return (
        yield from preview_streams.stream_batch_import_preview(
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            prepare_batch_image_items_fn=_prepare_batch_image_items,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json,
            build_batch_import_result_payload_fn=_build_batch_import_result_payload,
        )
    )


def stream_pdf_import_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str = PDF_IMPORT_MODE_DIRECT_GENERATION,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None = None,
) -> Generator[ImportStreamEvent, None, None]:
    return (
        yield from preview_streams.stream_pdf_import_preview(
            document=document,
            page_selection=page_selection,
            structure_page=structure_page,
            pdf_mode=pdf_mode,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            has_api_key=bool(DASHSCOPE_API_KEY),
            missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
            normalize_pdf_import_mode_fn=_normalize_pdf_import_mode,
            normalize_page_selection_fn=_normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=_ensure_rendered_page_size,
            resolve_pdf_structure_page_fn=_resolve_pdf_structure_page,
            split_rendered_pdf_pages_fn=_split_rendered_pdf_pages,
            order_pdf_image_items_fn=_order_pdf_image_items,
            build_pdf_import_result_payload_fn=_build_pdf_import_result_payload,
            build_pdf_structure_prompt_fn=_build_pdf_structure_prompt,
            prepare_pdf_ocr_grounding_fn=_prepare_pdf_ocr_grounding,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json,
            stream_call_dashscope_pdf_json_fn=_stream_call_dashscope_pdf_json,
        )
    )


def stream_pdf_text_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    range_prompt: str,
) -> Generator[ImportStreamEvent, None, None]:
    return (
        yield from preview_streams.stream_pdf_text_preview(
            document=document,
            page_selection=page_selection,
            range_prompt=range_prompt,
            has_api_key=bool(DASHSCOPE_API_KEY),
            missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
            normalize_page_selection_fn=_normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=_ensure_rendered_page_size,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text,
            build_text_result_payload_fn=_build_text_result_payload,
        )
    )


def _dashscope_runtime() -> DashscopeImportRuntime:
    return llm_gateway.build_runtime(
        api_key=DASHSCOPE_API_KEY or "",
        base_url=DASHSCOPE_BASE_URL,
        model=DASHSCOPE_VISION_MODEL,
    )


def _ensure_dashscope_image_ready(
    *,
    image_bytes: bytes,
    missing_api_key_message: str,
) -> None:
    llm_gateway.ensure_image_ready(
        runtime=_dashscope_runtime(),
        image_bytes=image_bytes,
        missing_api_key_message=missing_api_key_message,
    )


def _prepare_batch_image_items(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int]:
    return llm_gateway.prepare_batch_items(
        runtime=_dashscope_runtime(),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def _resolve_pdf_structure_page(page_numbers: list[int], structure_page: int | None) -> int:
    return workflow_resolve_pdf_structure_page(page_numbers, structure_page)


def _split_rendered_pdf_pages(
    rendered_pages: list[tuple[int, bytes, str]],
    *,
    structure_page: int,
) -> tuple[tuple[int, bytes, str], list[tuple[int, bytes, str]]]:
    return workflow_split_rendered_pdf_pages(
        rendered_pages,
        structure_page=structure_page,
    )


def _order_pdf_image_items(
    structure_payload: tuple[int, bytes, str],
    body_payloads: list[tuple[int, bytes, str]],
) -> list[tuple[bytes, str | None]]:
    return workflow_order_pdf_image_items(structure_payload, body_payloads)


def _build_pdf_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
    selected_pages: list[int],
    structure_page: int | None,
    import_options: PdfImportOptions,
    warnings: list[str] | None = None,
    match_mode: str = "strict_match",
    ocr_grounding_used: bool | None = None,
    ocr_text_chars: int | None = None,
) -> dict[str, Any]:
    return workflow_build_pdf_import_result_payload(
        source_tree=source_tree,
        fallback_title=fallback_title,
        selected_pages=selected_pages,
        structure_page=structure_page,
        import_options=import_options,
        warnings=warnings,
        match_mode=match_mode,
        ocr_grounding_used=ocr_grounding_used,
        ocr_text_chars=ocr_text_chars,
    )


def _build_image_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
) -> dict[str, Any]:
    return workflow_build_image_import_result_payload(
        source_tree=source_tree,
        fallback_title=fallback_title,
    )


def _build_batch_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
    structure_image_index: int,
    image_count: int,
) -> dict[str, Any]:
    return workflow_build_batch_import_result_payload(
        source_tree=source_tree,
        fallback_title=fallback_title,
        structure_image_index=structure_image_index,
        image_count=image_count,
    )


def _build_text_result_payload(
    *,
    extracted_text: str,
    selected_pages: list[int] | None = None,
) -> dict[str, Any]:
    return workflow_build_text_result_payload(
        extracted_text=extracted_text,
        selected_pages=selected_pages,
    )


def _prepare_pdf_ocr_grounding(
    extracted_text: str,
    *,
    structure_title: str,
    range_prompt: str,
) -> tuple[str | None, int]:
    return workflow_prepare_pdf_ocr_grounding(
        extracted_text,
        structure_title=structure_title,
        range_prompt=range_prompt,
    )


def generate_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
) -> ImportPreviewResult:
    return preview_generation.generate_import_preview(
        image_bytes=image_bytes,
        filename=filename,
        fallback_title=fallback_title,
        missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
        ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
        call_dashscope_json_fn=_call_dashscope_json,
        build_image_import_result_payload_fn=_build_image_import_result_payload,
    )


def generate_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
) -> TextPreviewResult:
    return preview_generation.generate_text_preview(
        image_bytes=image_bytes,
        filename=filename,
        missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
        ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
        call_dashscope_text_fn=_call_dashscope_text,
        build_text_result_payload_fn=_build_text_result_payload,
    )


def generate_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None = None,
) -> BatchImportPreviewResult:
    return preview_generation.generate_batch_import_preview(
        image_items=image_items,
        fallback_title=fallback_title,
        structure_image_index=structure_image_index,
        prepare_batch_image_items_fn=_prepare_batch_image_items,
        call_dashscope_json_fn=_call_dashscope_json,
        call_dashscope_batch_json_fn=_call_dashscope_batch_json,
        build_batch_import_result_payload_fn=_build_batch_import_result_payload,
    )


def generate_pdf_import_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str = PDF_IMPORT_MODE_DIRECT_GENERATION,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None = None,
) -> PdfImportPreviewResult:
    return preview_generation.generate_pdf_import_preview(
        document=document,
        page_selection=page_selection,
        structure_page=structure_page,
        pdf_mode=pdf_mode,
        range_prompt=range_prompt,
        fallback_title=fallback_title,
        import_options=import_options,
        has_api_key=bool(DASHSCOPE_API_KEY),
        missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
        normalize_pdf_import_mode_fn=_normalize_pdf_import_mode,
        normalize_page_selection_fn=_normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=_ensure_rendered_page_size,
        resolve_pdf_structure_page_fn=_resolve_pdf_structure_page,
        split_rendered_pdf_pages_fn=_split_rendered_pdf_pages,
        order_pdf_image_items_fn=_order_pdf_image_items,
        build_pdf_import_result_payload_fn=_build_pdf_import_result_payload,
        build_pdf_structure_prompt_fn=_build_pdf_structure_prompt,
        prepare_pdf_ocr_grounding_fn=_prepare_pdf_ocr_grounding,
        call_dashscope_json_fn=_call_dashscope_json,
        call_dashscope_text_with_images_fn=_call_dashscope_text_with_images,
        call_dashscope_batch_json_fn=_call_dashscope_batch_json,
        call_dashscope_pdf_json_fn=_call_dashscope_pdf_json,
    )


def _normalize_pdf_import_mode(pdf_mode: str | None) -> str:
    return workflow_normalize_pdf_import_mode(pdf_mode)


def generate_pdf_text_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    range_prompt: str,
) -> PdfTextPreviewResult:
    return preview_generation.generate_pdf_text_preview(
        document=document,
        page_selection=page_selection,
        range_prompt=range_prompt,
        has_api_key=bool(DASHSCOPE_API_KEY),
        missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
        normalize_page_selection_fn=_normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=_ensure_rendered_page_size,
        call_dashscope_text_with_images_fn=_call_dashscope_text_with_images,
        build_text_result_payload_fn=_build_text_result_payload,
    )


def _call_dashscope_json(
    *,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
) -> dict[str, Any]:
    return llm_gateway.call_json(
        runtime=_dashscope_runtime(),
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        disable_rebalance=disable_rebalance,
    )


def _call_dashscope_text(*, image_bytes: bytes, filename: str | None) -> str:
    return llm_gateway.call_text(
        runtime=_dashscope_runtime(),
        image_bytes=image_bytes,
        filename=filename,
    )


def _call_dashscope_text_with_images(
    *,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
) -> str:
    return llm_gateway.call_text_with_images(
        runtime=_dashscope_runtime(),
        image_items=image_items,
        page_numbers=page_numbers,
        range_prompt=range_prompt,
    )


def _call_dashscope_batch_json(
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
        runtime=_dashscope_runtime(),
        image_items=image_items,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def _call_dashscope_pdf_json(
    *,
    image_items: list[tuple[bytes, str | None]],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    return llm_gateway.call_pdf_json(
        runtime=_dashscope_runtime(),
        image_items=image_items,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        disable_rebalance=disable_rebalance,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def _stream_call_dashscope_json(
    *,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    return (
        yield from llm_gateway.stream_json(
            runtime=_dashscope_runtime(),
            image_bytes=image_bytes,
            filename=filename,
            prompt=prompt,
            disable_rebalance=disable_rebalance,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_text(
    *,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[ImportStreamEvent, None, str]:
    return (
        yield from llm_gateway.stream_text(
            runtime=_dashscope_runtime(),
            image_items=image_items,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_batch_json(
    *,
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
            runtime=_dashscope_runtime(),
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


def _stream_call_dashscope_pdf_json(
    *,
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
            runtime=_dashscope_runtime(),
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


def _parse_dashscope_response_stream(response: Any) -> Generator[str, None, str]:
    return llm_gateway.parse_response_stream(response)


def _extract_dashscope_stream_delta(payload_text: str) -> str:
    return llm_gateway.extract_stream_delta(payload_text)


def _extract_dashscope_text_from_response_body(response_body: str) -> str:
    return llm_gateway.extract_text_from_response_body(response_body)


def _extract_message_content_text(content: Any) -> str:
    return llm_gateway.extract_message_content(content)


_build_image_content_part = build_image_content_part
_normalize_source_tree = normalize_source_tree
_build_editor_doc = build_editor_doc
_parse_source_tree_json = parse_source_tree_json
_summarize_model_output = summarize_model_output
_normalize_extracted_text = normalize_extracted_text
_normalize_page_selection = normalize_page_selection
_ensure_rendered_page_size = ensure_rendered_page_size
_build_pdf_structure_prompt = build_import_pdf_structure_prompt
_build_pdf_batch_prompt = build_import_pdf_merge_prompt
_build_pdf_direct_prompt = build_import_pdf_direct_prompt
_truncate_prompt_text = truncate_prompt_text
_trim_pdf_extracted_text = trim_pdf_extracted_text
_build_pdf_text_anchors = build_pdf_text_anchors
_split_prompt_anchor_parts = split_prompt_anchor_parts
_clean_inline_text = clean_inline_text
