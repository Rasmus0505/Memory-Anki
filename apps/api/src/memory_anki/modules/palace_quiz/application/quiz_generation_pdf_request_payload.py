"""Payload assembly for PDF quiz generation requests."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ._question_utils import build_generation_source_meta
from .quiz_generation_pdf_request_context import PdfGenerationRequestContext
from .quiz_generation_shared import (
    build_generation_messages,
    build_pdf_source_context,
)


def build_pdf_generation_source_meta(
    *,
    context: PdfGenerationRequestContext,
    extra_prompt: str,
    enable_secondary_review: bool,
    resolved_ai: dict[str, Any],
) -> dict[str, Any]:
    source_artifacts = context.source_artifacts
    source_meta = build_generation_source_meta(
        source_kind="subject_pdf",
        generation_mode=(
            "subject_pdf_multi" if len(source_artifacts.source_items) > 1 else "subject_pdf"
        ),
        extra_prompt=extra_prompt,
        secondary_review_enabled=enable_secondary_review,
        subject_document_id=source_artifacts.primary_subject_document_id,
        page_numbers=sorted({page for page in source_artifacts.all_page_numbers if page > 0}),
        image_names=source_artifacts.all_image_names,
        pdf_sources=source_artifacts.source_items,
    )
    if context.selected_chapter is not None:
        source_meta["source_chapter_id"] = context.selected_chapter.id
    source_meta["resolved_ai"] = resolved_ai
    return source_meta


def build_pdf_generation_source_context(
    context: PdfGenerationRequestContext,
) -> str:
    return build_pdf_source_context(context.source_artifacts.source_items)


def build_pdf_generation_messages(
    *,
    session: Session,
    context: PdfGenerationRequestContext,
    extra_prompt: str,
    source_context: str,
) -> tuple[list[dict[str, Any]], str]:
    return build_generation_messages(
        session=session,
        extra_prompt=extra_prompt,
        source_label="；".join(context.source_artifacts.source_labels),
        image_items=context.source_artifacts.image_items,
        source_context=source_context,
    )


def build_pdf_generation_request_payload(
    *,
    system_prompt: str,
    messages: list[dict[str, Any]],
    source_meta: dict[str, Any],
    source_context: str,
    resolved_ai: dict[str, Any],
) -> dict[str, Any]:
    return {
        "prompt": system_prompt,
        "message_roles": [message.get("role") for message in messages],
        "response_format": {"type": "json_object"},
        "source_meta": source_meta,
        "source_context": source_context,
        "resolved_ai": resolved_ai,
    }


__all__ = [
    "build_pdf_generation_messages",
    "build_pdf_generation_request_payload",
    "build_pdf_generation_source_context",
    "build_pdf_generation_source_meta",
]
