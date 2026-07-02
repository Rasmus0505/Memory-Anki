from __future__ import annotations

import urllib.request

from memory_anki.core.config import DASHSCOPE_API_KEY
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
    build_pdf_text_anchors,
    clean_inline_text,
    ensure_rendered_page_size,
    normalize_extracted_text,
    normalize_page_selection,
    normalize_pdf_source_tree,
    normalize_source_tree,
    parse_source_tree_json,
    split_prompt_anchor_parts,
    summarize_model_output,
    trim_pdf_extracted_text,
    truncate_prompt_text,
)
from .mindmap_import.normalization import MAX_IMAGE_BYTES
from .mindmap_import import preview_generation as _preview_generation
from .mindmap_import import preview_streams as _preview_streams
from .mindmap_import.gateway_bridge import (
    call_dashscope_batch_json as _call_dashscope_batch_json,
    call_dashscope_json as _call_dashscope_json,
    call_dashscope_pdf_json as _call_dashscope_pdf_json,
    call_dashscope_text as _call_dashscope_text,
    call_dashscope_text_with_images as _call_dashscope_text_with_images,
    dashscope_runtime as _dashscope_runtime,
    extract_dashscope_stream_delta as _extract_dashscope_stream_delta,
    extract_dashscope_text_from_response_body as _extract_dashscope_text_from_response_body,
    extract_message_content_text as _extract_message_content_text,
    parse_dashscope_response_stream as _parse_dashscope_response_stream,
    stream_call_dashscope_batch_json as _stream_call_dashscope_batch_json,
    stream_call_dashscope_json as _stream_call_dashscope_json,
    stream_call_dashscope_pdf_json as _stream_call_dashscope_pdf_json,
    stream_call_dashscope_text as _stream_call_dashscope_text,
)
from .mindmap_import.preview_api import (
    build_delta_event,
    build_error_event,
    build_result_event,
    build_status_event,
)
from .mindmap_import.preview_api import (
    build_batch_import_result_payload as _build_batch_import_result_payload,
    build_image_import_result_payload as _build_image_import_result_payload,
    build_pdf_import_result_payload as _build_pdf_import_result_payload,
    build_text_result_payload as _build_text_result_payload,
    normalize_pdf_import_mode as _normalize_pdf_import_mode,
    order_pdf_image_items as _order_pdf_image_items,
    prepare_pdf_ocr_grounding as _prepare_pdf_ocr_grounding,
    resolve_pdf_structure_page as _resolve_pdf_structure_page,
    split_rendered_pdf_pages as _split_rendered_pdf_pages,
)


