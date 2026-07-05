from __future__ import annotations

from memory_anki.core.time import utc_now_naive


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
]
