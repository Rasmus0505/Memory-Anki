"""Shared HTML-dictionary result helpers (Oxford / Bing / Collins)."""

from __future__ import annotations

import html
from typing import Any

from memory_anki.modules.english_lookup.application.audio_proxy import (
    rewrite_html_entries,
    voice_pair,
)


def speaker_button(src: str | None) -> str:
    if not src:
        return ""
    escaped = html.escape(src, quote=True)
    return (
        f'<button type="button" class="dict-speaker" data-src-mp3="{escaped}" '
        'aria-label="Play pronunciation">🔊</button>'
    )


def html_error(source_url: str, message: str, *, status: str = "error") -> dict[str, Any]:
    return {
        "status": status,
        "entries": [],
        "audio": {"us": None, "uk": None},
        "error": message,
        "sourceUrl": source_url,
    }


def html_ok(
    *,
    source_url: str,
    entries: list[dict[str, str]],
    audio: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    return {
        "status": "ok",
        "entries": entries,
        "audio": {
            "us": (audio or {}).get("us"),
            "uk": (audio or {}).get("uk"),
        },
        "error": None,
        "sourceUrl": source_url,
    }


def finalize_html_result(query: str, result: dict[str, Any]) -> dict[str, Any]:
    """Use same-origin Youdao voice for playback; Oxford/Collins CDNs hotlink-block."""
    result["audio"] = voice_pair(query)
    if result.get("entries"):
        result["entries"] = rewrite_html_entries(list(result["entries"]), query)
    return result
