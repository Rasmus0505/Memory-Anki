from __future__ import annotations

from collections.abc import Generator
from typing import Any

from memory_anki.infrastructure.db.models import SubjectDocument

from . import (
    PDF_DIRECT_OCR_FALLBACK_WARNING,
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_OCR_FALLBACK_WARNING,
    SINGLE_PAGE_PDF_WARNING,
    MindMapImportError,
    PdfImportOptions,
    pdf_model_workflows,
    step_protocol,
)
from .contracts import ImportStreamEvent
from .preview_events import build_status_event


def _status_event(step: step_protocol.ImportStep) -> ImportStreamEvent:
    return build_status_event(**step.as_payload())


def run_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    stream_call_dashscope_json_fn,
    build_image_import_result_payload_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    total_steps = step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
    yield _status_event(step_protocol.validate_single_image_step(total_steps=total_steps))
    ensure_dashscope_image_ready_fn(
        image_bytes=image_bytes,
        missing_api_key_message=missing_api_key_message,
    )
    yield _status_event(
        step_protocol.recognize_single_image_structure_step(total_steps=total_steps)
    )
    source_tree = yield from stream_call_dashscope_json_fn(
        image_bytes=image_bytes,
        filename=filename,
        channel="raw_model",
    )
    yield _status_event(step_protocol.normalize_tree_step(total_steps=total_steps))
    yield _status_event(step_protocol.build_preview_step(total_steps=total_steps))
    return build_image_import_result_payload_fn(
        source_tree=source_tree,
        fallback_title=fallback_title,
    )


def run_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    missing_api_key_message: str,
    ensure_dashscope_image_ready_fn,
    stream_call_dashscope_text_fn,
    build_text_result_payload_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    total_steps = step_protocol.IMAGE_TEXT_TOTAL_STEPS
    yield _status_event(step_protocol.validate_single_image_step(total_steps=total_steps))
    ensure_dashscope_image_ready_fn(
        image_bytes=image_bytes,
        missing_api_key_message=missing_api_key_message,
    )
    yield _status_event(step_protocol.extract_single_image_text_step(total_steps=total_steps))
    extracted_text = yield from stream_call_dashscope_text_fn(
        image_items=[(image_bytes, filename)],
        page_numbers=None,
        range_prompt="",
        channel="text",
    )
    yield _status_event(step_protocol.normalize_text_step(total_steps=total_steps))
    return build_text_result_payload_fn(extracted_text=extracted_text)


def run_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None,
    prepare_batch_image_items_fn,
    stream_call_dashscope_json_fn,
    stream_call_dashscope_batch_json_fn,
    stream_call_dashscope_pdf_json_fn,
    build_batch_import_result_payload_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    yield _status_event(step_protocol.validate_image_batch_step())
    normalized_items, resolved_structure_index = prepare_batch_image_items_fn(
        image_items=image_items,
        structure_image_index=structure_image_index,
    )
    if resolved_structure_index is None:
        yield _status_event(step_protocol.generate_pdf_mindmap_direct_step())
        enhanced_tree = yield from stream_call_dashscope_pdf_json_fn(
            image_items=normalized_items,
            channel="raw_model",
            range_prompt="",
            page_numbers=None,
            disable_rebalance=True,
            import_options=PdfImportOptions(),
            extracted_text=None,
        )
    else:
        yield _status_event(step_protocol.extract_batch_structure_step())
        structure_bytes, structure_filename = normalized_items[resolved_structure_index]
        structure_tree = yield from stream_call_dashscope_json_fn(
            image_bytes=structure_bytes,
            filename=structure_filename,
            channel="raw_model",
            disable_rebalance=True,
        )
        yield _status_event(step_protocol.enhance_batch_with_body_step())
        enhanced_tree = yield from stream_call_dashscope_batch_json_fn(
            image_items=normalized_items,
            structure_tree=structure_tree,
            channel="raw_model",
            range_prompt="",
            page_numbers=None,
            disable_rebalance=True,
            import_options=PdfImportOptions(),
            extracted_text=None,
        )
    yield _status_event(
        step_protocol.build_preview_step(total_steps=step_protocol.BATCH_MINDMAP_TOTAL_STEPS)
    )
    return build_batch_import_result_payload_fn(
        source_tree=enhanced_tree,
        fallback_title=fallback_title,
        structure_image_index=resolved_structure_index,
        image_count=len(normalized_items),
    )


