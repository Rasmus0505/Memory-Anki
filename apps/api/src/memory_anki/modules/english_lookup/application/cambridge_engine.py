"""Cambridge English–Chinese Simplified engine — port of Saladict cambridge/engine.ts."""

from __future__ import annotations

from typing import Any

from memory_anki.modules.english_lookup.application.dom_util import (
    class_contains,
    inner_html,
    parse_html,
    remove_matches,
    replace_with_speaker,
    text_content,
    xpath_all,
    xpath_first,
)
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_html
from memory_anki.modules.english_lookup.application.normalize import (
    absolute_url,
    encode_cambridge_path,
)

HOST = "https://dictionary.cambridge.org"
LANG_PATH = "english-chinese-simplified"


def source_page(query: str) -> str:
    return f"{HOST}/dictionary/{LANG_PATH}/{encode_cambridge_path(query)}"


def search(query: str) -> dict[str, Any]:
    """Return {status, entries, audio, error, sourceUrl}."""
    url = source_page(query)
    try:
        document = fetch_html(url)
    except FetchError as exc:
        code = exc.status_code
        error = "MANUAL_VERIFICATION" if code == 403 else str(exc)
        return {
            "status": "error",
            "error": error,
            "sourceUrl": url,
            "entries": [],
            "audio": {"us": None, "uk": None},
        }

    root = parse_html(document)
    entries: list[dict[str, str]] = []
    audio: dict[str, str | None] = {"us": None, "uk": None}

    entry_nodes = xpath_all(
        root,
        f".//*[ {class_contains('entry-body__el')} ]",
    )
    for index, entry in enumerate(entry_nodes):
        headword = text_content(
            entry,
            f".//*[ {class_contains('headword')} ]",
        )
        if not headword:
            continue

        pos_header = xpath_first(
            entry,
            f".//*[ {class_contains('pos-header')} ]",
        )
        if pos_header is not None:
            for pron in xpath_all(
                pos_header,
                f".//*[ {class_contains('dpron-i')} ]",
            ):
                daud = xpath_first(
                    pron,
                    f".//*[ {class_contains('daud')} ]",
                )
                if daud is None:
                    continue
                source = xpath_first(daud, './/source[@type="audio/mpeg"]')
                if source is None:
                    source = xpath_first(daud, ".//source[@src]")
                if source is None:
                    continue
                src = absolute_url(HOST, source.get("src"))
                if not src:
                    continue
                replace_with_speaker(daud, src)
                classes = f" {pron.get('class') or ''} "
                if audio["uk"] is None and " uk " in classes:
                    audio["uk"] = src
                if audio["us"] is None and " us " in classes:
                    audio["us"] = src
            remove_matches(pos_header, f".//*[ {class_contains('share')} ]")

        _sanitize_entry(entry)
        entry_id = f"d-cambridge-entry{index}"
        entries.append({"id": entry_id, "html": inner_html(entry, HOST)})

    if not entries:
        idiom = xpath_first(root, f".//*[ {class_contains('idiom-block')} ]")
        if idiom is not None:
            remove_matches(idiom, f".//*[ {class_contains('bb')} and {class_contains('hax')} ]")
            _sanitize_entry(idiom)
            entries.append({"id": "d-cambridge-entry-idiom", "html": inner_html(idiom, HOST)})

    if not entries:
        return {
            "status": "empty",
            "error": "NO_RESULT",
            "sourceUrl": url,
            "entries": [],
            "audio": audio,
        }

    return {
        "status": "ok",
        "error": None,
        "sourceUrl": url,
        "entries": entries,
        "audio": audio,
    }


def _sanitize_entry(entry) -> None:
    # Expand accordion markers (Saladict adds amp-accordion on daccord_h parent).
    for btn in xpath_all(entry, f".//*[ {class_contains('daccord_h')} ]"):
        parent = btn.getparent()
        if parent is not None:
            existing = parent.get("class") or ""
            if "amp-accordion" not in existing:
                parent.set("class", f"{existing} amp-accordion".strip())

    # amp-img → img
    from lxml import html as lhtml

    for amp_img in xpath_all(entry, ".//amp-img"):
        img_el = lhtml.Element("img")
        src = absolute_url(HOST, amp_img.get("src"))
        if src:
            img_el.set("src", src)
        for attr in ("width", "height", "title"):
            val = amp_img.get(attr)
            if val:
                img_el.set(attr, val)
        parent = amp_img.getparent()
        if parent is not None:
            amp_index = list(parent).index(amp_img)
            parent.remove(amp_img)
            parent.insert(amp_index, img_el)

    # amp-audio → speaker button
    for amp_audio in xpath_all(entry, ".//amp-audio"):
        source = xpath_first(amp_audio, ".//source")
        if source is not None:
            src = absolute_url(HOST, source.get("src"))
            if src:
                replace_with_speaker(amp_audio, src)
                continue
        parent = amp_audio.getparent()
        if parent is not None:
            parent.remove(amp_audio)

    # "See more" external
    for link in xpath_all(entry, f".//a[ {class_contains('had')} ]"):
        link.set("target", "_blank")
        link.set("rel", "nofollow noopener noreferrer")
        link.set("data-external", "1")
