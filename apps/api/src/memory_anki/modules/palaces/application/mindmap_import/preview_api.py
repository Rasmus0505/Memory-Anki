from __future__ import annotations

from collections.abc import Generator
from functools import partial
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import SubjectDocument
from memory_anki.modules.knowledge.application.subject_document_service import (
    render_selected_pdf_pages,
)
from memory_anki.modules.settings.application.ai_prompts import (
    build_import_pdf_direct_prompt,
    build_import_pdf_merge_prompt,
    build_import_pdf_structure_prompt,
)

from . import (
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PROMPT,
    ImportPreviewResult,
    ImportStreamEvent,
    PdfImportOptions,
    PdfImportPreviewResult,
    PdfTextPreviewResult,
    TextPreviewResult,
    ensure_rendered_page_size,
    normalize_page_selection,
    preview_events,
    preview_generation,
    preview_streams,
)
from .contracts import BatchImportPreviewResult
from .gateway_bridge import (
    DashscopeImportRuntime,
    call_dashscope_batch_json,
    call_dashscope_json,
    call_dashscope_pdf_json,
    call_dashscope_text,
    call_dashscope_text_with_images,
    dashscope_runtime,
    ensure_dashscope_image_ready,
    prepare_batch_image_items,
    stream_call_dashscope_batch_json,
    stream_call_dashscope_json,
    stream_call_dashscope_pdf_json,
    stream_call_dashscope_text,
)
from .workflow import (
    build_batch_import_result_payload as workflow_build_batch_import_result_payload,
)
from .workflow import (
    build_image_import_result_payload as workflow_build_image_import_result_payload,
)
from .workflow import (
    build_pdf_import_result_payload as workflow_build_pdf_import_result_payload,
)
from .workflow import (
    build_text_result_payload as workflow_build_text_result_payload,
)
from .workflow import (
    normalize_pdf_import_mode as workflow_normalize_pdf_import_mode,
)
from .workflow import (
    order_pdf_image_items as workflow_order_pdf_image_items,
)
from .workflow import (
    prepare_pdf_ocr_grounding as workflow_prepare_pdf_ocr_grounding,
)
from .workflow import (
    resolve_pdf_structure_page as workflow_resolve_pdf_structure_page,
)
from .workflow import (
    split_rendered_pdf_pages as workflow_split_rendered_pdf_pages,
)

_IMAGE_IMPORT_API_KEY_MESSAGE = "未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。"
_TEXT_IMPORT_API_KEY_MESSAGE = "未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。"


def stream_event(event: str, data: dict[str, Any]) -> ImportStreamEvent:
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
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready,
            stream_call_dashscope_json_fn=stream_call_dashscope_json,
            build_image_import_result_payload_fn=build_image_import_result_payload,
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
            ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready,
            stream_call_dashscope_text_fn=stream_call_dashscope_text,
            build_text_result_payload_fn=build_text_result_payload,
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
            prepare_batch_image_items_fn=prepare_batch_image_items,
            stream_call_dashscope_json_fn=stream_call_dashscope_json,
            stream_call_dashscope_batch_json_fn=stream_call_dashscope_batch_json,
            stream_call_dashscope_pdf_json_fn=stream_call_dashscope_pdf_json,
            build_batch_import_result_payload_fn=build_batch_import_result_payload,
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
    session: Session | None = None,
    ai_options=None,
) -> Generator[ImportStreamEvent, None, None]:
    runtime = dashscope_runtime(
        session=session,
        ai_options=ai_options,
        scenario_key="vision_pdf_mindmap",
    )
    return (
        yield from preview_streams.stream_pdf_import_preview(
            document=document,
            page_selection=page_selection,
            structure_page=structure_page,
            pdf_mode=pdf_mode,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            has_api_key=bool(runtime.api_key),
            missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
            normalize_pdf_import_mode_fn=normalize_pdf_import_mode,
            normalize_page_selection_fn=normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=ensure_rendered_page_size,
            resolve_pdf_structure_page_fn=resolve_pdf_structure_page,
            split_rendered_pdf_pages_fn=split_rendered_pdf_pages,
            order_pdf_image_items_fn=order_pdf_image_items,
            build_pdf_import_result_payload_fn=build_pdf_import_result_payload,
            build_pdf_structure_prompt_fn=build_import_pdf_structure_prompt,
            prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding,
            stream_call_dashscope_text_fn=partial(
                stream_call_dashscope_text,
                runtime=runtime,
            ),
            stream_call_dashscope_json_fn=partial(
                stream_call_dashscope_json,
                runtime=runtime,
            ),
            stream_call_dashscope_batch_json_fn=partial(
                stream_call_dashscope_batch_json,
                runtime=runtime,
            ),
            stream_call_dashscope_pdf_json_fn=partial(
                stream_call_dashscope_pdf_json,
                runtime=runtime,
            ),
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
            has_api_key=bool(dashscope_runtime().api_key),
            missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
            normalize_page_selection_fn=normalize_page_selection,
            render_selected_pdf_pages_fn=render_selected_pdf_pages,
            ensure_rendered_page_size_fn=ensure_rendered_page_size,
            stream_call_dashscope_text_fn=stream_call_dashscope_text,
            build_text_result_payload_fn=build_text_result_payload,
        )
    )