def _build_pdf_batch_prompt(
    *,
    structure_tree,
    range_prompt,
    page_numbers,
    import_options,
    extracted_text,
):
    return build_import_pdf_merge_prompt(
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def _build_pdf_direct_prompt(
    *,
    range_prompt,
    page_numbers,
    import_options,
    extracted_text,
):
    return build_import_pdf_direct_prompt(
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        import_options=import_options,
        extracted_text=extracted_text,
    )


def _has_dashscope_api_key() -> bool:
    return bool(DASHSCOPE_API_KEY)


def _ensure_dashscope_image_ready(*, image_bytes: bytes, missing_api_key_message: str) -> None:
    if not _has_dashscope_api_key():
        raise MindMapImportError(missing_api_key_message)
    if not image_bytes:
        raise MindMapImportError("未读取到图片内容。")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise MindMapImportError("图片过大，请压缩到 8MB 以内后重试。")


def _prepare_batch_image_items(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    if not _has_dashscope_api_key():
        raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。")
    if not image_items:
        raise MindMapImportError("请至少上传一张图片。")
    normalized_items: list[tuple[bytes, str | None]] = []
    total_bytes = 0
    for image_bytes, filename in image_items:
        if not image_bytes:
            raise MindMapImportError("存在未读取到内容的图片，请删除后重新上传。")
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise MindMapImportError("存在图片超过 8MB，请压缩后重试。")
        total_bytes += len(image_bytes)
        normalized_items.append((image_bytes, filename))
    if total_bytes > MAX_IMAGE_BYTES * 6:
        raise MindMapImportError("本次上传图片总大小过大，请减少图片数量或压缩后重试。")
    if structure_image_index is None:
        return normalized_items, None
    if structure_image_index < 0 or structure_image_index >= len(normalized_items):
        raise MindMapImportError("结构图索引无效，请重新选择结构图后再试。")
    return normalized_items, structure_image_index


def generate_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
) -> ImportPreviewResult:
    return _preview_generation.generate_import_preview(
        image_bytes=image_bytes,
        filename=filename,
        fallback_title=fallback_title,
        missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。",
        ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
        call_dashscope_json_fn=_call_dashscope_json,
        build_image_import_result_payload_fn=_build_image_import_result_payload,
    )


def generate_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
) -> TextPreviewResult:
    return _preview_generation.generate_text_preview(
        image_bytes=image_bytes,
        filename=filename,
        missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。",
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
    return _preview_generation.generate_batch_import_preview(
        image_items=image_items,
        fallback_title=fallback_title,
        structure_image_index=structure_image_index,
        prepare_batch_image_items_fn=_prepare_batch_image_items,
        call_dashscope_json_fn=_call_dashscope_json,
        call_dashscope_batch_json_fn=_call_dashscope_batch_json,
        call_dashscope_pdf_json_fn=_call_dashscope_pdf_json,
        build_batch_import_result_payload_fn=_build_batch_import_result_payload,
    )


def generate_pdf_import_preview(
    *,
    document,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str = PDF_IMPORT_MODE_DIRECT_GENERATION,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None = None,
) -> PdfImportPreviewResult:
    return _preview_generation.generate_pdf_import_preview(
        document=document,
        page_selection=page_selection,
        structure_page=structure_page,
        pdf_mode=pdf_mode,
        range_prompt=range_prompt,
        fallback_title=fallback_title,
        import_options=import_options,
        has_api_key=_has_dashscope_api_key(),
        missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。",
        normalize_pdf_import_mode_fn=_normalize_pdf_import_mode,
        normalize_page_selection_fn=normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=ensure_rendered_page_size,
        resolve_pdf_structure_page_fn=_resolve_pdf_structure_page,
        split_rendered_pdf_pages_fn=_split_rendered_pdf_pages,
        order_pdf_image_items_fn=_order_pdf_image_items,
        build_pdf_import_result_payload_fn=_build_pdf_import_result_payload,
        build_pdf_structure_prompt_fn=build_import_pdf_structure_prompt,
        prepare_pdf_ocr_grounding_fn=_prepare_pdf_ocr_grounding,
        call_dashscope_json_fn=_call_dashscope_json,
        call_dashscope_text_with_images_fn=_call_dashscope_text_with_images,
        call_dashscope_batch_json_fn=_call_dashscope_batch_json,
        call_dashscope_pdf_json_fn=_call_dashscope_pdf_json,
    )


def generate_pdf_text_preview(
    *,
    document,
    page_selection: list[int],
    range_prompt: str,
) -> PdfTextPreviewResult:
    return _preview_generation.generate_pdf_text_preview(
        document=document,
        page_selection=page_selection,
        range_prompt=range_prompt,
        has_api_key=_has_dashscope_api_key(),
        missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。",
        normalize_page_selection_fn=normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=ensure_rendered_page_size,
        call_dashscope_text_with_images_fn=_call_dashscope_text_with_images,
        build_text_result_payload_fn=_build_text_result_payload,
    )


def stream_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
):
    return (
        yield from _preview_streams.stream_import_preview(
            image_bytes=image_bytes,
            filename=filename,
            fallback_title=fallback_title,
            missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。",
            ensure_dashscope_image_ready_fn=_ensure_dashscope_image_ready,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            build_image_import_result_payload_fn=_build_image_import_result_payload,
        )
    )


