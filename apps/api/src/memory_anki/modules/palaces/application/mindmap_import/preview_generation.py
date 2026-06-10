from __future__ import annotations

from collections.abc import Generator
from typing import Any

from memory_anki.infrastructure.db.models import SubjectDocument

from . import (
    BatchImportPreviewResult,
    ImportPreviewResult,
    PdfImportOptions,
    PdfImportPreviewResult,
    PdfTextPreviewResult,
    TextPreviewResult,
    preview_workflows,
)


def _consume_preview_workflow(generator: Generator[dict[str, Any], None, dict[str, Any]]) -> dict[str, Any]:
    while True:
        try:
            next(generator)
        except StopIteration as exc:
            return exc.value


def generate_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    call_dashscope_json_fn,
    build_image_import_result_payload_fn,
) -> ImportPreviewResult:
    def _stream_call_dashscope_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_json_fn(
            image_bytes=kwargs["image_bytes"],
            filename=kwargs["filename"],
        )

    result_payload = _consume_preview_workflow(
        preview_workflows.run_import_preview(
            image_bytes=image_bytes,
            filename=filename,
            fallback_title=fallback_title,
            missing_api_key_message=missing_api_key_message,
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready_fn,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json_fn,
            build_image_import_result_payload_fn=build_image_import_result_payload_fn,
        )
    )
    return ImportPreviewResult(
        source_tree=result_payload["source_tree"],
        editor_doc=result_payload["editor_doc"],
    )


def generate_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    call_dashscope_text_fn,
    build_text_result_payload_fn,
) -> TextPreviewResult:
    def _stream_call_dashscope_text_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_text_fn(
            image_bytes=kwargs["image_items"][0][0],
            filename=kwargs["image_items"][0][1],
        )

    result_payload = _consume_preview_workflow(
        preview_workflows.run_text_preview(
            image_bytes=image_bytes,
            filename=filename,
            missing_api_key_message=missing_api_key_message,
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready_fn,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text_fn,
            build_text_result_payload_fn=build_text_result_payload_fn,
        )
    )
    return TextPreviewResult(extracted_text=result_payload["extracted_text"])


def generate_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None,
    prepare_batch_image_items_fn,
    call_dashscope_json_fn,
    call_dashscope_batch_json_fn,
    call_dashscope_pdf_json_fn,
    build_batch_import_result_payload_fn,
) -> BatchImportPreviewResult:
    def _stream_call_dashscope_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_json_fn(
            image_bytes=kwargs["image_bytes"],
            filename=kwargs["filename"],
        )

    def _stream_call_dashscope_batch_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_batch_json_fn(
            image_items=kwargs["image_items"],
            structure_tree=kwargs["structure_tree"],
            range_prompt=kwargs.get("range_prompt", ""),
            page_numbers=kwargs.get("page_numbers"),
            disable_rebalance=bool(kwargs.get("disable_rebalance")),
            import_options=kwargs.get("import_options"),
            extracted_text=kwargs.get("extracted_text"),
        )

    def _stream_call_dashscope_pdf_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_pdf_json_fn(
            image_items=kwargs["image_items"],
            range_prompt=kwargs.get("range_prompt", ""),
            page_numbers=kwargs.get("page_numbers"),
            disable_rebalance=bool(kwargs.get("disable_rebalance")),
            import_options=kwargs.get("import_options"),
            extracted_text=kwargs.get("extracted_text"),
        )

    result_payload = _consume_preview_workflow(
        preview_workflows.run_batch_import_preview(
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            prepare_batch_image_items_fn=prepare_batch_image_items_fn,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json_fn,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json_fn,
            stream_call_dashscope_pdf_json_fn=_stream_call_dashscope_pdf_json_fn,
            build_batch_import_result_payload_fn=build_batch_import_result_payload_fn,
        )
    )
    return BatchImportPreviewResult(
        source_tree=result_payload["source_tree"],
        editor_doc=result_payload["editor_doc"],
        structure_image_index=result_payload["structure_image_index"],
        image_count=result_payload["image_count"],
    )


