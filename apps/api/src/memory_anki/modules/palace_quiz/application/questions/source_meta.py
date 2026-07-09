from __future__ import annotations

from typing import Any

from memory_anki.core.time import utc_now_naive


def normalize_optional_int(raw_value: Any) -> int | None:
    try:
        return int(raw_value) if raw_value not in (None, "", 0, "0") else None
    except (TypeError, ValueError):
        return None


def normalize_optional_string(raw_value: Any) -> str | None:
    return str(raw_value or "").strip() or None


def normalize_positive_int_list(raw_values: Any) -> list[int] | None:
    if not isinstance(raw_values, list):
        return None
    normalized_values: set[int] = set()
    for item in raw_values:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value > 0:
            normalized_values.add(value)
    return sorted(normalized_values) or None


def normalize_non_empty_string_list(raw_values: Any) -> list[str] | None:
    if not isinstance(raw_values, list):
        return None
    normalized_values = [
        normalized
        for item in raw_values
        if item is not None
        for normalized in [str(item).strip()]
        if normalized
    ]
    return normalized_values or None


def normalize_review_source_meta(source_meta: dict[str, Any]) -> dict[str, Any]:
    question_count_raw = source_meta.get("question_count")
    try:
        question_count = (
            int(question_count_raw)
            if question_count_raw not in (None, "", 0, "0")
            else None
        )
    except (TypeError, ValueError):
        question_count = None
    related_palace_summaries = (
        [item for item in source_meta.get("related_palace_summaries") if isinstance(item, dict)]
        if isinstance(source_meta.get("related_palace_summaries"), list)
        else None
    )
    return {
        "review_mode": str(source_meta.get("review_mode") or "").strip() or None,
        "related_palace_ids": normalize_positive_int_list(source_meta.get("related_palace_ids")),
        "related_palace_summaries": related_palace_summaries,
        "question_types": normalize_non_empty_string_list(source_meta.get("question_types")),
        "question_count": question_count,
    }


def normalize_source_meta(raw_source_meta: Any) -> dict[str, Any]:
    now_iso = utc_now_naive().isoformat()
    source_meta = raw_source_meta if isinstance(raw_source_meta, dict) else {}
    source_kind = normalize_optional_string(source_meta.get("source_kind")) or "manual"
    generation_mode = normalize_optional_string(source_meta.get("generation_mode")) or source_kind
    page_numbers = normalize_positive_int_list(source_meta.get("page_numbers"))
    image_names = normalize_non_empty_string_list(source_meta.get("image_names"))
    manual_import = source_meta.get("manual_import")
    source_pages = source_meta.get("source_pages")
    ocr_source_refs = source_meta.get("ocr_source_refs")
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
        "source_pages": source_pages if isinstance(source_pages, dict) else None,
        "ocr_source_refs": ocr_source_refs if isinstance(ocr_source_refs, list) else None,
        "repair_batch": normalize_optional_string(source_meta.get("repair_batch")),
        "repair_action": normalize_optional_string(source_meta.get("repair_action")),
        "import_batch": normalize_optional_string(source_meta.get("import_batch")),
        "approved_supplemental_from_ocr_source": (
            bool(source_meta.get("approved_supplemental_from_ocr_source"))
            if "approved_supplemental_from_ocr_source" in source_meta
            else None
        ),
        **normalize_review_source_meta(source_meta),
    }


def build_generation_source_meta(
    *,
    source_kind: str,
    generation_mode: str,
    extra_prompt: str,
    secondary_review_enabled: bool = False,
    page_numbers: list[int] | None = None,
    image_names: list[str] | None = None,
    ai_call_log_id: str | None = None,
) -> dict[str, Any]:
    return {
        "source_kind": source_kind,
        "page_numbers": page_numbers,
        "image_names": image_names,
        "extra_prompt": str(extra_prompt or "").strip(),
        "secondary_review_enabled": bool(secondary_review_enabled),
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "generation_mode": generation_mode,
    }


def finalize_generation_source_meta(
    source_meta: dict[str, Any],
    *,
    ai_call_log_id: str,
) -> None:
    source_meta["ai_call_log_id"] = str(ai_call_log_id or "").strip() or None
    source_meta["generated_at"] = utc_now_naive().isoformat()


__all__ = [
    "build_generation_source_meta",
    "finalize_generation_source_meta",
    "normalize_non_empty_string_list",
    "normalize_optional_int",
    "normalize_optional_string",
    "normalize_positive_int_list",
    "normalize_review_source_meta",
    "normalize_source_meta",
]