def run_pdf_import_preview(
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
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    if not has_api_key:
        raise MindMapImportError(missing_api_key_message)

    resolved_options = import_options or PdfImportOptions()
    resolved_pdf_mode = normalize_pdf_import_mode_fn(pdf_mode)
    normalized_pages = normalize_page_selection_fn(page_selection, document.page_count)
    total_steps = step_protocol.PDF_IMPORT_TOTAL_STEPS
    yield _status_event(step_protocol.render_pdf_pages_step(total_steps=total_steps))
    rendered_pages = render_selected_pdf_pages_fn(
        document,
        page_numbers=normalized_pages,
        kind="preview",
    )
    ensure_rendered_page_size_fn(rendered_pages)

    if resolved_pdf_mode == PDF_IMPORT_MODE_DIRECT_GENERATION:
        warnings: list[str] = []
        trimmed_text: str | None = None
        ocr_text_chars = 0
        try:
            trimmed_text, ocr_text_chars = yield from pdf_model_workflows.stream_selected_pdf_ocr(
                rendered_pages=rendered_pages,
                page_numbers=normalized_pages,
                range_prompt=range_prompt,
                prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding_fn,
                stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
            )
        except MindMapImportError:
            warnings.append(PDF_DIRECT_OCR_FALLBACK_WARNING)
        source_tree = yield from pdf_model_workflows.stream_pdf_direct_generation(
            rendered_pages=rendered_pages,
            page_numbers=normalized_pages,
            range_prompt=range_prompt,
            import_options=resolved_options,
            extracted_text=trimmed_text or None,
            stream_call_dashscope_pdf_json_fn=stream_call_dashscope_pdf_json_fn,
        )
        yield _status_event(step_protocol.build_preview_step(total_steps=total_steps))
        return build_pdf_import_result_payload_fn(
            source_tree=source_tree,
            fallback_title=fallback_title,
            selected_pages=normalized_pages,
            structure_page=None,
            import_options=resolved_options,
            warnings=warnings,
            match_mode=PDF_IMPORT_MODE_DIRECT_GENERATION,
            ocr_grounding_used=bool(trimmed_text),
            ocr_text_chars=ocr_text_chars or None,
        )

    resolved_structure_page = resolve_pdf_structure_page_fn(normalized_pages, structure_page)
    structure_payload, body_payloads = split_rendered_pdf_pages_fn(
        rendered_pages,
        structure_page=resolved_structure_page,
    )
    warnings: list[str] = []
    structure_tree = yield from pdf_model_workflows.stream_pdf_structure_recognition(
        structure_payload=structure_payload,
        structure_page=resolved_structure_page,
        range_prompt=range_prompt,
        preserve_emphasis_marks=resolved_options.preserve_emphasis_marks,
        build_pdf_structure_prompt_fn=build_pdf_structure_prompt_fn,
        stream_call_dashscope_json_fn=stream_call_dashscope_json_fn,
    )
    if body_payloads:
        trimmed_text: str | None = None
        try:
            trimmed_text = yield from pdf_model_workflows.stream_pdf_body_ocr(
                body_payloads=body_payloads,
                range_prompt=range_prompt,
                structure_title=str(structure_tree.get("title") or fallback_title or ""),
                prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding_fn,
                stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
            )
        except MindMapImportError:
            warnings.append(PDF_OCR_FALLBACK_WARNING)
        enhanced_tree = yield from pdf_model_workflows.stream_pdf_body_merge(
            structure_payload=structure_payload,
            body_payloads=body_payloads,
            structure_tree=structure_tree,
            page_numbers=normalized_pages,
            range_prompt=range_prompt,
            import_options=resolved_options,
            extracted_text=trimmed_text,
            order_pdf_image_items_fn=order_pdf_image_items_fn,
            stream_call_dashscope_batch_json_fn=stream_call_dashscope_batch_json_fn,
        )
    else:
        warnings.append(SINGLE_PAGE_PDF_WARNING)
        yield from pdf_model_workflows.stream_skip_pdf_body_steps()
        enhanced_tree = structure_tree

    return build_pdf_import_result_payload_fn(
        source_tree=enhanced_tree,
        fallback_title=fallback_title,
        selected_pages=normalized_pages,
        structure_page=resolved_structure_page,
        import_options=resolved_options,
        warnings=warnings,
        match_mode="strict_match",
    )


def run_pdf_text_preview(
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
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    if not has_api_key:
        raise MindMapImportError(missing_api_key_message)

    normalized_pages = normalize_page_selection_fn(page_selection, document.page_count)
    total_steps = step_protocol.PDF_TEXT_TOTAL_STEPS
    yield _status_event(step_protocol.render_pdf_pages_step(total_steps=total_steps))
    rendered_pages = render_selected_pdf_pages_fn(
        document,
        page_numbers=normalized_pages,
        kind="preview",
    )
    ensure_rendered_page_size_fn(rendered_pages)
    extracted_text = yield from pdf_model_workflows.stream_pdf_text_extraction(
        rendered_pages=rendered_pages,
        page_numbers=normalized_pages,
        range_prompt=range_prompt,
        total_steps=total_steps,
        stream_call_dashscope_text_fn=stream_call_dashscope_text_fn,
    )
    yield _status_event(step_protocol.normalize_text_step(total_steps=total_steps))
    return build_text_result_payload_fn(
        extracted_text=extracted_text,
        selected_pages=normalized_pages,
    )
