from __future__ import annotations

import base64
import json
import mimetypes
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_VISION_MODEL,
)
from memory_anki.modules.mindmap.application.editor_state_service import normalize_editor_doc

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_NODE_COUNT = 400
NOTE_THRESHOLD = 120
ERROR_SNIPPET_LIMIT = 160

PROMPT = """你是一个严格输出 JSON 的思维导图识别助手。

任务：读取用户给出的中文图片，把其中的层级结构尽量一比一还原成树形结构。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 保留原文措辞，不要总结，不要改写。
3. 尽量保留原图层级、分组、项目符号顺序。
4. 输出格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "children": []
    }
  ]
}
5. 如果某个节点没有子节点，children 仍然输出空数组。
6. 如果图里存在明显主标题，放到 title；否则给空字符串。
7. 不要添加图片里不存在的内容。
"""

TEXT_PROMPT = """你是一个严格输出纯文本的图片转文字助手。

任务：读取用户给出的中文图片，把图中的文字尽量完整、逐行地转成纯文本。

强制要求：
1. 只输出纯文本，不要输出 markdown，不要输出 JSON，不要输出解释。
2. 保留原文措辞，不要总结，不要改写。
3. 尽量保留原图中的段落、换行、列表顺序和层次缩进。
4. 不要添加图片里不存在的内容。
5. 如果有明显标题，保留在最前面。
"""


class MindMapImportError(ValueError):
    pass


@dataclass
class ImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]


@dataclass
class TextPreviewResult:
    extracted_text: str


def generate_import_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
) -> ImportPreviewResult:
    if not DASHSCOPE_API_KEY:
      raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。")
    if not image_bytes:
        raise MindMapImportError("未读取到图片内容。")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise MindMapImportError("图片过大，请压缩到 8MB 以内后重试。")

    source_tree = _call_dashscope_json(image_bytes=image_bytes, filename=filename)
    editor_doc = _build_editor_doc(source_tree, fallback_title=fallback_title)
    return ImportPreviewResult(source_tree=source_tree, editor_doc=editor_doc)


def generate_text_preview(
    *,
    image_bytes: bytes,
    filename: str | None,
) -> TextPreviewResult:
    if not DASHSCOPE_API_KEY:
        raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。")
    if not image_bytes:
        raise MindMapImportError("未读取到图片内容。")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise MindMapImportError("图片过大，请压缩到 8MB 以内后重试。")

    extracted_text = _call_dashscope_text(image_bytes=image_bytes, filename=filename)
    return TextPreviewResult(extracted_text=extracted_text)


def _call_dashscope_json(*, image_bytes: bytes, filename: str | None) -> dict[str, Any]:
    content_text = _call_dashscope(
        image_bytes=image_bytes,
        filename=filename,
        prompt=PROMPT,
        response_format={"type": "json_object"},
    )
    source_tree = _parse_source_tree_json(content_text)
    return _normalize_source_tree(source_tree)


def _call_dashscope_text(*, image_bytes: bytes, filename: str | None) -> str:
    content_text = _call_dashscope(
        image_bytes=image_bytes,
        filename=filename,
        prompt=TEXT_PROMPT,
        response_format=None,
    )
    return _normalize_extracted_text(content_text)


def _call_dashscope(
    *,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
) -> str:
    mime_type = mimetypes.guess_type(filename or "")[0] or "image/png"
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    image_url = f"data:{mime_type};base64,{image_base64}"
    request_url = f"{DASHSCOPE_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": DASHSCOPE_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        "temperature": 0.1,
    }
    if response_format is not None:
        payload["response_format"] = response_format
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        request_url,
        data=body,
        headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise MindMapImportError(f"百炼接口调用失败：HTTP {exc.code} {detail}".strip()) from exc
    except urllib.error.URLError as exc:
        reason_text = str(exc.reason)
        if "10061" in reason_text:
            raise MindMapImportError(
                "百炼接口连接被拒绝："
                f"{reason_text}。当前目标地址：{request_url}。"
                "请检查 DASHSCOPE_BASE_URL 是否被覆盖成错误地址，"
                "本地代理或网关是否拦截，以及目标主机和端口是否可达。"
            ) from exc
        raise MindMapImportError(
            f"百炼接口网络异常：{reason_text}。当前目标地址：{request_url}"
        ) from exc

    try:
        parsed = json.loads(response_body)
        content = parsed["choices"][0]["message"]["content"]
        if isinstance(content, list):
            text_parts = [
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
            ]
            content_text = "\n".join(part for part in text_parts if part).strip()
        else:
            content_text = str(content).strip()
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise MindMapImportError("模型返回内容格式异常。") from exc

    return content_text


