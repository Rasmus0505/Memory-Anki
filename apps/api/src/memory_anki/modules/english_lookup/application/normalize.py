"""Query normalization for Saladict-style 1–5 word English selection."""

from __future__ import annotations

import re

# Hyphenated compounds count as one token (mother-in-law).
_TOKEN_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")
_WHITESPACE_RE = re.compile(r"\s+")
_MAX_WORDS = 5
_MAX_TRANSLATION_CHARS = 1000


def normalize_lookup_query(raw: str) -> str:
    """Collapse whitespace; keep letters, hyphens, apostrophes inside tokens."""
    text = str(raw or "").strip()
    if not text:
        return ""
    text = text.replace("’", "'").replace("–", "-").replace("—", "-")
    text = _WHITESPACE_RE.sub(" ", text)
    tokens = _TOKEN_RE.findall(text)
    if not tokens:
        return ""
    return " ".join(tokens)


def count_lookup_words(normalized: str) -> int:
    if not normalized:
        return 0
    return len(normalized.split(" "))


def validate_lookup_query(raw: str) -> tuple[str, int]:
    """Return (normalized, word_count) or raise-ready empty.

    Callers should reject empty or word_count > 5.
    """
    normalized = normalize_lookup_query(raw)
    word_count = count_lookup_words(normalized)
    return normalized, word_count


def is_valid_lookup_query(normalized: str, word_count: int) -> bool:
    return bool(normalized) and 1 <= word_count <= _MAX_WORDS


def normalize_translation_query(raw: str) -> str:
    """Keep sentence punctuation while normalizing whitespace for translation."""
    return _WHITESPACE_RE.sub(" ", str(raw or "").strip())


def is_valid_translation_query(text: str) -> bool:
    return bool(text) and len(text) <= _MAX_TRANSLATION_CHARS


def encode_cambridge_path(text: str) -> str:
    """Saladict: spaces → hyphens, then URI-encode."""
    from urllib.parse import quote

    path = _WHITESPACE_RE.sub("-", text.strip())
    return quote(path, safe="-")


def absolute_url(host: str, link: str | None) -> str:
    if not link:
        return ""
    link = str(link).strip()
    if not link:
        return ""
    host = host.rstrip("/")
    protocol = "https:" if host.startswith("https") else "http:"
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", link):
        return link
    if link.startswith("//"):
        return protocol + link
    if link.startswith("/"):
        return host + link
    return host + "/" + link.lstrip("./")