def stream_text_preview(*, image_bytes: bytes, filename: str | None):
    return (
        yield from _preview_streams.stream_text_preview(
            image_bytes=image_bytes,
            filename=filename,
            missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。",
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
):
    return (
        yield from _preview_streams.stream_batch_import_preview(
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            prepare_batch_image_items_fn=_prepare_batch_image_items,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json,
            stream_call_dashscope_pdf_json_fn=_stream_call_dashscope_pdf_json,
            build_batch_import_result_payload_fn=_build_batch_import_result_payload,
        )
    )


def stream_pdf_import_preview(
    *,
    document,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str = PDF_IMPORT_MODE_DIRECT_GENERATION,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None = None,
    session=None,
    ai_options=None,
):
    return (
        yield from _preview_streams.stream_pdf_import_preview(
            document=document,
            page_selection=page_selection,
            structure_page=structure_page,
            pdf_mode=pdf_mode,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            has_api_key=_has_dashscope_api_key(),
            missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。",
            normalize_pdf_import_mode_fn=_normalize_pdf_import_mode,
            normalize_page_selection_fn=normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=ensure_rendered_page_size,
            resolve_pdf_structure_page_fn=_resolve_pdf_structure_page,
            split_rendered_pdf_pages_fn=_split_rendered_pdf_pages,
            order_pdf_image_items_fn=_order_pdf_image_items,
            build_pdf_import_result_payload_fn=_build_pdf_import_result_payload,
            build_pdf_structure_prompt_fn=build_import_pdf_structure_prompt,
            prepare_pdf_ocr_grounding_fn=_prepare_pdf_ocr_grounding,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json,
            stream_call_dashscope_pdf_json_fn=_stream_call_dashscope_pdf_json,
        )
    )


def stream_pdf_text_preview(*, document, page_selection: list[int], range_prompt: str):
    return (
        yield from _preview_streams.stream_pdf_text_preview(
            document=document,
            page_selection=page_selection,
            range_prompt=range_prompt,
            has_api_key=_has_dashscope_api_key(),
            missing_api_key_message="未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。",
            normalize_page_selection_fn=normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=ensure_rendered_page_size,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text,
            build_text_result_payload_fn=_build_text_result_payload,
        )
    )


_trim_pdf_extracted_text = trim_pdf_extracted_text

__all__ = [
    "BatchImportPreviewResult",
    "ImportPreviewResult",
    "ImportStreamEvent",
    "MindMapImportError",
    "PDF_DIRECT_OCR_FALLBACK_WARNING",
    "PDF_IMPORT_MODE_DIRECT_GENERATION",
    "PDF_IMPORT_MODE_STRUCTURED_MERGE",
    "PDF_OCR_FALLBACK_WARNING",
    "PROMPT",
    "PdfImportOptions",
    "PdfImportPreviewResult",
    "PdfTextPreviewResult",
    "SINGLE_PAGE_PDF_WARNING",
    "TextPreviewResult",
    "DASHSCOPE_API_KEY",
    "build_delta_event",
    "build_editor_doc",
    "build_error_event",
    "build_image_content_part",
    "build_pdf_text_anchors",
    "build_result_event",
    "build_status_event",
    "clean_inline_text",
    "ensure_rendered_page_size",
    "generate_batch_import_preview",
    "generate_import_preview",
    "generate_pdf_import_preview",
    "generate_pdf_text_preview",
    "generate_text_preview",
    "normalize_extracted_text",
    "normalize_page_selection",
    "normalize_pdf_source_tree",
    "normalize_source_tree",
    "parse_source_tree_json",
    "split_prompt_anchor_parts",
    "stream_batch_import_preview",
    "stream_import_preview",
    "stream_pdf_import_preview",
    "stream_pdf_text_preview",
    "stream_text_preview",
    "summarize_model_output",
    "trim_pdf_extracted_text",
    "truncate_prompt_text",
    "urllib",
    "render_selected_pdf_pages",
    "_build_pdf_batch_prompt",
    "_build_pdf_direct_prompt",
    "_trim_pdf_extracted_text",
]
