from __future__ import annotations

from collections.abc import Generator
from typing import Any

from . import step_protocol
from .contracts import ImportStreamEvent
from .preview_events import build_status_event


def _status_event(step: step_protocol.ImportStep) -> ImportStreamEvent:
    return build_status_event(**step.as_payload())


def rendered_image_items(
    rendered_pages: list[tuple[int, bytes, str]],
) -> list[tuple[bytes, str | None]]:
    return [(image_bytes, filename) for _, image_bytes, filename in rendered_pages]


def stream_pdf_text_extraction(
    *,
    rendered_pages: list[tuple[int, bytes, str]],
    page_numbers: list[int],
    range_prompt: str,
    total_steps: int,
    stream_call_dashscope_text_fn,
) -> Generator[ImportStreamEvent, None, str]:
    yield _status_event(step_protocol.extract_pdf_text_step(total_steps=total_steps))
    return (
        yield from stream_call_dashscope_text_fn(
            image_items=rendered_image_items(rendered_pages),
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel="text",
        )
    )


def stream_selected_pdf_ocr(
    *,
    rendered_pages: list[tuple[int, bytes, str]],
    page_numbers: list[int],
    range_prompt: str,
    prepare_pdf_ocr_grounding_fn,
    stream_call_dashscope_text_fn,
) -> Generator[ImportStreamEvent, None, tuple[str | None, int]]:
    yield _status_event(step_protocol.extract_selected_pdf_ocr_step())
    extracted_text = yield from stream_call_dashscope_text_fn(
        image_items=rendered_image_items(rendered_pages),
        page_numbers=page_numbers,
        range_prompt=range_prompt,
        channel="text",
    )
    return prepare_pdf_ocr_grounding_fn(
        extracted_text,
        structure_title="",
        range_prompt=range_prompt,
    )


def stream_pdf_direct_generation(
    *,
    rendered_pages: list[tuple[int, bytes, str]],
    page_numbers: list[int],
    range_prompt: str,
    import_options: Any,
    extracted_text: str | None,
    stream_call_dashscope_pdf_json_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    yield _status_event(step_protocol.generate_pdf_mindmap_direct_step())
    return (
        yield from stream_call_dashscope_pdf_json_fn(
            image_items=rendered_image_items(rendered_pages),
            channel="raw_model",
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=False,
            import_options=import_options,
            extracted_text=extracted_text,
        )
    )


def stream_pdf_structure_recognition(
    *,
    structure_payload: tuple[int, bytes, str],
    structure_page: int,
    range_prompt: str,
    preserve_emphasis_marks: bool,
    build_pdf_structure_prompt_fn,
    extend_prompt_for_pdf_fn,
    stream_call_dashscope_json_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    yield _status_event(
        step_protocol.recognize_pdf_structure_step(structure_page=structure_page)
    )
    return (
        yield from stream_call_dashscope_json_fn(
            image_bytes=structure_payload[1],
            filename=structure_payload[2],
            prompt=extend_prompt_for_pdf_fn(
                build_pdf_structure_prompt_fn(
                    preserve_emphasis_marks=preserve_emphasis_marks,
                ),
                page_numbers=[structure_page],
                range_prompt=range_prompt,
            ),
            disable_rebalance=True,
            channel="raw_model",
        )
    )


def stream_pdf_body_ocr(
    *,
    body_payloads: list[tuple[int, bytes, str]],
    range_prompt: str,
    structure_title: str,
    prepare_pdf_ocr_grounding_fn,
    stream_call_dashscope_text_fn,
) -> Generator[ImportStreamEvent, None, str | None]:
    yield _status_event(step_protocol.extract_pdf_body_ocr_step())
    body_page_numbers = [page_number for page_number, _, _ in body_payloads]
    extracted_text = yield from stream_call_dashscope_text_fn(
        image_items=rendered_image_items(body_payloads),
        page_numbers=body_page_numbers,
        range_prompt=range_prompt,
        channel="text",
    )
    trimmed_text, _ = prepare_pdf_ocr_grounding_fn(
        extracted_text,
        structure_title=structure_title,
        range_prompt=range_prompt,
    )
    return trimmed_text


def stream_pdf_body_merge(
    *,
    structure_payload: tuple[int, bytes, str],
    body_payloads: list[tuple[int, bytes, str]],
    structure_tree: dict[str, Any],
    page_numbers: list[int],
    range_prompt: str,
    import_options: Any,
    extracted_text: str | None,
    order_pdf_image_items_fn,
    stream_call_dashscope_batch_json_fn,
) -> Generator[ImportStreamEvent, None, dict[str, Any]]:
    yield _status_event(step_protocol.merge_pdf_body_step())
    return (
        yield from stream_call_dashscope_batch_json_fn(
            image_items=order_pdf_image_items_fn(structure_payload, body_payloads),
            structure_tree=structure_tree,
            channel="raw_model",
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=True,
            import_options=import_options,
            extracted_text=extracted_text,
        )
    )


def stream_skip_pdf_body_steps() -> Generator[ImportStreamEvent, None, None]:
    yield _status_event(step_protocol.skip_pdf_body_ocr_step())
    yield _status_event(step_protocol.skip_pdf_body_merge_step())
    return None
