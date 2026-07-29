"""Vocabulary.com engine — port of Saladict vocabulary/engine.ts."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application.dom_util import parse_html, text_content
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_html

HOST = "https://www.vocabulary.com"


def source_page(query: str) -> str:
    return f"{HOST}/dictionary/{quote(query)}"


def search(query: str) -> dict[str, Any]:
    """Return {status, short?, long?, error?, sourceUrl}."""
    url = source_page(query)
    try:
        document = fetch_html(url)
    except FetchError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "sourceUrl": url,
            "short": None,
            "long": None,
        }

    root = parse_html(document)
    short = text_content(root, ".//*[contains(concat(' ', normalize-space(@class), ' '), ' short ')]")
    long = text_content(root, ".//*[contains(concat(' ', normalize-space(@class), ' '), ' long ')]")
    if not short or not long:
        return {
            "status": "empty",
            "error": "NO_RESULT",
            "sourceUrl": url,
            "short": None,
            "long": None,
        }
    return {
        "status": "ok",
        "error": None,
        "sourceUrl": url,
        "short": short,
        "long": long,
    }
