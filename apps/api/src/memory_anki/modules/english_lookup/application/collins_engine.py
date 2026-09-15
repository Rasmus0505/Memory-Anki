"""Collins COBUILD — port of Saladict cobuild/engine.ts."""

from __future__ import annotations

import html
from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application.dom_util import (
    class_contains,
    inner_html,
    parse_html,
    replace_with_speaker,
    xpath_all,
    xpath_first,
)
from memory_anki.modules.english_lookup.application.html_result import html_error, html_ok
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_html
from memory_anki.modules.english_lookup.application.normalize import absolute_url

HOST = "https://www.collinsdictionary.com"
_SKIP_TYPES = {
    "video",
    "trends",
    "wordlists",
    "translation",
    "translations",
    "video pronunciation",
    "word lists",
    "word usage trends",
}


def source_page(query: str) -> str:
    slug = quote(query.replace(" ", "-"))
    return f"{HOST}/dictionary/english/{slug}"


def search(query: str) -> dict[str, Any]:
    slug = quote(query.replace(" ", "-"))
    urls = [
        f"{HOST}/dictionary/english/{slug}",
        f"{HOST}/zh/dictionary/english/{slug}",
    ]
    last_error = "NO_RESULT"
    last_url = urls[0]
    for url in urls:
        last_url = url
        try:
            document = fetch_html(
                url,
                timeout=10.0,
                headers={"Referer": f"{HOST}/"},
            )
        except FetchError as exc:
            last_error = "MANUAL_VERIFICATION" if exc.status_code == 403 else str(exc)
            continue
        result = _parse(document, url)
        if result.get("status") == "ok":
            return result
        last_error = str(result.get("error") or "NO_RESULT")
    status = "error" if last_error not in {"NO_RESULT"} else "empty"
    return html_error(last_url, last_error, status=status)


def _parse(document: str, url: str) -> dict[str, Any]:
    root = parse_html(document)
    audio: dict[str, str | None] = {"us": None, "uk": None}
    entries: list[dict[str, str]] = []

    metas = xpath_all(root, ".//*[@data-type-block]")
    seen: set[int] = set()
    for index, meta in enumerate(metas):
        raw_type = (meta.get("data-type-block") or "").strip()
        type_key = raw_type.lower()
        if type_key.startswith("definition.title.type."):
            type_key = type_key[len("definition.title.type.") :]
        if not type_key or type_key in _SKIP_TYPES or type_key.startswith("translation"):
            continue
        section = _section_content(meta)
        section_id = id(section)
        if section_id in seen:
            continue
        seen.add(section_id)

        mp3 = _section_audio(section)
        if mp3:
            if _is_american(type_key):
                audio["us"] = audio["us"] or mp3
            else:
                audio["uk"] = audio["uk"] or mp3

        for button in xpath_all(section, f".//*[ {class_contains('audio_play_button')} ]"):
            src = absolute_url(HOST, button.get("data-src-mp3"))
            if src:
                replace_with_speaker(button, src)

        content = inner_html(section, HOST)
        if not content.strip():
            continue
        title = (meta.get("data-title-block") or "").strip()
        heading = type_key.replace("_", " ").title()
        if title and title.lower() != heading.lower():
            heading = f"{heading}: {title}"
        wrapped = f"<div class='dict-collins'><h2>{html.escape(heading)}</h2>{content}</div>"
        entries.append({"id": f"d-collins-entry{index}", "html": wrapped})
        if len(entries) >= 3:
            break

    if not entries:
        return html_error(url, "NO_RESULT", status="empty")
    return html_ok(source_url=url, entries=entries, audio=audio)


def _section_content(meta: Any) -> Any:
    classes = f" {meta.get('class') or ''} "
    if " cB-h " not in classes and not classes.endswith("cB-h "):
        if "cB-h" not in (meta.get("class") or ""):
            return meta
    parent = meta.getparent()
    while parent is not None:
        parent_class = parent.get("class") or ""
        if "cB" in parent_class.split() or "entry" in parent_class.split() or "asset" in parent_class.split():
            return parent
        parent = parent.getparent()
    return meta


def _section_audio(section: Any) -> str | None:
    button = xpath_first(
        section,
        f".//*[ {class_contains('pron')} ]//*[ {class_contains('audio_play_button')} ]",
    )
    if button is None:
        button = xpath_first(section, f".//*[ {class_contains('audio_play_button')} ]")
    if button is None:
        return None
    return absolute_url(HOST, button.get("data-src-mp3")) or None


def _is_american(type_key: str) -> bool:
    return type_key in {"american", "aed"} or "american" in type_key
