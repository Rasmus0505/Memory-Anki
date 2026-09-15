"""Caiyun Xiaoyi translator — Saladict caiyun, with Google Translate fallback."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import quote

from memory_anki.modules.english_lookup.application import google_translate_engine
from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_raw

ENDPOINT = "https://api.interpreter.caiyunai.com/v1/translator"
PAGE = "https://fanyi.caiyunapp.com/"
# Public demo token from Caiyun's open translator docs; override with CAIYUN_TOKEN.
_DEFAULT_TOKEN = "3975l6lr5pcbvidl6jl2"


def source_url(text: str) -> str:
    return f"{PAGE}#/?query={quote(text)}"


def search(text: str) -> dict[str, Any]:
    url = source_url(text)
    caiyun = _search_caiyun(text, url)
    if caiyun.get("status") == "ok":
        return caiyun
    google = google_translate_engine.search(text)
    if google.get("status") == "ok":
        google = dict(google)
        google["sourceUrl"] = url
        return google
    return caiyun if caiyun.get("status") == "error" else google


def _search_caiyun(text: str, url: str) -> dict[str, Any]:
    token = (os.environ.get("CAIYUN_TOKEN") or _DEFAULT_TOKEN).strip()
    payload = {
        "source": text.splitlines() or [text],
        "trans_type": "auto2zh",
        "request_id": "memory-anki",
        "detect": True,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        raw, charset = fetch_raw(
            ENDPOINT,
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Authorization": f"token {token}",
            },
            timeout=8.0,
        )
    except FetchError:
        return {
            "status": "error",
            "translation": "",
            "detectedLanguage": None,
            "error": "彩云小译暂时不可用，请稍后重试。",
            "sourceUrl": url,
        }
    try:
        parsed = json.loads(raw.decode(charset or "utf-8", errors="replace"))
    except json.JSONDecodeError:
        return {
            "status": "error",
            "translation": "",
            "detectedLanguage": None,
            "error": "彩云小译暂时不可用，请稍后重试。",
            "sourceUrl": url,
        }
    target = parsed.get("target") if isinstance(parsed, dict) else None
    if isinstance(target, list):
        translated = "\n".join(str(part).strip() for part in target if str(part).strip()).strip()
    elif isinstance(target, str):
        translated = target.strip()
    else:
        translated = ""
    if not translated:
        return {
            "status": "empty",
            "translation": "",
            "detectedLanguage": None,
            "error": None,
            "sourceUrl": url,
        }
    detected = None
    if isinstance(parsed, dict):
        confidence = parsed.get("confidence")
        detected = parsed.get("source") if isinstance(parsed.get("source"), str) else None
        if confidence is not None and detected is None:
            detected = "en"
    return {
        "status": "ok",
        "translation": translated,
        "detectedLanguage": detected,
        "error": None,
        "sourceUrl": url,
    }
