"""Bing Dictionary — port of Saladict bing/engine.ts (cn.bing.com clientsearch)."""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application.dom_util import (
    class_contains,
    parse_html,
    text_content,
    xpath_all,
)
from memory_anki.modules.english_lookup.application.html_result import (
    html_error,
    html_ok,
    speaker_button,
)
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_html
from memory_anki.modules.english_lookup.application.normalize import absolute_url

HOST = "https://cn.bing.com"
DICT_LINK = (
    "https://cn.bing.com/dict/clientsearch?mkt=zh-CN&setLang=zh"
    "&form=BDVEHC&ClientVer=BDDTV3.5.1.4320&q="
)
_MP3_RE = re.compile(
    r"((?:https?:)?//[^'\"\s)]+\.mp3(?:\?[^'\"\s)]*)?|/[^'\"\s)]+\.mp3(?:\?[^'\"\s)]*)?)"
)
_AUDIO_ATTRS = ("data-pronunciation", "data-mp3link", "audiomd5")


def source_page(query: str) -> str:
    return f"https://cn.bing.com/dict/search?q={quote(query)}"


def search(query: str) -> dict[str, Any]:
    url = source_page(query)
    fetch_url = DICT_LINK + quote(query)
    try:
        document = fetch_html(
            fetch_url,
            timeout=10.0,
            headers={"Referer": f"{HOST}/dict/"},
        )
    except FetchError as exc:
        error = "MANUAL_VERIFICATION" if exc.status_code == 403 else str(exc)
        return html_error(url, error)

    root = parse_html(document)
    title = text_content(root, f".//*[ {class_contains('client_def_hd_hd')} ]")
    if title:
        return _lex_result(root, url, title)

    machine = text_content(root, f".//*[ {class_contains('client_trans_head')} ]")
    if machine:
        mt = text_content(root, f".//*[ {class_contains('client_sen_cn')} ]") or machine
        markup = f"<div class='dict-bing'><p>{html.escape(mt)}</p></div>"
        return html_ok(source_url=url, entries=[{"id": "d-bing-entry0", "html": markup}])

    related_title = text_content(root, f".//*[ {class_contains('client_do_you_mean_title_bar')} ]")
    if related_title:
        items = []
        for word_el in xpath_all(root, f".//*[ {class_contains('client_do_you_mean_list_word')} ]")[:8]:
            word = (word_el.text_content() or "").strip()
            if word:
                items.append(f"<li>{html.escape(word)}</li>")
        markup = (
            f"<div class='dict-bing'><p>{html.escape(related_title)}</p>"
            f"<ul>{''.join(items)}</ul></div>"
        )
        return html_ok(source_url=url, entries=[{"id": "d-bing-entry0", "html": markup}])

    return html_error(url, "NO_RESULT", status="empty")


def _lex_result(root: Any, url: str, title: str) -> dict[str, Any]:
    audio: dict[str, str | None] = {"us": None, "uk": None}
    phsym_html: list[str] = []
    for node in xpath_all(root, f".//*[ {class_contains('client_def_hd_pn_list')} ]"):
        lang = text_content(node, f".//*[ {class_contains('client_def_hd_pn')} ]") or (
            node.text_content() or ""
        ).strip()
        pron = _audio_from(node)
        if _lang_is_us(lang):
            audio["us"] = audio["us"] or pron
        elif _lang_is_uk(lang):
            audio["uk"] = audio["uk"] or pron
        phsym_html.append(
            f"<li>{html.escape(lang)} {speaker_button(pron)}</li>"
        )

    defs_html: list[str] = []
    for node in xpath_all(root, f".//*[ {class_contains('client_def_bar')} ]")[:12]:
        pos = text_content(node, f".//*[ {class_contains('client_def_title_bar')} ]")
        definition = text_content(node, f".//*[ {class_contains('client_def_list')} ]")
        if not definition:
            continue
        defs_html.append(
            "<li>"
            + (f"<span class='pos'>{html.escape(pos)}</span> " if pos else "")
            + f"<span class='def'>{html.escape(definition)}</span></li>"
        )

    infs = [
        (node.text_content() or "").strip()
        for node in xpath_all(root, f".//*[ {class_contains('client_word_change_word')} ]")
        if (node.text_content() or "").strip()
    ]

    sentences_html: list[str] = []
    for node in xpath_all(root, f".//*[ {class_contains('client_sentence_list')} ]")[:4]:
        en = text_content(node, f".//*[ {class_contains('client_sen_en')} ]")
        chs = text_content(node, f".//*[ {class_contains('client_sen_cn')} ]")
        mp3 = _audio_from(node)
        if not en and not chs:
            continue
        sentences_html.append(
            "<li>"
            + (f"<p>{html.escape(en)} {speaker_button(mp3)}</p>" if en else "")
            + (f"<p>{html.escape(chs)}</p>" if chs else "")
            + "</li>"
        )

    if not defs_html and not phsym_html and not sentences_html:
        return html_error(url, "NO_RESULT", status="empty")

    body = [
        '<div class="dict-bing">',
        f"<h1 class='headword'>{html.escape(title)}</h1>",
    ]
    if phsym_html:
        body.append(f"<ul class='phsym'>{''.join(phsym_html)}</ul>")
    if defs_html:
        body.append(f"<ul class='cdef'>{''.join(defs_html)}</ul>")
    if infs:
        body.append(
            "<p class='infs'>词形："
            + " / ".join(html.escape(item) for item in infs[:8])
            + "</p>"
        )
    if sentences_html:
        body.append(f"<ol class='sentences'>{''.join(sentences_html)}</ol>")
    body.append("</div>")
    return html_ok(
        source_url=url,
        entries=[{"id": "d-bing-entry0", "html": "".join(body)}],
        audio=audio,
    )


def _audio_from(node: Any) -> str | None:
    candidates = [node, *xpath_all(node, ".//*[@data-pronunciation or @data-mp3link or @audiomd5 or @onclick]")]
    for el in candidates:
        for attr in _AUDIO_ATTRS:
            value = el.get(attr) if hasattr(el, "get") else None
            if value:
                return absolute_url(HOST, value)
        onclick = el.get("onclick") if hasattr(el, "get") else None
        if onclick:
            match = _MP3_RE.search(onclick)
            if match:
                return absolute_url(HOST, match.group(1))
    return None


def _lang_is_us(text: str) -> bool:
    return re.search(r"us|美", text or "", re.IGNORECASE) is not None


def _lang_is_uk(text: str) -> bool:
    return re.search(r"uk|英", text or "", re.IGNORECASE) is not None
