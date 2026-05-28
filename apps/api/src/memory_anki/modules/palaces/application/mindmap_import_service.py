from __future__ import annotations

import base64
import json
import mimetypes
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from html import escape, unescape
from typing import Any

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_VISION_MODEL,
)
from memory_anki.infrastructure.db.models import SubjectDocument
from memory_anki.modules.knowledge.application.subject_document_service import (
    render_selected_pdf_pages,
)
from memory_anki.modules.mindmap.application.editor_state_service import normalize_editor_doc

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_NODE_COUNT = 400
ERROR_SNIPPET_LIMIT = 160
NODE_WRAP_WIDTH = 38
NODE_WRAP_MIN_WIDTH = 10
LONG_NODE_SPLIT_THRESHOLD = 72
MAX_SPLIT_CHILDREN = 8
ABSTRACT_SPLIT_HEADINGS = (
    "特点",
    "内容",
    "类型",
    "分类",
    "比较",
    "对比",
    "区别",
    "联系",
    "作用",
    "意义",
    "方法",
    "形式",
    "原则",
    "制度",
    "目标",
)

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
8. 如果某个节点内容明显包含多个并列要点，不要把所有说明塞进一个超长节点；应改成一个较短的父节点标题，并把并列要点拆成多个 children。
9. 单个节点 text 尽量简洁，优先保留脑图式短语，而不是大段整句。
"""

BATCH_PROMPT = """你是一个严格输出 JSON 的教材转思维导图补全助手。

任务：
1. 第一张被指定为结构图的图片提供章节原始思维导图结构。
2. 其余图片提供该章节教材正文。
3. 你需要基于已提取出的原始导图结构，把正文内容补充到最匹配的节点下，输出增强后的完整树。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 顶层 JSON 格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "children": []
    }
  ]
}
3. 结构图中原有节点标题尽量保留原文，不要随意改写。
4. 正文内容必须补到最匹配的原节点下；允许新增多级子节点，不要求只补一层。
5. 如果正文内容无法精确匹配到叶子节点，宁可补到更高层级的相关节点下，也不要挂错位置。
6. 不要捏造图片里不存在的知识点。
7. 每个节点即使没有子节点，也必须输出 children: []。
8. 如果结构图没有明显标题，可以保留给定结构里的 title。
9. 如果某个原节点下补充出的正文本质上是多个并列要点，不要塞成一个超长节点；请拆成多个并列 children。
10. 单个节点 text 尽量保持脑图风格，避免过长整段。
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

PDF_PAGE_CONTEXT_PROMPT = """附加约束：
1. 只处理本次给出的 PDF 选定页面，不要假设整本书的其他页面内容。
2. 用户给出的页码范围和自然语言提示只是帮助你聚焦本次识别范围，不能编造未出现的内容。
"""

STRICT_STRUCTURE_PROMPT = """你是一个严格输出 JSON 的 PDF 脑图结构还原助手。

任务：只读取用户指定的 PDF 结构页，把页面中原本就存在的脑图结构完整还原出来。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 必须保留 PDF 自带脑图的原文、原层级、原顺序、原节点粒度。
3. 禁止改写、概括、合并、拆分、重排原始脑图节点。
4. 禁止为了“更像脑图”而缩短文字或提炼标题。
5. 如果原节点带有下划线或波浪线强调，必须在结果里保留强调信息。
6. 输出格式必须为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "rich_text_html": "<div>节点文字</div>",
      "emphasis_marks": [
        {"kind": "underline", "text": "被标注的原文"},
        {"kind": "wavy-underline", "text": "被波浪线标注的原文"}
      ],
      "children": []
    }
  ]
}
7. 如果某个节点没有子节点，children 仍然输出空数组。
8. 如果没有强调信息，emphasis_marks 输出空数组即可。
"""

