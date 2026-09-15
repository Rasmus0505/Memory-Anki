"""Google Translate web endpoint adapter, compatible with Saladict's Google engine."""

from __future__ import annotations

import json
import urllib.parse
from typing import Any

from memory_anki.modules.english_lookup.application.http_fetch import FetchError, fetch_raw

_ENDPOINT = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute"
_TIMEOUT_SECONDS = 6.0


def source_url(text: str) -> str:
    encoded = urllib.parse.quote(text, safe="")
    return f"https://translate.google.com/?sl=auto&tl=zh-CN&text={encoded}&op=translate"


def _fetch_translation(text: str) -> Any:
    rpc_arguments = [[text, "auto", "zh-CN", True], [None]]
    batch = [[["MkEWBc", json.dumps(rpc_arguments, separators=(",", ":")), None, "generic"]]]
    body = urllib.parse.urlencode({"f.req": json.dumps(batch, separators=(",", ":"))}).encode(
        "utf-8"
    )
    query = urllib.parse.urlencode(
        {
            "rpcids": "MkEWBc",
            "source-path": "/",
            "hl": "zh-CN",
            "soc-app": "1",
            "soc-platform": "1",
            "soc-device": "1",
            "rt": "c",
        }
    )
    raw_bytes, charset = fetch_raw(
        f"{_ENDPOINT}?{query}",
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        timeout=_TIMEOUT_SECONDS,
    )
    raw = raw_bytes.decode(charset or "utf-8", errors="replace")
    return _parse_batchexecute(raw)


def _parse_batchexecute(raw: str) -> list[Any]:
    for line in raw.splitlines():
        if "MkEWBc" not in line or not line.lstrip().startswith("["):
            continue
        envelope = json.loads(line)
        record = envelope[0]
        payload = json.loads(record[2])
        segments = payload[1][0][0][5]
        translated = "".join(
            str(segment[0])
            for segment in segments
            if isinstance(segment, list) and segment and segment[0]
        )
        detected = payload[2] if len(payload) > 2 else None
        return [[[translated]], None, detected]
    raise ValueError("Google Translate response did not contain MkEWBc payload")


def search(text: str) -> dict[str, Any]:
    url = source_url(text)
    try:
        payload = _fetch_translation(text)
        segments = payload[0] if isinstance(payload, list) and payload else []
        translated = "".join(
            str(segment[0])
            for segment in segments
            if isinstance(segment, list) and segment and segment[0]
        ).strip()
        detected = payload[2] if len(payload) > 2 and isinstance(payload[2], str) else None
        if not translated:
            return {
                "status": "empty",
                "translation": "",
                "detectedLanguage": detected,
                "error": None,
                "sourceUrl": url,
            }
        return {
            "status": "ok",
            "translation": translated,
            "detectedLanguage": detected,
            "error": None,
            "sourceUrl": url,
        }
    except (FetchError, json.JSONDecodeError, TypeError, ValueError):
        return {
            "status": "error",
            "translation": "",
            "detectedLanguage": None,
            "error": "谷歌翻译暂时不可用，请稍后重试。",
            "sourceUrl": url,
        }
