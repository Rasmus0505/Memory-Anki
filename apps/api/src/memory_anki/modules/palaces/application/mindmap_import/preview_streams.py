from __future__ import annotations

from collections.abc import Generator

from memory_anki.infrastructure.db.models import SubjectDocument

from . import MindMapImportError, PdfImportOptions, preview_workflows
from .contracts import ImportStreamEvent
from .preview_events import build_error_event, build_result_event


def stream_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    stream_call_dashscope_json_fn,
    build_image_import_result_payload_fn,
) -> Generator[ImportStreamEvent, None, None]:
    try:
        result_payload = yield from preview_workflows.run_import_preview(
            image_bytes=image_bytes,
            filename=filename,
            fallback_title=fallback_title,
            missing_api_key_message=missing_api_key_message,
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready_fn,
            stream_call_dashscope_json_fn=stream_call_dashscope_json_fn,
            build_image_import_result_payload_fn=build_image_import_result_payload_fn,
        )
        yield build_result_event(
            {
                "ok": True,
                "source_tree": result_payload["source_tree"],
                "editor_doc": result_payload["editor_doc"],
            }
        )
    except MindMapImportError as exc:
        yield build_error_event(str(exc))


def stream_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    stream_call_dashscope_text_fn,
    build_text_result_payload_fn,
) -> Generator[ImportStreamEvent, None, None]:
    try:
        result_payload = yield from preview_workflows.run_text_preview(
            image_bytes=image_bytes,
            filename=filename,
            missing_api_key_message=missing_api_key_message,
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready_fn,
            stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
            build_text_result_payload_fn=build_text_result_payload_fn,
        )
        yield build_result_event({"ok": True, **result_payload})
    except MindMapImportError as exc:
        yield build_error_event(str(exc))


def stream_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None,
    prepare_batch_image_items_fn,
    stream_call_dashscope_json_fn,
    stream_call_dashscope_batch_json_fn,
    stream_call_dashscope_pdf_json_fn,
    build_batch_import_result_payload_fn,
) -> Generator[ImportStreamEvent, None, None]:
    try:
        result_payload = yield from preview_workflows.run_batch_import_preview(
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            prepare_batch_image_items_fn=prepare_batch_image_items_fn,
            stream_call_dashscope_json_fn=stream_call_dashscope_json_fn,
            stream_call_dashscope_batch_json_fn=stream_call_dashscope_batch_json_fn,
            stream_call_dashscope_pdf_json_fn=stream_call_dashscope_pdf_json_fn,
            build_batch_import_result_payload_fn=build_batch_import_result_payload_fn,
        )
        yield build_result_event({"ok": True, **result_payload})
    except MindMapImportError as exc:
        yield build_error_event(str(exc))


def stream_pdf_import_preview(
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
    stream_call_dashscope_text_fn,
    stream_call_dashscope_json_fn,
    stream_call_dashscope_batch_json_fn,
    stream_call_dashscope_pdf_json_fn,
) -> Generator[ImportStreamEvent, None, None]:
    try:
        result_payload = yield from preview_workflows.run_pdf_import_preview(
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
            stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
            stream_call_dashscope_json_fn=stream_call_dashscope_json_fn,
            stream_call_dashscope_batch_json_fn=stream_call_dashscope_batch_json_fn,
            stream_call_dashscope_pdf_json_fn=stream_call_dashscope_pdf_json_fn,
        )
        yield build_result_event({"ok": True, **result_payload})
    except MindMapImportError as exc:
        yield build_error_event(str(exc))


def stream_pdf_text_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    range_prompt: str,
    has_api_key: bool,
    missing_api_key_message: str,
    normalize_page_selection_fn,
    render_selected_pdf_pages_fn,
    ensure_rendered_page_size_fn,
    stream_call_dashscope_text_fn,
    build_text_result_payload_fn,
) -> Generator[ImportStreamEvent, None, None]:
    try:
        result_payload = yield from preview_workflows.run_pdf_text_preview(
            document=document,
            page_selection=page_selection,
            range_prompt=range_prompt,
            has_api_key=has_api_key,
            missing_api_key_message=missing_api_key_message,
            normalize_page_selection_fn=normalize_page_selection_fn,
            render_selected_pdf_pages_fn=render_selected_pdf_pages_fn,
            ensure_rendered_page_size_fn=ensure_rendered_page_size_fn,
            stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
            build_text_result_payload_fn=build_text_result_payload_fn,
        )
        yield build_result_event({"ok": True, **result_payload})
    except MindMapImportError as exc:
        yield build_error_event(str(exc))