def generate_pdf_import_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None,
    has_api_key: bool,
    missing_api_key_message: str,
    normalize_pdf_import_mode_fn,
    normalize_page_selection_fn,
    render_selected_pdf_pages_fn,
    ensure_rendered_page_size_fn,
    resolve_pdf_structure_page_fn,
    split_rendered_pdf_pages_fn,
    order_pdf_image_items_fn,
    build_pdf_import_result_payload_fn,
    build_pdf_structure_prompt_fn,
    prepare_pdf_ocr_grounding_fn,
    call_dashscope_json_fn,
    call_dashscope_text_with_images_fn,
    call_dashscope_batch_json_fn,
    call_dashscope_pdf_json_fn,
) -> PdfImportPreviewResult:
    def _stream_call_dashscope_text_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_text_with_images_fn(
            image_items=kwargs["image_items"],
            page_numbers=kwargs["page_numbers"],
            range_prompt=kwargs["range_prompt"],
        )

    def _stream_call_dashscope_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_json_fn(
            image_bytes=kwargs["image_bytes"],
            filename=kwargs["filename"],
            prompt=kwargs.get("prompt"),
            disable_rebalance=bool(kwargs.get("disable_rebalance")),
        )

    def _stream_call_dashscope_batch_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_batch_json_fn(
            image_items=kwargs["image_items"],
            structure_tree=kwargs["structure_tree"],
            range_prompt=kwargs.get("range_prompt", ""),
            page_numbers=kwargs.get("page_numbers"),
            disable_rebalance=bool(kwargs.get("disable_rebalance")),
            import_options=kwargs.get("import_options"),
            extracted_text=kwargs.get("extracted_text"),
        )

    def _stream_call_dashscope_pdf_json_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_pdf_json_fn(
            image_items=kwargs["image_items"],
            range_prompt=kwargs.get("range_prompt", ""),
            page_numbers=kwargs.get("page_numbers"),
            disable_rebalance=bool(kwargs.get("disable_rebalance")),
            import_options=kwargs.get("import_options"),
            extracted_text=kwargs.get("extracted_text"),
        )

    result_payload = _consume_preview_workflow(
        preview_workflows.run_pdf_import_preview(
            document=document,
            page_selection=page_selection,
            structure_page=structure_page,
            pdf_mode=pdf_mode,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            has_api_key=has_api_key,
            missing_api_key_message=missing_api_key_message,
            normalize_pdf_import_mode_fn=normalize_pdf_import_mode_fn,
            normalize_page_selection_fn=normalize_page_selection_fn,
            render_selected_pdf_pages_fn=render_selected_pdf_pages_fn,
            ensure_rendered_page_size_fn=ensure_rendered_page_size_fn,
            resolve_pdf_structure_page_fn=resolve_pdf_structure_page_fn,
            split_rendered_pdf_pages_fn=split_rendered_pdf_pages_fn,
            order_pdf_image_items_fn=order_pdf_image_items_fn,
            build_pdf_import_result_payload_fn=build_pdf_import_result_payload_fn,
            build_pdf_structure_prompt_fn=build_pdf_structure_prompt_fn,
            prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding_fn,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text_fn,
            stream_call_dashscope_json_fn=_stream_call_dashscope_json_fn,
            stream_call_dashscope_batch_json_fn=_stream_call_dashscope_batch_json_fn,
            stream_call_dashscope_pdf_json_fn=_stream_call_dashscope_pdf_json_fn,
        )
    )
    return PdfImportPreviewResult(
        source_tree=result_payload["source_tree"],
        editor_doc=result_payload["editor_doc"],
        selected_pages=result_payload["selected_pages"],
        structure_page=result_payload["structure_page"],
        match_mode=result_payload["match_mode"],
        can_apply=result_payload["can_apply"],
        warnings=result_payload["warnings"],
        ocr_grounding_used=result_payload["ocr_grounding_used"],
        ocr_text_chars=result_payload["ocr_text_chars"],
    )


def generate_pdf_text_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    range_prompt: str,
    has_api_key: bool,
    missing_api_key_message: str,
    normalize_page_selection_fn,
    render_selected_pdf_pages_fn,
    ensure_rendered_page_size_fn,
    call_dashscope_text_with_images_fn,
    build_text_result_payload_fn,
) -> PdfTextPreviewResult:
    def _stream_call_dashscope_text_fn(**kwargs):
        if False:
            yield {}
        return call_dashscope_text_with_images_fn(
            image_items=kwargs["image_items"],
            page_numbers=kwargs["page_numbers"],
            range_prompt=kwargs["range_prompt"],
        )

    result_payload = _consume_preview_workflow(
        preview_workflows.run_pdf_text_preview(
            document=document,
            page_selection=page_selection,
            range_prompt=range_prompt,
            has_api_key=has_api_key,
            missing_api_key_message=missing_api_key_message,
            normalize_page_selection_fn=normalize_page_selection_fn,
            render_selected_pdf_pages_fn=render_selected_pdf_pages_fn,
            ensure_rendered_page_size_fn=ensure_rendered_page_size_fn,
            stream_call_dashscope_text_fn=_stream_call_dashscope_text_fn,
            build_text_result_payload_fn=build_text_result_payload_fn,
        )
    )
    return PdfTextPreviewResult(
        extracted_text=result_payload["extracted_text"],
        selected_pages=result_payload["selected_pages"],
    )
