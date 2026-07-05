from __future__ import annotations

from typing import Any

from memory_anki.core.time import utc_now_naive

from .question_source_meta_review import normalize_review_source_meta
from .question_source_meta_shared import (
    normalize_non_empty_string_list,
    normalize_optional_string,
    normalize_positive_int_list,
)


def normalize_source_meta(raw_source_meta: Any) -> dict[str, Any]:
    now_iso = utc_now_naive().isoformat()
    source_meta = raw_source_meta if isinstance(raw_source_meta, dict) else {}
    source_kind = normalize_optional_string(source_meta.get("source_kind")) or "manual"
    generation_mode = normalize_optional_string(source_meta.get("generation_mode")) or source_kind
    page_numbers = normalize_positive_int_list(source_meta.get("page_numbers"))
    image_names = normalize_non_empty_string_list(source_meta.get("image_names"))
    manual_import = source_meta.get("manual_import")
    return {
        "source_kind": source_kind,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "extra_prompt": str(source_meta.get("extra_prompt") or "").strip(),
        "secondary_review_enabled": bool(source_meta.get("secondary_review_enabled", False)),
        "ai_call_log_id": normalize_optional_string(source_meta.get("ai_call_log_id")),
        "generated_at": str(source_meta.get("generated_at") or now_iso),
        "generation_mode": generation_mode,
        "recovered_from_ai_call_log_id": normalize_optional_string(
            source_meta.get("recovered_from_ai_call_log_id")
        ),
        "manual_import": manual_import if isinstance(manual_import, dict) else None,
        **normalize_review_source_meta(source_meta),
    }


__all__ = ["normalize_source_meta"]
