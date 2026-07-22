from __future__ import annotations

import json
import re
from html import unescape
from typing import Any

from .contracts import MindMapAiSplitError

TAG_RE = re.compile(r"<[^>]+>")
HTML_BLOCK_BREAK_RE = re.compile(r"</(?:div|p|li|h[1-6]|blockquote|pre|tr)>", re.IGNORECASE)


def extract_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = [line for line in candidate.splitlines() if not line.strip().startswith("```")]
        candidate = "\n".join(lines).strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise MindMapAiSplitError("AI 分卡返回的 JSON 结构无效。") from None
        try:
            return json.loads(candidate[start : end + 1])
        except json.JSONDecodeError as exc:
            raise MindMapAiSplitError("AI 分卡返回的 JSON 结构无效。") from exc


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = stringify(value).strip()
        if text:
            return text
    return ""


def coerce_bool(value: Any, *, default: bool) -> bool:
    text = stringify(value).strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def coerce_float(
    value: Any,
    *,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    try:
        parsed = float(stringify(value).strip())
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def coerce_int(
    value: Any,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        parsed = int(stringify(value).strip())
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def ensure_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def plain_text(value: Any, *, fallback: str) -> str:
    text = stringify(value)
    text = (
        text.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
    )
    text = HTML_BLOCK_BREAK_RE.sub("\n", text)
    text = TAG_RE.sub("", text)
    text = unescape(text)
    lines = [re.sub(r"[^\S\r\n]+", " ", line).strip() for line in text.splitlines()]
    text = "\n".join(line for line in lines if line)
    if not text:
        return fallback
    return text


def plain_identifier(value: Any) -> str:
    text = stringify(value).strip().lower()
    text = re.sub(r"[^a-z0-9_-]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text