def _normalize_source_tree(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的顶层结构不是对象。")
    title = _clean_text(value.get("title"))
    children = value.get("children")
    if not isinstance(children, list):
        raise MindMapImportError("模型返回缺少 children 数组。")

    counter = {"count": 0}
    normalized_children = [_normalize_source_node(child, counter) for child in children]
    if counter["count"] > MAX_NODE_COUNT:
        raise MindMapImportError("识别出的节点过多，请换一张更聚焦的图片后重试。")
    return {
        "title": title,
        "children": normalized_children,
    }


def _normalize_source_node(value: Any, counter: dict[str, int]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的节点结构非法。")
    text = _clean_text(value.get("text"))
    if not text:
        raise MindMapImportError("模型返回了空节点文本。")
    counter["count"] += 1
    raw_children = value.get("children")
    if raw_children is None:
        raw_children = []
    if not isinstance(raw_children, list):
        raise MindMapImportError("模型返回的 children 不是数组。")
    return {
        "text": text,
        "children": [_normalize_source_node(child, counter) for child in raw_children],
    }


def _build_editor_doc(source_tree: dict[str, Any], *, fallback_title: str) -> dict[str, Any]:
    root_text = source_tree.get("title") or fallback_title or "未命名宫殿"
    raw_doc = {
        "root": {
            "data": {
                "text": root_text,
            },
            "children": [_source_node_to_editor_node(child) for child in source_tree["children"]],
        }
    }
    return normalize_editor_doc(raw_doc, root_text=root_text, root_kind="palace")


def _source_node_to_editor_node(source_node: dict[str, Any]) -> dict[str, Any]:
    text = source_node["text"]
    data: dict[str, Any] = {
        "uid": uuid.uuid4().hex,
    }
    if len(text) > NOTE_THRESHOLD:
        data["text"] = text[:NOTE_THRESHOLD].rstrip()
        data["note"] = text
    else:
        data["text"] = text
    return {
        "data": data,
        "children": [_source_node_to_editor_node(child) for child in source_node["children"]],
    }


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\u3000", " ").split()).strip()


def _strip_code_fence(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _parse_source_tree_json(content_text: str) -> dict[str, Any]:
    candidates: list[str] = []
    seen = set()

    def push(candidate: str | None) -> None:
        value = str(candidate or "").strip()
        if not value or value in seen:
            return
        seen.add(value)
        candidates.append(value)

    push(content_text)
    stripped = _strip_code_fence(content_text)
    push(stripped)
    push(_extract_first_json_object(content_text))
    if stripped != content_text:
        push(_extract_first_json_object(stripped))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise MindMapImportError(
        "模型返回内容不是有效的脑图 JSON。"
        f" 返回摘要：{_summarize_model_output(content_text)}"
    )


def _extract_first_json_object(value: str) -> str | None:
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


def _summarize_model_output(value: str) -> str:
    normalized = _clean_text(_strip_code_fence(value))
    if not normalized:
        return "模型没有返回可解析内容。"
    if len(normalized) <= ERROR_SNIPPET_LIMIT:
        return normalized
    return f"{normalized[:ERROR_SNIPPET_LIMIT].rstrip()}..."


def _normalize_extracted_text(value: str) -> str:
    text = _strip_code_fence(value)
    normalized_lines = [line.rstrip() for line in text.split("\n")]
    normalized = "\n".join(normalized_lines).strip()
    if not normalized:
        raise MindMapImportError("模型没有识别出可用文字。")
    return normalized
