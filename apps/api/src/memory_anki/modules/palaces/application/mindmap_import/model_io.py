from __future__ import annotations

import base64
import json
import mimetypes
import re
from typing import Any

from .contracts import MindMapImportError
from .text_utils import clean_inline_text

MAX_IMAGE_BYTES = 8 * 1024 * 1024
ERROR_SNIPPET_LIMIT = 160


def build_image_content_part(*, image_bytes: bytes, filename: str | None) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(filename or "")[0] or "image/png"
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    image_url = f"data:{mime_type};base64,{image_base64}"
    return {"type": "image_url", "image_url": {"url": image_url}}


def strip_code_fence(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def parse_source_tree_json(content_text: str) -> dict[str, Any]:
    candidates: list[str] = []
    seen = set()

    def push(candidate: str | None) -> None:
        value = str(candidate or "").strip()
        if not value or value in seen:
            return
        seen.add(value)
        candidates.append(value)

    push(content_text)
    stripped = strip_code_fence(content_text)
    push(stripped)
    push(extract_first_json_object(content_text))
    if stripped != content_text:
        push(extract_first_json_object(stripped))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise MindMapImportError(
        "模型返回内容不是有效的脑图 JSON。"
        f" 返回摘要：{summarize_model_output(content_text)}"
    )


def extract_first_json_object(value: str) -> str | None:
    text = str(value or "")
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[start : index + 1]
        start = text.find("{", start + 1)
    return None


def summarize_model_output(value: str) -> str:
    normalized = clean_inline_text(strip_code_fence(value))
    if not normalized:
        return "模型没有返回可解析内容。"
    if len(normalized) <= ERROR_SNIPPET_LIMIT:
        return normalized
    return f"{normalized[:ERROR_SNIPPET_LIMIT].rstrip()}..."


def normalize_extracted_text(value: str) -> str:
    text = strip_code_fence(value)
    normalized_lines = [line.rstrip() for line in text.split("\n")]
    normalized = "\n".join(normalized_lines).strip()
    if not normalized:
        raise MindMapImportError("模型没有识别出可用文字。")
    return normalized


def normalize_page_selection(page_selection: list[int], page_count: int) -> list[int]:
    normalized = sorted({int(page) for page in page_selection if int(page) > 0})
    if not normalized:
        raise MindMapImportError("请至少选择一页 PDF。")
    if page_count <= 0:
        raise MindMapImportError("当前 PDF 没有可用页面。")
    if any(page > page_count for page in normalized):
        raise MindMapImportError("存在超出 PDF 总页数的页码，请重新选择。")
    return normalized


def ensure_rendered_page_size(rendered_pages: list[tuple[int, bytes, str]]) -> None:
    total_bytes = 0
    for _, image_bytes, _ in rendered_pages:
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise MindMapImportError("存在单页渲染结果过大，请缩小页码范围后重试。")
        total_bytes += len(image_bytes)
    if total_bytes > MAX_IMAGE_BYTES * 6:
        raise MindMapImportError("本次所选 PDF 页面总大小过大，请减少页数后重试。")


def trim_pdf_extracted_text(text: str, *, structure_title: str, range_prompt: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    anchors = build_pdf_text_anchors(
        structure_title=structure_title,
        range_prompt=range_prompt,
    )
    lines = normalized.split("\n")
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if any(anchor in stripped for anchor in anchors):
            trimmed = "\n".join(lines[index:]).strip()
            return trimmed or normalized
    return normalized


def build_pdf_text_anchors(*, structure_title: str, range_prompt: str) -> list[str]:
    candidates = [range_prompt, structure_title]
    anchors: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        for part in split_prompt_anchor_parts(candidate):
            if part not in seen:
                seen.add(part)
                anchors.append(part)
    return anchors


def split_prompt_anchor_parts(value: str) -> list[str]:
    normalized = clean_inline_text(value)
    if not normalized:
        return []
    parts = [normalized]
    for segment in re.split(r"[，,：:；;。/\s]+", normalized):
        clean_segment = clean_inline_text(segment)
        if len(clean_segment) >= 2:
            parts.append(clean_segment)
    return sorted({part for part in parts if len(part) >= 2}, key=len, reverse=True)
