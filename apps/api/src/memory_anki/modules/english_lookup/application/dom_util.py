"""Minimal lxml helpers (XPath only; no cssselect dependency)."""

from __future__ import annotations

from lxml import html
from lxml.html import HtmlElement

from memory_anki.modules.english_lookup.application.normalize import absolute_url

# Tags/attrs stripped when serializing Cambridge HTML for the panel.
_FORBIDDEN_TAGS = frozenset({"script", "style", "iframe", "object", "embed", "form"})
_FORBIDDEN_ATTR_PREFIXES = ("on",)


def parse_html(document: str) -> HtmlElement:
    return html.fromstring(document)


def xpath_all(node: HtmlElement, expression: str) -> list[HtmlElement]:
    found = node.xpath(expression)
    return [el for el in found if isinstance(el, html.HtmlElement)]


def xpath_first(node: HtmlElement, expression: str) -> HtmlElement | None:
    items = xpath_all(node, expression)
    return items[0] if items else None


def text_content(node: HtmlElement | None, expression: str | None = None) -> str:
    target = node
    if node is not None and expression:
        target = xpath_first(node, expression)
    if target is None:
        return ""
    return " ".join((target.text_content() or "").split()).strip()


def class_contains(class_name: str) -> str:
    """XPath predicate: element has class token."""
    return (
        f"contains(concat(' ', normalize-space(@class), ' '), ' {class_name} ')"
    )


def remove_matches(node: HtmlElement, expression: str) -> None:
    for child in xpath_all(node, expression):
        parent = child.getparent()
        if parent is not None:
            parent.remove(child)


def rewrite_links(node: HtmlElement, host: str) -> None:
    for el in xpath_all(node, ".//*[@href]"):
        href = el.get("href")
        full = absolute_url(host, href)
        if full:
            el.set("href", full)
            # Cambridge internal dict links stay same-host; panel will decide.
            if not full.startswith(host):
                el.set("target", "_blank")
                el.set("rel", "nofollow noopener noreferrer")
                el.set("data-external", "1")
            else:
                el.set("data-internal", "1")
    for el in xpath_all(node, ".//*[@src]"):
        src = el.get("src")
        full = absolute_url(host, src)
        if full:
            el.set("src", full)


def sanitize_subtree(node: HtmlElement) -> None:
    for el in list(node.iter()):
        if not isinstance(el, html.HtmlElement):
            continue
        tag = (el.tag or "").lower() if isinstance(el.tag, str) else ""
        if tag in _FORBIDDEN_TAGS:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)
            continue
        for attr in list(el.attrib):
            lower = attr.lower()
            if lower == "style" or lower.startswith(_FORBIDDEN_ATTR_PREFIXES):
                del el.attrib[attr]


def inner_html(node: HtmlElement, host: str) -> str:
    rewrite_links(node, host)
    sanitize_subtree(node)
    parts: list[str] = []
    if node.text:
        parts.append(node.text)
    for child in node:
        parts.append(html.tostring(child, encoding="unicode", method="html"))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts).strip()


def replace_with_speaker(daud: HtmlElement, src: str) -> None:
    """Replace Cambridge .daud block with a clickable speaker marker."""
    button = html.Element("button")
    button.set("type", "button")
    button.set("class", "dict-speaker")
    button.set("data-src-mp3", src)
    button.set("aria-label", "Play pronunciation")
    button.text = "🔊"
    parent = daud.getparent()
    if parent is None:
        return
    daud_index = list(parent).index(daud)
    parent.remove(daud)
    parent.insert(daud_index, button)
