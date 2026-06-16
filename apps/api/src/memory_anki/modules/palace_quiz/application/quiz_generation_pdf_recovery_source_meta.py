"""Source-meta recovery helpers for PDF AI log recovery flows."""

from __future__ import annotations

from typing import Any

from memory_anki.core.time import utc_now_naive


def resolve_recovery_selected_chapter_id(
    source_meta: dict[str, Any],
    selected_chapter_id: int | None,
) -> int | None:
    if selected_chapter_id is not None:
        return selected_chapter_id
    raw_source_chapter_id = source_meta.get("source_chapter_id")
    if raw_source_chapter_id in (None, "", 0, "0"):
        return None
    return int(raw_source_chapter_id)


def build_recovered_source_meta(
    *,
    source_meta: dict[str, Any],
    ai_call_log_id: str,
    selected_chapter: Any = None,
) -> dict[str, Any]:
    recovered_source_meta = {
        **source_meta,
        "ai_call_log_id": ai_call_log_id,
        "generated_at": utc_now_naive().isoformat(),
        "extra_prompt": str(source_meta.get("extra_prompt") or "").strip(),
        "secondary_review_enabled": False,
        "recovered_from_ai_call_log_id": ai_call_log_id,
    }
    if selected_chapter is not None:
        recovered_source_meta["source_chapter_id"] = selected_chapter.id
    return recovered_source_meta


__all__ = [
    "build_recovered_source_meta",
    "resolve_recovery_selected_chapter_id",
]