def resolve_pdf_structure_page(page_numbers: list[int], structure_page: int | None) -> int:
    return workflow_resolve_pdf_structure_page(page_numbers, structure_page)


def split_rendered_pdf_pages(
    rendered_pages: list[tuple[int, bytes, str]],
    *,
    structure_page: int,
) -> tuple[tuple[int, bytes, str], list[tuple[int, bytes, str]]]:
    return workflow_split_rendered_pdf_pages(
        rendered_pages,
        structure_page=structure_page,
    )


def order_pdf_image_items(
    structure_payload: tuple[int, bytes, str],
    body_payloads: list[tuple[int, bytes, str]],
) -> list[tuple[bytes, str | None]]:
    return workflow_order_pdf_image_items(structure_payload, body_payloads)


def build_pdf_import_result_payload(
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


def build_image_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
) -> dict[str, Any]:
    return workflow_build_image_import_result_payload(
        source_tree=source_tree,
        fallback_title=fallback_title,
    )


def build_batch_import_result_payload(
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


def build_text_result_payload(
    *,
    extracted_text: str,
    selected_pages: list[int] | None = None,
) -> dict[str, Any]:
    return workflow_build_text_result_payload(
        extracted_text=extracted_text,
        selected_pages=selected_pages,
    )


def prepare_pdf_ocr_grounding(
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
        ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready,
        call_dashscope_json_fn=call_dashscope_json,
        build_image_import_result_payload_fn=build_image_import_result_payload,
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
        ensure_dashscope_image_ready_fn=ensure_dashscope_image_ready,
        call_dashscope_text_fn=call_dashscope_text,
        build_text_result_payload_fn=build_text_result_payload,
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
        prepare_batch_image_items_fn=prepare_batch_image_items,
        call_dashscope_json_fn=call_dashscope_json,
        call_dashscope_batch_json_fn=call_dashscope_batch_json,
        call_dashscope_pdf_json_fn=call_dashscope_pdf_json,
        build_batch_import_result_payload_fn=build_batch_import_result_payload,
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
        has_api_key=bool(dashscope_runtime().api_key),
        missing_api_key_message=_IMAGE_IMPORT_API_KEY_MESSAGE,
        normalize_pdf_import_mode_fn=normalize_pdf_import_mode,
        normalize_page_selection_fn=normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=ensure_rendered_page_size,
        resolve_pdf_structure_page_fn=resolve_pdf_structure_page,
        split_rendered_pdf_pages_fn=split_rendered_pdf_pages,
        order_pdf_image_items_fn=order_pdf_image_items,
        build_pdf_import_result_payload_fn=build_pdf_import_result_payload,
        build_pdf_structure_prompt_fn=build_import_pdf_structure_prompt,
        prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding,
        call_dashscope_json_fn=call_dashscope_json,
        call_dashscope_text_with_images_fn=call_dashscope_text_with_images,
        call_dashscope_batch_json_fn=call_dashscope_batch_json,
        call_dashscope_pdf_json_fn=call_dashscope_pdf_json,
    )


def normalize_pdf_import_mode(pdf_mode: str | None) -> str:
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
        has_api_key=bool(dashscope_runtime().api_key),
        missing_api_key_message=_TEXT_IMPORT_API_KEY_MESSAGE,
        normalize_page_selection_fn=normalize_page_selection,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=ensure_rendered_page_size,
        call_dashscope_text_with_images_fn=call_dashscope_text_with_images,
        build_text_result_payload_fn=build_text_result_payload,
    )
