"""Oxford Advanced Learner's Dictionary — port of Saladict oaldict/engine.ts."""

from __future__ import annotations

import html
from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application.dom_util import (
    class_contains,
    parse_html,
    text_content,
    xpath_all,
    xpath_first,
)
from memory_anki.modules.english_lookup.application.html_result import (
    html_error,
    html_ok,
    speaker_button,
)
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_html
from memory_anki.modules.english_lookup.application.normalize import absolute_url

HOST = "https://www.oxfordlearnersdictionaries.com"


def source_page(query: str) -> str:
    return f"{HOST}/search/english/direct/?q={quote(query)}"


def search(query: str) -> dict[str, Any]:
    url = source_page(query)
    try:
        document = fetch_html(
            url,
            timeout=10.0,
            headers={"Referer": f"{HOST}/"},
        )
    except FetchError as exc:
        error = "MANUAL_VERIFICATION" if exc.status_code == 403 else str(exc)
        return html_error(url, error)

    root = parse_html(document)
    main = xpath_first(root, ".//*[@id='entryContent']")
    if main is None:
        return html_error(url, "NO_RESULT", status="empty")

    webtop = xpath_first(main, f".//*[ {class_contains('webtop')} ]")
    title = text_content(webtop, f".//*[ {class_contains('headword')} ]") if webtop is not None else ""
    if not title:
        title = text_content(main, f".//*[ {class_contains('headword')} ]")
    pos = text_content(webtop, f".//*[ {class_contains('pos')} ]") if webtop is not None else ""

    audio: dict[str, str | None] = {"us": None, "uk": None}
    phon: dict[str, str] = {"us": "", "uk": ""}
    phon_nodes = xpath_all(main, f".//*[ {class_contains('phonetics')} ]/*")
    if not phon_nodes:
        phon_nodes = xpath_all(main, f".//*[ {class_contains('phons_br')} or {class_contains('phons_n_am')} ]")
    for index, node in enumerate(phon_nodes[:2]):
        classes = f" {node.get('class') or ''} "
        kind = "uk"
        if "us" in classes or "n_am" in classes or "n-am" in classes:
            kind = "us"
        elif "uk" in classes or "br" in classes:
            kind = "uk"
        elif index == 1:
            kind = "us"
        sound = xpath_first(node, ".//*[@data-src-mp3]")
        src = absolute_url(HOST, sound.get("data-src-mp3") if sound is not None else None)
        if src and not audio[kind]:
            audio[kind] = src
        ipa = text_content(node, f".//*[ {class_contains('phon')} ]")
        if ipa and not phon[kind]:
            phon[kind] = ipa

    if not audio["us"] or not audio["uk"]:
        for sound in xpath_all(main, ".//*[@data-src-mp3]"):
            src = absolute_url(HOST, sound.get("data-src-mp3"))
            if not src:
                continue
            classes = f" {sound.get('class') or ''} "
            parent_classes = f" {(sound.getparent().get('class') if sound.getparent() is not None else '') or ''} "
            if not audio["uk"] and ("uk" in classes or "br" in parent_classes):
                audio["uk"] = src
            elif not audio["us"] and ("us" in classes or "n_am" in parent_classes or "n-am" in parent_classes):
                audio["us"] = src
            elif not audio["uk"]:
                audio["uk"] = src
            elif not audio["us"]:
                audio["us"] = src

    senses_html: list[str] = []
    sense_nodes = xpath_all(
        main,
        f".//*[ {class_contains('sense')} and not(ancestor::*[ {class_contains('sense')} ]) ]",
    )
    for sense in sense_nodes[:12]:
        definition = text_content(sense, f".//*[ {class_contains('def')} ]")
        if not definition:
            continue
        examples = []
        for example in xpath_all(sense, f".//*[ {class_contains('x')} ]")[:3]:
            text = (example.text_content() or "").strip()
            if text:
                examples.append(text)
        chunk = [f"<li><span class='def'>{html.escape(definition)}</span>"]
        if examples:
            chunk.append("<ul class='examples'>")
            chunk.extend(f"<li>{html.escape(item)}</li>" for item in examples)
            chunk.append("</ul>")
        chunk.append("</li>")
        senses_html.append("".join(chunk))

    if not title and not senses_html:
        return html_error(url, "NO_RESULT", status="empty")

    body = [
        '<div class="dict-oald">',
        '<div class="webtop">',
        f'<span class="headword">{html.escape(title or query)}</span>',
    ]
    if pos:
        body.append(f'<span class="pos">{html.escape(pos)}</span>')
    body.append('<div class="phonetics">')
    if phon["uk"] or audio["uk"]:
        body.append(
            f'<span class="dpron-i uk">UK {html.escape(phon["uk"])} {speaker_button(audio["uk"])}</span>'
        )
    if phon["us"] or audio["us"]:
        body.append(
            f'<span class="dpron-i us">US {html.escape(phon["us"])} {speaker_button(audio["us"])}</span>'
        )
    body.append("</div></div>")
    if senses_html:
        body.append("<ol class='senses'>")
        body.extend(senses_html)
        body.append("</ol>")
    body.append("</div>")
    return html_ok(
        source_url=url,
        entries=[{"id": "d-oxford-entry0", "html": "".join(body)}],
        audio=audio,
    )
