from __future__ import annotations

from typing import Any

from memory_anki.modules.content.api import build_review_preview_payload

from .normalization import build_editor_doc


def build_image_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
) -> dict[str, Any]:
    editor_doc = build_editor_doc(
        source_tree,
        fallback_title=fallback_title,
        preserve_line_breaks=True,
    )
    return {
        "source_tree": source_tree,
        "editor_doc": editor_doc,
        "review_preview": build_review_preview_payload(
            editor_doc=editor_doc,
            source_tree=source_tree,
        ),
        "warnings": [],
        "can_apply": True,
        "match_mode": "strict_match",
    }


def build_batch_import_result_payload(
    *,
    source_tree: dict[str, Any],
    fallback_title: str,
    image_count: int,
) -> dict[str, Any]:
    return {
        **build_image_import_result_payload(
            source_tree=source_tree,
            fallback_title=fallback_title,
        ),
        "image_count": image_count,
    }


def build_text_result_payload(
    *,
    extracted_text: str,
) -> dict[str, Any]:
    return {
        "extracted_text": extracted_text,
        "warnings": [],
        "can_apply": False,
        "match_mode": "strict_match",
    }
