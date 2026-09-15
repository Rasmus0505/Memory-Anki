"""Youdao English–Chinese fallback for when Cambridge is blocked or 403."""

from __future__ import annotations

import html
import json
from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_raw

HOST = "https://dict.youdao.com"
PAGE_HOST = "https://www.youdao.com"
VOICE_HOST = "https://dict.youdao.com/dictvoice"


def source_page(query: str) -> str:
    return f"{PAGE_HOST}/result?word={quote(query)}&lang=en"


def search(query: str) -> dict[str, Any]:
    """Return the Cambridge-shaped lookup contract from Youdao jsonapi."""
    url = source_page(query)
    api_url = f"{HOST}/jsonapi?q={quote(query)}"
    try:
        raw, charset = fetch_raw(
            api_url,
            headers={"Accept": "application/json,text/plain,*/*;q=0.8"},
        )
    except FetchError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "sourceUrl": url,
            "entries": [],
            "audio": {"us": None, "uk": None},
        }

    try:
        payload = json.loads(raw.decode(charset or "utf-8", errors="replace"))
    except json.JSONDecodeError:
        return {
            "status": "empty",
            "error": "NO_RESULT",
            "sourceUrl": url,
            "entries": [],
            "audio": {"us": None, "uk": None},
        }

    word = _first_word((payload.get("ec") or {}).get("word") if isinstance(payload, dict) else None)
    if not isinstance(word, dict):
        word = _first_word(
            (payload.get("simple") or {}).get("word") if isinstance(payload, dict) else None
        )
    if not isinstance(word, dict):
        return {
            "status": "empty",
            "error": "NO_RESULT",
            "sourceUrl": url,
            "entries": [],
            "audio": {"us": None, "uk": None},
        }

    headword = _plain_text(word.get("return-phrase")) or query
    definitions = _flatten_definitions(word.get("trs"))
    if not definitions:
        return {
            "status": "empty",
            "error": "NO_RESULT",
            "sourceUrl": url,
            "entries": [],
            "audio": {"us": None, "uk": None},
        }

    us_audio = _voice_url(word.get("usspeech"))
    uk_audio = _voice_url(word.get("ukspeech"))
    entry_html = _entry_html(
        headword=headword,
        usphone=_plain_text(word.get("usphone")),
        ukphone=_plain_text(word.get("ukphone")),
        us_audio=us_audio,
        uk_audio=uk_audio,
        definitions=definitions,
    )
    return {
        "status": "ok",
        "error": None,
        "sourceUrl": url,
        "entries": [{"id": "d-youdao-entry0", "html": entry_html}],
        "audio": {"us": us_audio, "uk": uk_audio},
    }


def _plain_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, list):
        parts = [_plain_text(item) for item in value]
        return " ".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        if "i" in value:
            return _plain_text(value.get("i"))
        if "l" in value:
            return _plain_text(value.get("l"))
        for key in ("return-phrase", "word", "value", "text"):
            text = _plain_text(value.get(key))
            if text:
                return text
    return ""


def _first_word(value: Any) -> dict[str, Any] | None:
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return value[0]
    if isinstance(value, dict):
        return value
    return None


def _flatten_definitions(trs: Any) -> list[str]:
    definitions: list[str] = []
    if not isinstance(trs, list):
        return definitions
    for item in trs:
        if not isinstance(item, dict):
            continue
        rows = item.get("tr")
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            parts = (row.get("l") or {}).get("i") if isinstance(row.get("l"), dict) else None
            if isinstance(parts, list):
                definitions.extend(str(part).strip() for part in parts if str(part).strip())
            elif parts:
                text = str(parts).strip()
                if text:
                    definitions.append(text)
    return definitions


def fallback_audio(query: str) -> dict[str, str]:
    """Youdao dictvoice — reliable US/UK word audio when dictionary CDNs hotlink-block."""
    encoded = quote(query)
    return {
        "us": f"{VOICE_HOST}?audio={encoded}&type=2",
        "uk": f"{VOICE_HOST}?audio={encoded}&type=1",
    }


def _voice_url(speech: Any) -> str | None:
    token = str(speech or "").strip()
    if not token:
        return None
    return f"{VOICE_HOST}?audio={token}"


def _entry_html(
    *,
    headword: str,
    usphone: str,
    ukphone: str,
    us_audio: str | None,
    uk_audio: str | None,
    definitions: list[str],
) -> str:
    chunks = ['<div class="entry-body__el">', '<div class="pos-header">']
    chunks.append(f'<span class="headword">{html.escape(headword)}</span>')
    chunks.append(_pron_html("us", "US", usphone, us_audio))
    chunks.append(_pron_html("uk", "UK", ukphone, uk_audio))
    chunks.append("</div>")
    chunks.append('<div class="def-body">')
    for item in definitions:
        chunks.append(f"<p>{html.escape(item)}</p>")
    chunks.append("</div></div>")
    return "".join(chunk for chunk in chunks if chunk)


def _pron_html(kind: str, label: str, phone: str, audio: str | None) -> str:
    if not phone and not audio:
        return ""
    inner = []
    if phone:
        inner.append(f"{label} /{html.escape(phone)}/")
    if audio:
        inner.append(
            f'<button type="button" class="dict-speaker" data-src-mp3="{html.escape(audio, quote=True)}"></button>'
        )
    return f'<span class="dpron-i {kind}">{" ".join(inner)}</span>'
