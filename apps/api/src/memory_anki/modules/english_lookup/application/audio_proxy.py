"""Same-origin audio proxy.

Saladict plays dictionary MP3s from an extension origin that can send the
dictionary Referer. The PWA is HTTPS on another host, so <audio src="https://oxford...">
is hotlink-blocked. Fetch on the backend and stream through /english-lookup/audio.
"""

from __future__ import annotations

import html
import ipaddress
import re
from urllib.parse import quote, unquote, urlparse

from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_binary
from memory_anki.modules.english_lookup.domain.errors import EnglishLookupError

_MAX_AUDIO_BYTES = 2_000_000
_SRC_MP3_RE = re.compile(r'data-src-mp3="([^"]*)"', re.IGNORECASE)

ALLOWED_AUDIO_HOST_SUFFIXES = (
    "oxfordlearnersdictionaries.com",
    "cambridge.org",
    "bing.com",
    "microsoft.com",
    "windows.net",
    "collinsdictionary.com",
    "youdao.com",
    "ydstatic.com",
    "baidu.com",
)

_AUDIO_ROUTE = "/api/v1/english-lookup/audio"
_VOICE_ROUTE = "/api/v1/english-lookup/voice"
_VOICE_CACHE_MAX = 64
_voice_cache: dict[tuple[str, str], tuple[bytes, str]] = {}


def reset_voice_cache() -> None:
    _voice_cache.clear()


def voice_url(query: str, accent: str = "us") -> str:
    accent_key = "uk" if str(accent).lower() in {"uk", "gb", "en-gb"} else "us"
    return f"{_VOICE_ROUTE}?q={quote(query)}&accent={accent_key}"


def voice_pair(query: str) -> dict[str, str]:
    return {"us": voice_url(query, "us"), "uk": voice_url(query, "uk")}


def infer_accent(raw_url: str) -> str:
    lower = str(raw_url or "").lower()
    if any(token in lower for token in ("uk_pron", "/uk/", "gb_", "type=1", "blob=uk", "en-gb", "accent=uk")):
        return "uk"
    return "us"


def is_allowed_audio_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return any(host == suffix or host.endswith("." + suffix) for suffix in ALLOWED_AUDIO_HOST_SUFFIXES)


def proxied_audio_url(url: str | None) -> str | None:
    if not url:
        return None
    trimmed = str(url).strip()
    if not trimmed:
        return None
    if trimmed.startswith(_AUDIO_ROUTE) or trimmed.startswith(_VOICE_ROUTE):
        return trimmed
    if not is_allowed_audio_url(trimmed):
        return None
    return f"{_AUDIO_ROUTE}?url={quote(trimmed, safe='')}"


def proxied_audio_pair(audio: dict[str, str | None] | None) -> dict[str, str | None]:
    audio = audio or {}
    return {
        "us": proxied_audio_url(audio.get("us")),
        "uk": proxied_audio_url(audio.get("uk")),
    }


def rewrite_speaker_urls(markup: str, query: str | None = None) -> str:
    def replace(match: re.Match[str]) -> str:
        raw = html.unescape(match.group(1) or "")
        rewritten: str | None
        if query:
            rewritten = voice_url(query, infer_accent(raw))
        else:
            rewritten = proxied_audio_url(raw)
        if not rewritten:
            return match.group(0)
        return f'data-src-mp3="{html.escape(rewritten, quote=True)}"'

    return _SRC_MP3_RE.sub(replace, markup)


def rewrite_html_entries(entries: list[dict[str, str]], query: str | None = None) -> list[dict[str, str]]:
    rewritten: list[dict[str, str]] = []
    for entry in entries:
        rewritten.append(
            {
                "id": entry.get("id") or "",
                "html": rewrite_speaker_urls(entry.get("html") or "", query),
            }
        )
    return rewritten


def fetch_audio(url: str) -> tuple[bytes, str]:
    decoded = unquote(str(url or "").strip())
    if not is_allowed_audio_url(decoded):
        raise EnglishLookupError("不支持的发音地址。", status_code=400)
    parsed = urlparse(decoded)
    host = (parsed.hostname or "").lower()
    referer = "https://www.youdao.com/" if host.endswith("youdao.com") else f"{parsed.scheme}://{parsed.netloc}/"
    try:
        body, content_type = fetch_binary(
            decoded,
            headers={
                "Accept": "audio/mpeg,audio/*,*/*;q=0.8",
                "Referer": referer,
            },
            timeout=8.0,
        )
    except FetchError as exc:
        raise EnglishLookupError("发音音频获取失败。", status_code=502) from exc
    if not body:
        raise EnglishLookupError("发音音频为空。", status_code=502)
    if len(body) > _MAX_AUDIO_BYTES:
        raise EnglishLookupError("发音音频过大。", status_code=502)
    media_type = content_type if content_type.startswith("audio/") else "audio/mpeg"
    return body, media_type


def fetch_voice(query: str, accent: str = "us") -> tuple[bytes, str]:
    from memory_anki.modules.english_lookup.application.youdao_engine import fallback_audio

    accent_key = "uk" if str(accent).lower() in {"uk", "gb", "en-gb"} else "us"
    cache_key = (query.strip().lower(), accent_key)
    cached = _voice_cache.get(cache_key)
    if cached is not None:
        return cached
    urls = fallback_audio(query.strip())
    body, media_type = fetch_audio(urls[accent_key])
    if len(_voice_cache) >= _VOICE_CACHE_MAX:
        _voice_cache.pop(next(iter(_voice_cache)))
    _voice_cache[cache_key] = (body, media_type)
    return body, media_type