STRICT_BATCH_PROMPT = """你是一个严格输出 JSON 的 PDF 脑图正文补充助手。

任务：
1. 第一张图片是已经指定的 PDF 结构页，对应的脑图结构 JSON 已给出。
2. 其余图片是正文页。
3. 你只能在给定结构的最小原始节点下面补充正文内容。

强制要求：
1. 只输出 JSON，不要输出 markdown，不要输出解释。
2. 原 PDF 脑图节点的 text、层级、顺序、粒度都不能变化。
3. 只能在最小原始节点下面新增 children，不允许新增节点替代原有节点，也不允许重组原结构。
4. 补充内容必须使用原话，不能概括、改写、压缩成短标题。
5. 如果正文中存在下划线或波浪线强调，必须在对应补充节点保留强调信息。
6. 输出格式仍为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "rich_text_html": "<div>节点文字</div>",
      "emphasis_marks": [],
      "children": []
    }
  ]
}
7. 如果你发现给定结构与结构页明显对不上，不要擅自修正结构；仍按最接近方式输出，并尽量在结果中保留原结构不动。
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


@dataclass
class BatchImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    structure_image_index: int
    image_count: int


@dataclass
class PdfImportPreviewResult:
    source_tree: dict[str, Any]
    editor_doc: dict[str, Any]
    selected_pages: list[int]
    structure_page: int
    match_mode: str = "strict_match"
    can_apply: bool = True
    warnings: list[str] | None = None


@dataclass
class PdfImportOptions:
    strict_restore: bool = True
    quote_original_text_only: bool = True
    mount_on_original_leaf_only: bool = True
    preserve_emphasis_marks: bool = True
    semantic_split_long_paragraphs: bool = True
    preserve_line_breaks: bool = True


@dataclass
class PdfTextPreviewResult:
    extracted_text: str
    selected_pages: list[int]


PROMPT_TEXT_MAX_CHARS = 12000


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
    editor_doc = _build_editor_doc(
        source_tree,
        fallback_title=fallback_title,
        preserve_line_breaks=True,
    )
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


def generate_batch_import_preview(
    *,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None = None,
) -> BatchImportPreviewResult:
    if not DASHSCOPE_API_KEY:
        raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。")
    if not image_items:
        raise MindMapImportError("请至少上传一张图片。")

    normalized_items: list[tuple[bytes, str | None]] = []
    total_bytes = 0
    for image_bytes, filename in image_items:
        if not image_bytes:
            raise MindMapImportError("存在未读取到内容的图片，请删除后重新上传。")
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise MindMapImportError("存在图片超过 8MB，请压缩后重试。")
        total_bytes += len(image_bytes)
        normalized_items.append((image_bytes, filename))

    if total_bytes > MAX_IMAGE_BYTES * 6:
        raise MindMapImportError("本次上传图片总大小过大，请减少图片数量或压缩后重试。")

    resolved_structure_index = structure_image_index if structure_image_index is not None else 0
    if resolved_structure_index < 0 or resolved_structure_index >= len(normalized_items):
        raise MindMapImportError("结构图索引无效，请重新选择结构图后再试。")

    structure_bytes, structure_filename = normalized_items[resolved_structure_index]
    structure_tree = _call_dashscope_json(
        image_bytes=structure_bytes,
        filename=structure_filename,
    )
    enhanced_tree = _call_dashscope_batch_json(
        image_items=normalized_items,
        structure_tree=structure_tree,
    )
    editor_doc = _build_editor_doc(
        enhanced_tree,
        fallback_title=fallback_title,
        preserve_line_breaks=True,
    )
    return BatchImportPreviewResult(
        source_tree=enhanced_tree,
        editor_doc=editor_doc,
        structure_image_index=resolved_structure_index,
        image_count=len(normalized_items),
    )


def generate_pdf_import_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    structure_page: int | None,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None = None,
) -> PdfImportPreviewResult:
    if not DASHSCOPE_API_KEY:
        raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转脑图模型。")

    resolved_options = import_options or PdfImportOptions()
    normalized_pages = _normalize_page_selection(page_selection, document.page_count)
    resolved_structure_page = structure_page or normalized_pages[0]
    if resolved_structure_page not in normalized_pages:
        raise MindMapImportError("结构页必须包含在当前选择的页码范围内。")

    rendered_pages = render_selected_pdf_pages(
        document,
        page_numbers=normalized_pages,
        kind="preview",
    )
    _ensure_rendered_page_size(rendered_pages)
    structure_payload = next(
        (payload for payload in rendered_pages if payload[0] == resolved_structure_page),
        None,
    )
    if structure_payload is None:
        raise MindMapImportError("未找到指定的结构页，请重新选择后再试。")

    warnings: list[str] = []
    structure_prompt = _build_pdf_structure_prompt(
        strict_restore=resolved_options.strict_restore,
        preserve_emphasis_marks=resolved_options.preserve_emphasis_marks,
    )
    structure_tree = _call_dashscope_json(
        image_bytes=structure_payload[1],
        filename=structure_payload[2],
        prompt=_extend_prompt_for_pdf(
            structure_prompt,
            page_numbers=[resolved_structure_page],
            range_prompt=range_prompt,
        ),
        disable_rebalance=resolved_options.strict_restore or not resolved_options.semantic_split_long_paragraphs,
    )
    ordered_items = [
        (image_bytes, filename)
        for page_number, image_bytes, filename in rendered_pages
        if page_number == resolved_structure_page
    ] + [
        (image_bytes, filename)
        for page_number, image_bytes, filename in rendered_pages
        if page_number != resolved_structure_page
    ]
    trimmed_text: str | None = None
    if len(normalized_pages) > 1:
        try:
            extracted_text = _call_dashscope_text_with_images(
                image_items=[(image_bytes, filename) for _, image_bytes, filename in rendered_pages],
                page_numbers=normalized_pages,
                range_prompt=range_prompt,
            )
            trimmed_text = _trim_pdf_extracted_text(
                extracted_text,
                structure_title=str(structure_tree.get("title") or fallback_title or ""),
                range_prompt=range_prompt,
            ) or None
        except MindMapImportError:
            warnings.append("未获得稳定的 OCR 正文，本次先按结构图和正文图片进行补全。")

    enhanced_tree = _call_dashscope_batch_json(
        image_items=ordered_items,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=normalized_pages,
        strict_restore=resolved_options.strict_restore,
        disable_rebalance=resolved_options.strict_restore or not resolved_options.semantic_split_long_paragraphs,
        import_options=resolved_options,
        extracted_text=trimmed_text,
    )

    editor_doc = _build_editor_doc(
        enhanced_tree,
        fallback_title=fallback_title,
        preserve_line_breaks=resolved_options.preserve_line_breaks,
    )
    match_mode = "strict_match"
    can_apply = True
    if resolved_options.strict_restore and _contains_structure_drift(structure_tree, enhanced_tree):
        match_mode = "approximate_match"
        can_apply = False
        warnings.append("检测到生成结果与 PDF 自带脑图基础结构不完全一致，当前仅提供近似草稿预览。")
    return PdfImportPreviewResult(
        source_tree=enhanced_tree,
        editor_doc=editor_doc,
        selected_pages=normalized_pages,
        structure_page=resolved_structure_page,
        match_mode=match_mode,
        can_apply=can_apply,
        warnings=warnings,
    )


def generate_pdf_text_preview(
    *,
    document: SubjectDocument,
    page_selection: list[int],
    range_prompt: str,
) -> PdfTextPreviewResult:
    if not DASHSCOPE_API_KEY:
        raise MindMapImportError("未配置 DASHSCOPE_API_KEY，无法调用图片转文字模型。")

    normalized_pages = _normalize_page_selection(page_selection, document.page_count)
    rendered_pages = render_selected_pdf_pages(
        document,
        page_numbers=normalized_pages,
        kind="preview",
    )
    _ensure_rendered_page_size(rendered_pages)
    extracted_text = _call_dashscope_text_with_images(
        image_items=[(image_bytes, filename) for _, image_bytes, filename in rendered_pages],
        page_numbers=normalized_pages,
        range_prompt=range_prompt,
    )
    return PdfTextPreviewResult(
        extracted_text=extracted_text,
        selected_pages=normalized_pages,
    )


def _call_dashscope_json(
    *,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
) -> dict[str, Any]:
    content_text = _call_dashscope(
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = _parse_source_tree_json(content_text)
    return _normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def _call_dashscope_text(*, image_bytes: bytes, filename: str | None) -> str:
    return _call_dashscope_text_with_images(
        image_items=[(image_bytes, filename)],
        page_numbers=None,
        range_prompt="",
    )


def _call_dashscope_text_with_images(
    *,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
) -> str:
    content_text = _call_dashscope(
        image_bytes=image_items[0][0],
        filename=image_items[0][1],
        prompt=_extend_prompt_for_pdf(
            TEXT_PROMPT,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
        ),
        response_format=None,
        image_items=image_items,
    )
    return _normalize_extracted_text(content_text)


def _call_dashscope_batch_json(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    strict_restore: bool = False,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    if page_numbers is not None or import_options is not None or extracted_text:
        prompt = _build_pdf_batch_prompt(
            structure_tree=structure_tree,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            strict_restore=strict_restore,
            import_options=import_options or PdfImportOptions(strict_restore=strict_restore),
            extracted_text=extracted_text,
        )
    else:
        prompt = (
            f"{BATCH_PROMPT}\n\n"
            f"下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：\n"
            f"{json.dumps(structure_tree, ensure_ascii=False)}\n\n"
            "接下来会按顺序提供结构图和正文图片。请综合所有图片后输出增强后的完整脑图 JSON。"
        )
    content_text = _call_dashscope_with_images(
        image_items=image_items,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = _parse_source_tree_json(content_text)
    return _normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def _call_dashscope(
    *,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> str:
    return _call_dashscope_with_images(
        image_items=image_items or [(image_bytes, filename)],
        prompt=prompt,
        response_format=response_format,
    )


def _call_dashscope_with_images(
    *,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
) -> str:
    request_url = f"{DASHSCOPE_BASE_URL.rstrip('/')}/chat/completions"
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for index, (image_bytes, filename) in enumerate(image_items, start=1):
        content.append({"type": "text", "text": f"第 {index} 张图片："})
        content.append(_build_image_content_part(image_bytes=image_bytes, filename=filename))
    payload = {
        "model": DASHSCOPE_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": content,
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


def _build_image_content_part(*, image_bytes: bytes, filename: str | None) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(filename or "")[0] or "image/png"
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    image_url = f"data:{mime_type};base64,{image_base64}"
    return {"type": "image_url", "image_url": {"url": image_url}}


def _normalize_source_tree(value: Any, *, disable_rebalance: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的顶层结构不是对象。")
    title = _clean_inline_text(value.get("title"))
    children = value.get("children")
    if not isinstance(children, list):
        raise MindMapImportError("模型返回缺少 children 数组。")

    counter = {"count": 0}
    normalized_children = [_normalize_source_node(child, counter) for child in children]
    if not disable_rebalance:
        normalized_children = [_rebalance_long_leaf_node(child) for child in normalized_children]
    if counter["count"] > MAX_NODE_COUNT:
        raise MindMapImportError("识别出的节点过多，请换一张更聚焦的图片后重试。")
    return {
        "title": title,
        "children": normalized_children,
    }


def _normalize_source_node(value: Any, counter: dict[str, int]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MindMapImportError("模型返回的节点结构非法。")
    text = _clean_multiline_text(value.get("text"))
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
        "rich_text_html": str(value.get("rich_text_html") or "").strip() or None,
        "emphasis_marks": _normalize_emphasis_marks(value.get("emphasis_marks")),
        "children": [_normalize_source_node(child, counter) for child in raw_children],
    }


def _rebalance_long_leaf_node(source_node: dict[str, Any]) -> dict[str, Any]:
    children = [_rebalance_long_leaf_node(child) for child in source_node["children"]]
    node = {
        "text": source_node["text"],
        "rich_text_html": source_node.get("rich_text_html"),
        "emphasis_marks": source_node.get("emphasis_marks") or [],
        "children": children,
    }
    if children:
        promoted = _promote_single_verbose_child(node)
        return promoted or node
    split_node = _split_overlong_leaf_node(node["text"])
    return split_node or node


def _normalize_emphasis_marks(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in {"underline", "wavy-underline"}:
            continue
        text = _clean_inline_text(item.get("text"))
        if not text:
            continue
        normalized.append({"kind": kind, "text": text})
    return normalized


def _build_editor_doc(
    source_tree: dict[str, Any],
    *,
    fallback_title: str,
    preserve_line_breaks: bool,
) -> dict[str, Any]:
    root_text = source_tree.get("title") or fallback_title or "未命名宫殿"
    raw_doc = {
        "root": {
            "data": {
                "text": root_text,
            },
            "children": [
                _source_node_to_editor_node(child, preserve_line_breaks=preserve_line_breaks)
                for child in source_tree["children"]
            ],
        }
    }
    return normalize_editor_doc(raw_doc, root_text=root_text, root_kind="palace")


def _source_node_to_editor_node(source_node: dict[str, Any], *, preserve_line_breaks: bool) -> dict[str, Any]:
    rich_text_html = _normalize_rich_text_html(
        source_node.get("rich_text_html"),
        text=source_node["text"],
        emphasis_marks=source_node.get("emphasis_marks"),
        preserve_line_breaks=preserve_line_breaks,
    )
    formatted_text = _format_node_text_for_card(
        _html_to_plain_text(rich_text_html or source_node["text"]),
        preserve_line_breaks=preserve_line_breaks,
    )
    data: dict[str, Any] = {
        "uid": uuid.uuid4().hex,
        "text": rich_text_html or _to_rich_text_html(formatted_text),
        "richText": True,
    }
    return {
        "data": data,
        "children": [
            _source_node_to_editor_node(child, preserve_line_breaks=preserve_line_breaks)
            for child in source_node["children"]
        ],
    }


def _clean_inline_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\u3000", " ").split()).strip()


def _clean_multiline_text(value: Any) -> str:
    text = str(value or "").replace("\u3000", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [_clean_inline_text(line) for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _format_node_text_for_card(value: Any, *, preserve_line_breaks: bool) -> str:
    text = _clean_multiline_text(value)
    if not text:
        return ""
    if preserve_line_breaks:
        preserved_lines: list[str] = []
        for line in text.split("\n"):
            preserved_lines.extend(_wrap_node_line(line))
        return "\n".join(part for part in preserved_lines if part).strip()
    wrapped_lines: list[str] = []
    wrapped_lines.extend(_wrap_node_line(_clean_inline_text(text.replace("\n", " "))))
    return "\n".join(part for part in wrapped_lines if part).strip()


def _split_overlong_leaf_node(text: str) -> dict[str, Any] | None:
    normalized_text = _clean_multiline_text(text)
    compact_text = _clean_inline_text(normalized_text.replace("\n", " "))
    heading, body = _split_heading_and_body(compact_text)
    if not heading or not body:
        return None

    items = _extract_parallel_items(body)
    if len(items) < 2:
        return None
    if (
        len(compact_text) < LONG_NODE_SPLIT_THRESHOLD
        and len(items) < 3
        and max(len(item) for item in items) < 24
        and not _is_abstract_heading(heading)
    ):
        return None

    trimmed_items = [_clean_multiline_text(item) for item in items[:MAX_SPLIT_CHILDREN]]
    trimmed_items = [item for item in trimmed_items if item]
    if len(trimmed_items) < 2:
        return None

    return {
        "text": heading,
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": [{"text": item, "children": []} for item in trimmed_items],
    }


def _promote_single_verbose_child(node: dict[str, Any]) -> dict[str, Any] | None:
    children = node.get("children") or []
    if len(children) != 1:
        return None
    only_child = children[0]

    parent_text = _clean_inline_text(node.get("text"))
    child_text = _clean_multiline_text(only_child.get("text"))
    if not parent_text or not child_text:
        return None

    child_children = only_child.get("children") or []
    if child_children:
        child_heading = _clean_inline_text(only_child.get("text"))
        if child_heading == parent_text or _is_abstract_heading(parent_text):
            return {
                "text": parent_text,
                "rich_text_html": None,
                "emphasis_marks": [],
                "children": child_children,
            }
        return None

    split_child = _split_overlong_leaf_node(child_text)
    if split_child and split_child.get("children"):
        return {
            "text": parent_text,
            "rich_text_html": None,
            "emphasis_marks": [],
            "children": split_child["children"],
        }

    direct_items = _extract_parallel_items(child_text)
    direct_items = [_clean_multiline_text(item) for item in direct_items[:MAX_SPLIT_CHILDREN]]
    direct_items = [item for item in direct_items if item]
    if len(direct_items) >= 3:
        return {
            "text": parent_text,
            "rich_text_html": None,
            "emphasis_marks": [],
            "children": [{"text": item, "children": []} for item in direct_items],
        }

    if not _is_abstract_heading(parent_text):
        return None

    body = child_text
    if "：" in child_text or ":" in child_text:
        heading, tail = _split_heading_and_body(child_text)
        if heading and tail:
            if _clean_inline_text(heading) == parent_text:
                body = tail
            elif _is_abstract_heading(heading):
                body = tail
    items = _extract_parallel_items(body)
    trimmed_items = [_clean_multiline_text(item) for item in items[:MAX_SPLIT_CHILDREN]]
    trimmed_items = [item for item in trimmed_items if item]
    if len(trimmed_items) < 2:
        return None
    return {
        "text": parent_text,
        "rich_text_html": None,
        "emphasis_marks": [],
        "children": [{"text": item, "children": []} for item in trimmed_items],
    }


def _wrap_node_line(line: str) -> list[str]:
    text = _clean_inline_text(line)
    if not text:
        return []
    parts: list[str] = []
    remaining = text
    while len(remaining) > NODE_WRAP_WIDTH:
        split_at = _find_wrap_index(remaining)
        parts.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()
    if remaining:
        parts.append(remaining)
    return parts


def _to_rich_text_html(text: str) -> str:
    lines = [_clean_inline_text(line) for line in str(text or "").split("\n")]
    normalized_lines = [line for line in lines if line]
    if not normalized_lines:
        return ""
    return "<div>" + "<br>".join(escape(line) for line in normalized_lines) + "</div>"


def _normalize_rich_text_html(
    value: Any,
    *,
    text: str,
    emphasis_marks: Any,
    preserve_line_breaks: bool,
) -> str:
    raw_html = str(value or "").strip()
    if raw_html:
        return raw_html
    return _apply_emphasis_marks_to_html(text, emphasis_marks, preserve_line_breaks=preserve_line_breaks)


def _apply_emphasis_marks_to_html(text: str, emphasis_marks: Any, *, preserve_line_breaks: bool) -> str:
    normalized_text = _clean_multiline_text(text)
    if not normalized_text:
        return ""
    html = (
        escape(normalized_text).replace("\n", "<br>")
        if preserve_line_breaks
        else escape(_clean_inline_text(normalized_text.replace("\n", " ")))
    )
    if not isinstance(emphasis_marks, list):
        return f"<div>{html}</div>"
    for mark in emphasis_marks:
        if not isinstance(mark, dict):
            continue
        marked_text = _clean_inline_text(mark.get("text"))
        if not marked_text:
            continue
        escaped_marked_text = escape(marked_text)
        if mark.get("kind") == "wavy-underline":
            replacement = (
                "<span style=\"text-decoration-line: underline;"
                " text-decoration-style: wavy; text-decoration-color: currentColor;\">"
                f"{escaped_marked_text}</span>"
            )
        else:
            replacement = f"<u>{escaped_marked_text}</u>"
        html = html.replace(escaped_marked_text, replacement, 1)
    return f"<div>{html}</div>"


def _html_to_plain_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(?:div|p|li|h[1-6]|blockquote|pre|tr)>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


def _split_heading_and_body(text: str) -> tuple[str | None, str | None]:
    normalized = _clean_inline_text(text)
    if not normalized:
        return None, None

    for delimiter in ("：", ":"):
        if delimiter not in normalized:
            continue
        head, tail = normalized.split(delimiter, 1)
        clean_head = _clean_inline_text(head)
        clean_tail = _clean_inline_text(tail)
        if 2 <= len(clean_head) <= 28 and clean_tail:
            return clean_head, clean_tail

    marker_positions = [
        match.start()
        for match in re.finditer(
            r"(?:\d+[.、]|[（(][0-9一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、)",
            normalized,
        )
        if match.start() >= 6
    ]
    if marker_positions:
        first_marker = marker_positions[0]
        head = _clean_inline_text(normalized[:first_marker])
        tail = _clean_inline_text(normalized[first_marker:])
        if 2 <= len(head) <= 28 and tail:
            return head, tail
    return None, None


def _extract_parallel_items(text: str) -> list[str]:
    normalized = _clean_inline_text(text)
    if not normalized:
        return []

    numbered_items = _split_numbered_items(normalized)
    if len(numbered_items) >= 2:
        return numbered_items

    semicolon_items = [_clean_inline_text(item) for item in re.split(r"[；;]", normalized) if item.strip()]
    if len(semicolon_items) >= 2:
        return semicolon_items

    comma_items = _split_comma_series(normalized)
    if len(comma_items) >= 3:
        return comma_items

    sentence_items = [
        _clean_inline_text(item)
        for item in re.split(r"(?<=[。！？!?])", normalized)
        if item.strip()
    ]
    if len(sentence_items) >= 3 and all(len(item) <= 38 for item in sentence_items):
        return sentence_items
    return []


def _split_numbered_items(text: str) -> list[str]:
    marker_pattern = re.compile(
        r"(?:\d+[.、]|[（(][0-9一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、)"
    )
    matches = list(marker_pattern.finditer(text))
    if len(matches) < 2:
        return []

    items: list[str] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        item = _clean_inline_text(text[start:end])
        if item:
            items.append(item)
    return items


def _split_comma_series(text: str) -> list[str]:
    normalized = _clean_inline_text(text)
    if not normalized:
        return []
    if any(marker in normalized for marker in ("。", "；", ";", "！", "？", "?", "!")):
        return []
    parts = [_clean_inline_text(item) for item in re.split(r"[，、]", normalized) if item.strip()]
    if len(parts) < 3:
        return []
    if any(len(item) > 26 for item in parts):
        return []
    return parts


def _is_abstract_heading(text: str) -> bool:
    normalized = _clean_inline_text(text)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in ABSTRACT_SPLIT_HEADINGS)


def _find_wrap_index(text: str) -> int:
    search_end = min(len(text), NODE_WRAP_WIDTH)
    snippet = text[:search_end]
    marker_match = None
    for pattern in (
        r"(?<!^)(?=第[一二三四五六七八九十百千万0-9]+[章节部分课])",
        r"(?<!^)(?=[0-9]+[.、])",
        r"(?<!^)(?=[（(][一二三四五六七八九十百千万0-9]+[)）])",
        r"(?<!^)(?=[一二三四五六七八九十百千万]+、)",
    ):
        candidate = re.search(pattern, snippet)
        if candidate and candidate.start() >= NODE_WRAP_MIN_WIDTH:
            marker_match = candidate.start()
    if marker_match:
        return marker_match

    for punctuation in ("；", "。", "：", "，", "、", ";", ":", ",", "!", "！", "?", "？"):
        index = snippet.rfind(punctuation)
        if index >= NODE_WRAP_MIN_WIDTH:
            return index + 1

    whitespace_index = snippet.rfind(" ")
    if whitespace_index >= NODE_WRAP_MIN_WIDTH:
        return whitespace_index + 1
    return search_end


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
    normalized = _clean_inline_text(_strip_code_fence(value))
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


def _normalize_page_selection(page_selection: list[int], page_count: int) -> list[int]:
    normalized = sorted({int(page) for page in page_selection if int(page) > 0})
    if not normalized:
        raise MindMapImportError("请至少选择一页 PDF。")
    if page_count <= 0:
        raise MindMapImportError("当前 PDF 没有可用页面。")
    if any(page > page_count for page in normalized):
        raise MindMapImportError("存在超出 PDF 总页数的页码，请重新选择。")
    return normalized


def _format_page_numbers(page_numbers: list[int] | None) -> str:
    if not page_numbers:
        return ""
    return "、".join(str(page) for page in page_numbers)


def _extend_prompt_for_pdf(prompt: str, *, page_numbers: list[int] | None, range_prompt: str) -> str:
    next_prompt = prompt
    if page_numbers:
        next_prompt += (
            f"\n\n{PDF_PAGE_CONTEXT_PROMPT}\n"
            f"本次只允许处理这些 PDF 页面：{_format_page_numbers(page_numbers)}。"
        )
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        next_prompt += f"\n用户补充提示：{normalized_range_prompt}"
    return next_prompt


def _ensure_rendered_page_size(rendered_pages: list[tuple[int, bytes, str]]) -> None:
    total_bytes = 0
    for _, image_bytes, _ in rendered_pages:
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise MindMapImportError("存在单页渲染结果过大，请缩小页码范围后重试。")
        total_bytes += len(image_bytes)
    if total_bytes > MAX_IMAGE_BYTES * 6:
        raise MindMapImportError("本次所选 PDF 页面总大小过大，请减少页数后重试。")


def _contains_structure_drift(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    if _clean_inline_text(expected.get("title")) != _clean_inline_text(actual.get("title")):
        return True
    return not _structure_backbone_preserved(
        expected.get("children") or [],
        actual.get("children") or [],
    )


def _structure_backbone_preserved(
    expected_children: list[dict[str, Any]],
    actual_children: list[dict[str, Any]],
) -> bool:
    search_start = 0
    for expected_child in expected_children:
        match_index = _find_matching_child_index(expected_child, actual_children, start=search_start)
        if match_index is None:
            return False
        actual_child = actual_children[match_index]
        if not _structure_backbone_preserved(
            expected_child.get("children") or [],
            actual_child.get("children") or [],
        ):
            return False
        search_start = match_index + 1
    return True


def _build_pdf_structure_prompt(*, strict_restore: bool, preserve_emphasis_marks: bool) -> str:
    lines = [
        "你是一个严格输出 JSON 的 PDF 脑图结构还原助手。",
        "",
        "任务：只读取用户指定的 PDF 结构页，把页面中原本就存在的脑图结构还原成树形结构。",
        "",
        "强制要求：",
        "1. 只输出 JSON，不要输出 markdown，不要输出解释。",
    ]
    if strict_restore:
        lines.extend(
            [
                "2. 必须保留 PDF 自带脑图的原文、原层级、原顺序、原节点粒度。",
                "3. 禁止改写、概括、合并、拆分、重排原始脑图节点。",
                "4. 禁止为了“更像脑图”而缩短文字或提炼标题。",
            ]
        )
    else:
        lines.extend(
            [
                "2. 优先保留原页的章节主干、层级和顺序。",
                "3. 允许在不改变原意的前提下，把过长节点压成更适合脑图的短语。",
            ]
        )
    lines.extend(
        [
            "5. 输出格式必须为：",
            "{",
            '  "title": "根节点标题",',
            '  "children": [',
            "    {",
            '      "text": "节点文字",',
            '      "rich_text_html": "<div>节点文字</div>",',
            '      "emphasis_marks": [],',
            '      "children": []',
            "    }",
            "  ]",
            "}",
            "6. 如果某个节点没有子节点，children 仍然输出空数组。",
        ]
    )
    if preserve_emphasis_marks:
        lines.append("7. 如果原节点带有下划线或波浪线强调，必须在结果里保留强调信息。")
    else:
        lines.append("7. 无需额外保留下划线或波浪线强调，只需正确识别节点文字即可。")
    return "\n".join(lines)


def _build_pdf_batch_prompt(
    *,
    structure_tree: dict[str, Any],
    range_prompt: str,
    page_numbers: list[int] | None,
    strict_restore: bool,
    import_options: PdfImportOptions,
    extracted_text: str | None,
) -> str:
    lines = [
        "你是一个严格输出 JSON 的 PDF 脑图正文补充助手。",
        "",
        "任务：",
        "1. 第一张图片是已经指定的 PDF 结构页，对应的脑图结构 JSON 已给出。",
        "2. 其余图片是正文页。",
        "3. 你需要基于已给定的结构，把正文内容补充到最匹配的原始节点下。",
        "",
        "强制要求：",
        "1. 只输出 JSON，不要输出 markdown，不要输出解释。",
    ]
    if strict_restore:
        lines.append("2. 原 PDF 脑图节点的 text、层级、顺序、粒度都不能变化。")
    else:
        lines.append("2. 优先沿用给定结构主干；如确有必要，可做轻微调整让正文归位更自然。")
    if import_options.mount_on_original_leaf_only:
        lines.append("3. 默认只在最小原始节点下面新增 children；除非叶子节点实在无法承接，否则不要挂到更高层原节点。")
    else:
        lines.append("3. 如果正文无法精确匹配到叶子节点，可以挂到最近的相关原始父节点下。")
    if import_options.quote_original_text_only:
        lines.append("4. 补充内容必须尽量使用原话，不要概括或改写。")
    else:
        lines.append("4. 补充内容可以提炼成更适合脑图展示的短语，但必须忠实原文，不能捏造。")
    if import_options.semantic_split_long_paragraphs:
        lines.append("5. 如果正文本质上包含多个并列要点，请拆成多个并列 children，而不是塞进一个超长节点。")
    else:
        lines.append("5. 不要为了美化结构自动把长段正文拆成多个并列 children，除非原文本身就是明显列举。")
    if import_options.preserve_emphasis_marks:
        lines.append("6. 如果正文中存在下划线或波浪线强调，必须在对应补充节点保留强调信息。")
    else:
        lines.append("6. 无需额外保留下划线或波浪线强调，只需保证正文归位正确。")
    lines.extend(
        [
            "7. 输出格式必须为：",
            "{",
            '  "title": "根节点标题",',
            '  "children": [',
            "    {",
            '      "text": "节点文字",',
            '      "rich_text_html": "<div>节点文字</div>",',
            '      "emphasis_marks": [],',
            '      "children": []',
            "    }",
            "  ]",
            "}",
            "8. 每个节点即使没有子节点，也必须输出 children: []。",
        ]
    )
    if strict_restore:
        lines.append("9. 如果你发现给定结构与结构页明显对不上，不要擅自修正结构；仍按最接近方式输出，并尽量保留原结构不动。")
    lines.extend(
        [
            "",
            PDF_PAGE_CONTEXT_PROMPT,
            "",
            "下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：",
            json.dumps(structure_tree, ensure_ascii=False),
            "",
        ]
    )
    if page_numbers:
        lines.append(f"本次只允许处理这些 PDF 页面：{_format_page_numbers(page_numbers)}。")
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        lines.append(f"用户补充提示：{normalized_range_prompt}")
    if extracted_text:
        lines.extend(
            [
                "",
                "下面是同一批 PDF 页面抽取出的 OCR 正文，请把它当作正文 grounding，优先根据这些文字补全节点，避免只停留在结构骨架上：",
                _truncate_prompt_text(extracted_text),
                "如果 OCR 正文里出现了比结构页更详细的解释、分点或例子，必须把这些新增信息补到对应原始节点下；除非 OCR 正文本身没有新增信息，否则不要只返回原结构骨架。",
                "不要把结构页里已经存在的一级、二级节点原样重抄一遍当作补充结果；你需要继续往下补这些节点对应的正文细节。",
                "如果 OCR 正文已经给出了某个结构节点的下一级或下两级展开，请至少下沉一级后再输出。",
            ]
        )
    lines.extend(
        [
            "",
            "接下来会按顺序提供结构图和正文图片。请综合结构 JSON、OCR 正文和图片内容后输出增强后的完整脑图 JSON。",
        ]
    )
    return "\n".join(lines)


def _truncate_prompt_text(text: str, limit: int = PROMPT_TEXT_MAX_CHARS) -> str:
    normalized = str(text or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}\n\n[后续 OCR 文本已截断]"


def _should_attempt_pdf_ocr_fallback(structure_tree: dict[str, Any], primary_tree: dict[str, Any]) -> bool:
    return _count_enriched_original_leaves(structure_tree, primary_tree) == 0


def _should_prefer_pdf_fallback(
    *,
    structure_tree: dict[str, Any],
    primary_tree: dict[str, Any],
    fallback_tree: dict[str, Any],
    strict_restore: bool,
) -> bool:
    primary_enrichment = _count_enriched_original_leaves(structure_tree, primary_tree)
    fallback_enrichment = _count_enriched_original_leaves(structure_tree, fallback_tree)
    if fallback_enrichment <= primary_enrichment:
        return False
    if not strict_restore:
        return True
    primary_drift = _contains_structure_drift(structure_tree, primary_tree)
    fallback_drift = _contains_structure_drift(structure_tree, fallback_tree)
    primary_preserved, expected_total = _structure_backbone_score(structure_tree, primary_tree)
    fallback_preserved, _ = _structure_backbone_score(structure_tree, fallback_tree)
    primary_ratio = primary_preserved / expected_total if expected_total else 1.0
    fallback_ratio = fallback_preserved / expected_total if expected_total else 1.0
    if fallback_drift and not primary_drift:
        return (
            fallback_ratio >= 0.5
            and fallback_enrichment >= max(1, primary_enrichment + 1)
            and _count_total_nodes(fallback_tree) >= _count_total_nodes(primary_tree) + 2
        )
    if primary_drift and not fallback_drift:
        return True
    if fallback_ratio + 0.05 < primary_ratio:
        return False
    return _count_total_nodes(fallback_tree) >= _count_total_nodes(primary_tree)


def _count_total_nodes(tree: dict[str, Any]) -> int:
    return sum(_count_total_nodes_for_node(child) for child in tree.get("children") or [])


def _count_total_nodes_for_node(node: dict[str, Any]) -> int:
    return 1 + sum(_count_total_nodes_for_node(child) for child in node.get("children") or [])


def _count_enriched_original_leaves(expected: dict[str, Any], actual: dict[str, Any]) -> int:
    return _count_enriched_original_leaves_in_children(
        expected.get("children") or [],
        actual.get("children") or [],
    )


def _count_enriched_original_leaves_in_children(
    expected_children: list[dict[str, Any]],
    actual_children: list[dict[str, Any]],
) -> int:
    count = 0
    search_start = 0
    for expected_child in expected_children:
        match_index = _find_matching_child_index(expected_child, actual_children, start=search_start)
        if match_index is None:
            continue
        actual_child = actual_children[match_index]
        search_start = match_index + 1
        expected_grandchildren = expected_child.get("children") or []
        actual_grandchildren = actual_child.get("children") or []
        if expected_grandchildren:
            count += _count_enriched_original_leaves_in_children(expected_grandchildren, actual_grandchildren)
        elif actual_grandchildren:
            count += 1
    return count


def _structure_backbone_score(expected: dict[str, Any], actual: dict[str, Any]) -> tuple[int, int]:
    expected_children = expected.get("children") or []
    actual_children = actual.get("children") or []
    return (
        _count_preserved_backbone_nodes(expected_children, actual_children),
        _count_expected_nodes_in_children(expected_children),
    )


def _count_preserved_backbone_nodes(
    expected_children: list[dict[str, Any]],
    actual_children: list[dict[str, Any]],
) -> int:
    count = 0
    search_start = 0
    for expected_child in expected_children:
        match_index = _find_matching_child_index(expected_child, actual_children, start=search_start)
        if match_index is None:
            continue
        actual_child = actual_children[match_index]
        search_start = match_index + 1
        count += 1
        count += _count_preserved_backbone_nodes(
            expected_child.get("children") or [],
            actual_child.get("children") or [],
        )
    return count


def _count_expected_nodes_in_children(children: list[dict[str, Any]]) -> int:
    count = 0
    for child in children:
        count += 1
        count += _count_expected_nodes_in_children(child.get("children") or [])
    return count


def _find_matching_child_index(
    expected_child: dict[str, Any],
    actual_children: list[dict[str, Any]],
    *,
    start: int,
) -> int | None:
    expected_text = _clean_inline_text(expected_child.get("text"))
    for index in range(start, len(actual_children)):
        if _clean_inline_text(actual_children[index].get("text")) == expected_text:
            return index
    return None


def _trim_pdf_extracted_text(text: str, *, structure_title: str, range_prompt: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    anchors = _build_pdf_text_anchors(structure_title=structure_title, range_prompt=range_prompt)
    lines = normalized.split("\n")
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if any(anchor in stripped for anchor in anchors):
            trimmed = "\n".join(lines[index:]).strip()
            return trimmed or normalized
    return normalized


def _build_pdf_text_anchors(*, structure_title: str, range_prompt: str) -> list[str]:
    candidates = [range_prompt, structure_title]
    anchors: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        for part in _split_prompt_anchor_parts(candidate):
            if part not in seen:
                seen.add(part)
                anchors.append(part)
    return anchors


def _split_prompt_anchor_parts(value: str) -> list[str]:
    normalized = _clean_inline_text(value)
    if not normalized:
        return []
    parts = [normalized]
    for segment in re.split(r"[，,：:；;。/\\s]+", normalized):
        clean_segment = _clean_inline_text(segment)
        if len(clean_segment) >= 2:
            parts.append(clean_segment)
    return sorted({part for part in parts if len(part) >= 2}, key=len, reverse=True)


def _children_signature(children: list[dict[str, Any]]) -> list[tuple[str, list[Any]]]:
    signature: list[tuple[str, list[Any]]] = []
    for child in children:
        signature.append(
            (
                _clean_inline_text(child.get("text")),
                _children_signature(child.get("children") or []),
            )
        )
    return signature
