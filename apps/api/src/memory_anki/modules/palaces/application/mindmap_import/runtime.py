from __future__ import annotations

import json
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    build_chat_completions_url,
    extract_chat_completion_stream_delta,
    extract_chat_completion_text_from_body,
    parse_chat_completion_stream,
    stream_chat_completion_text,
)
from memory_anki.infrastructure.llm import (
    extract_message_content_text as extract_openai_compatible_message_content_text,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.platform.application import PromptCatalog

from .contracts import MindMapImportError
from .model_io import (
    MAX_IMAGE_BYTES,
    build_image_content_part,
    normalize_extracted_text,
    parse_source_tree_json,
)
from .normalization import normalize_source_tree


@dataclass(frozen=True, slots=True)
class DashscopeImportRuntime:
    api_key: str
    base_url: str
    model: str
    provider: str = "dashscope"
    temperature: float = 0.1
    timeout_seconds: float = 90.0
    extra_payload: dict[str, Any] | None = None
    prompt_override: str | None = None


def ensure_dashscope_image_ready(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    missing_api_key_message: str,
) -> None:
    if not runtime.api_key:
        raise MindMapImportError(missing_api_key_message)
    if not image_bytes:
        raise MindMapImportError("未读取到图片内容。")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise MindMapImportError("图片过大，请压缩到 8MB 以内后重试。")


def prepare_batch_image_items(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    if not runtime.api_key:
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

    resolved_structure_index = structure_image_index if structure_image_index is not None else None
    if resolved_structure_index is None:
        return normalized_items, None
    if resolved_structure_index < 0 or resolved_structure_index >= len(normalized_items):
        raise MindMapImportError("结构图索引无效，请重新选择结构图后再试。")
    return normalized_items, resolved_structure_index


def call_dashscope_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str | None = None,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_prompt = (
        runtime.prompt_override
        or prompt
        or prompt_catalog.render("ai_prompt_import_image_mindmap")
    )
    content_text = call_dashscope(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        prompt=resolved_prompt,
        response_format={"type": "json_object"},
        external_log_context=external_log_context,
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def call_dashscope_text(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_text_with_images(
        runtime=runtime,
        prompt_catalog=prompt_catalog,
        image_items=[(image_bytes, filename)],
        page_numbers=None,
        range_prompt="",
        external_log_context=external_log_context,
    )


def call_dashscope_text_with_images(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    resolved_prompt = _extend_image_prompt(
        runtime.prompt_override or prompt_catalog.render("ai_prompt_import_image_text"),
        page_numbers=page_numbers,
        range_prompt=range_prompt,
    )
    content_text = call_dashscope(
        runtime=runtime,
        image_bytes=image_items[0][0],
        filename=image_items[0][1],
        prompt=resolved_prompt,
        response_format=None,
        image_items=image_items,
        external_log_context=external_log_context,
    )
    return normalize_extracted_text(content_text)


def call_dashscope_batch_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any] | None,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    prompt = runtime.prompt_override or _build_batch_prompt(
        prompt_catalog=prompt_catalog,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        extracted_text=extracted_text,
    )
    content_text = call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format={"type": "json_object"},
        external_log_context=external_log_context,
    )
    source_tree = parse_source_tree_json(content_text)
    if disable_rebalance:
        return normalize_source_tree(source_tree, disable_rebalance=True)
    return normalize_source_tree(source_tree, disable_rebalance=False)


def stream_call_dashscope_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str | None = None,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, dict[str, Any]]:
    resolved_prompt = (
        runtime.prompt_override
        or prompt
        or prompt_catalog.render("ai_prompt_import_image_mindmap")
    )
    content_text = yield from stream_call_dashscope(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        prompt=resolved_prompt,
        response_format={"type": "json_object"},
        external_log_context=external_log_context,
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def stream_call_dashscope_text(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, str]:
    resolved_prompt = _extend_image_prompt(
        runtime.prompt_override or prompt_catalog.render("ai_prompt_import_image_text"),
        page_numbers=page_numbers,
        range_prompt=range_prompt,
    )
    content_text = yield from stream_call_dashscope(
        runtime=runtime,
        image_bytes=image_items[0][0],
        filename=image_items[0][1],
        prompt=resolved_prompt,
        response_format=None,
        image_items=image_items,
        external_log_context=external_log_context,
    )
    return normalize_extracted_text(content_text)


def stream_call_dashscope_batch_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any] | None,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, dict[str, Any]]:
    prompt = runtime.prompt_override or _build_batch_prompt(
        prompt_catalog=prompt_catalog,
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        extracted_text=extracted_text,
    )
    content_text = yield from stream_call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format={"type": "json_object"},
        external_log_context=external_log_context,
    )
    source_tree = parse_source_tree_json(content_text)
    if disable_rebalance:
        return normalize_source_tree(source_tree, disable_rebalance=True)
    return normalize_source_tree(source_tree, disable_rebalance=False)


def call_dashscope(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
    image_items: list[tuple[bytes, str | None]] | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    return call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items or [(image_bytes, filename)],
        prompt=prompt,
        response_format=response_format,
        external_log_context=external_log_context,
    )


def stream_call_dashscope(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
    image_items: list[tuple[bytes, str | None]] | None = None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, str]:
    return (
        yield from stream_call_dashscope_with_images(
            runtime=runtime,
            image_items=image_items or [(image_bytes, filename)],
            prompt=prompt,
            response_format=response_format,
            external_log_context=external_log_context,
        )
    )


def call_dashscope_with_images(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
    external_log_context: dict[str, Any] | None = None,
) -> str:
    generator = iter_dashscope_with_images_stream(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format=response_format,
        external_log_context=external_log_context,
    )
    while True:
        try:
            next(generator)
        except StopIteration as exc:
            return exc.value


def stream_call_dashscope_with_images(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, str]:
    return (
        yield from iter_dashscope_with_images_stream(
            runtime=runtime,
            image_items=image_items,
            prompt=prompt,
            response_format=response_format,
            external_log_context=external_log_context,
        )
    )


def iter_dashscope_with_images_stream(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, str]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for index, (image_bytes, filename) in enumerate(image_items, start=1):
        content.append({"type": "text", "text": f"第 {index} 张图片："})
        content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    log_context = external_log_context or {}
    raw_stream_metadata = log_context.get("stream_metadata")
    stream_metadata: dict[str, Any] = (
        raw_stream_metadata if isinstance(raw_stream_metadata, dict) else {}
    )
    log_id = begin_external_ai_call_log(
        feature=str(log_context.get("feature") or "外部 AI 调用"),
        operation=str(log_context.get("operation") or "vision_chat_completion"),
        provider=str(log_context.get("provider") or runtime.provider),
        base_url=runtime.base_url,
        model=runtime.model,
        job_id=str(log_context.get("job_id") or "") or None,
        palace_id=int(log_context["palace_id"]) if log_context.get("palace_id") is not None else None,
        artifact_refs=(
            list(log_context.get("artifact_refs") or [])
            if isinstance(log_context.get("artifact_refs"), list)
            else None
        ),
        image_items=image_items,
        request_payload={
            "prompt": prompt,
            "channel": str(log_context.get("channel") or ""),
            "response_format": response_format,
            "messages": [{"role": "user", "content": content}],
        },
    )
    try:
        final_text = yield from stream_chat_completion_text(
            config=OpenAICompatibleChatConfig(
                api_key=runtime.api_key,
                base_url=runtime.base_url,
                model=runtime.model,
                temperature=runtime.temperature,
                timeout_seconds=runtime.timeout_seconds,
            ),
            messages=[
                {
                    "role": "user",
                    "content": content,
                }
            ],
            response_format=response_format,
            extra_payload=runtime.extra_payload,
            stream_metadata=stream_metadata,
        )
        complete_external_ai_call_log(
            log_id,
            response_payload={
                "response_text": final_text,
                "stream_metadata": stream_metadata,
            },
        )
        return final_text
    except OpenAICompatibleProtocolError as exc:
        stream_metadata.update({
            "error_code": exc.code,
            "request_id": exc.request_id or stream_metadata.get("request_id"),
            "last_raw_frame": exc.raw_frame or stream_metadata.get("last_raw_frame"),
            "partial_response": exc.partial_response,
        })
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "protocol_error",
                "message": str(exc),
                "code": exc.code,
                "request_id": exc.request_id,
                "raw_frame": exc.raw_frame,
                "partial_response": exc.partial_response,
                "stream_metadata": stream_metadata,
            },
        )
        raise MindMapImportError(str(exc)) from exc
    except OpenAICompatibleHttpError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "http_error",
                "status_code": exc.status_code,
                "message": str(exc),
                "response_body": exc.response_body,
            },
        )
        detail = exc.response_body.strip()
        if exc.is_auth_error:
            raise MindMapImportError(
                f"百炼接口鉴权失败：HTTP {exc.status_code} {detail}".strip()
            ) from exc
        if exc.is_rate_limited:
            raise MindMapImportError(
                f"百炼接口限流：HTTP {exc.status_code} {detail}".strip()
            ) from exc
        raise MindMapImportError(
            f"百炼接口调用失败：HTTP {exc.status_code} {detail}".strip()
        ) from exc
    except OpenAICompatibleNetworkError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "network_error",
                "message": str(exc),
                "reason": exc.reason,
            },
        )
        if "10061" in exc.reason:
            raise MindMapImportError(
                "百炼接口连接被拒绝："
                f"{exc.reason}。当前目标地址：{build_chat_completions_url(runtime.base_url)}。"
                "请检查 DASHSCOPE_BASE_URL 是否被覆盖成错误地址，"
                "本地代理或网关是否拦截，以及目标主机和端口是否可达。"
            ) from exc
        raise MindMapImportError(
            "百炼接口网络异常："
            f"{exc.reason}。当前目标地址：{build_chat_completions_url(runtime.base_url)}"
        ) from exc


def stream_call_dashscope_formatter_json(
    *,
    prompt_catalog: PromptCatalog,
    runtime: DashscopeImportRuntime,
    extracted_text: str,
    target_title: str,
    external_log_context: dict[str, Any] | None = None,
) -> Generator[str, None, dict[str, Any]]:
    prompt = prompt_catalog.render(
        "ai_prompt_import_ocr_mindmap_format",
        {"target_title": target_title, "ocr_text": extracted_text},
    )
    content_text = yield from stream_call_dashscope_with_images(
        runtime=runtime,
        image_items=[],
        prompt=prompt,
        response_format={"type": "json_object"},
        external_log_context=external_log_context,
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=True)

def parse_dashscope_response_stream(response: Any) -> Generator[str, None, str]:
    try:
        return (
            yield from parse_chat_completion_stream(
                response,
                protocol_error_message="模型返回内容格式异常。",
                empty_response_message="模型返回内容为空。",
            )
        )
    except OpenAICompatibleProtocolError as exc:
        raise MindMapImportError(str(exc)) from exc


def extract_dashscope_stream_delta(payload_text: str) -> str:
    try:
        return extract_chat_completion_stream_delta(
            payload_text,
            protocol_error_message="模型返回内容格式异常。",
        )
    except OpenAICompatibleProtocolError as exc:
        raise MindMapImportError("模型返回内容格式异常。") from exc


def extract_dashscope_text_from_response_body(response_body: str) -> str:
    try:
        return extract_chat_completion_text_from_body(
            response_body,
            protocol_error_message="模型返回内容格式异常。",
            empty_response_message="模型返回内容为空。",
        )
    except OpenAICompatibleProtocolError as exc:
        raise MindMapImportError("模型返回内容格式异常。") from exc


def extract_message_content_text(content: Any) -> str:
    return extract_openai_compatible_message_content_text(content)


def _build_batch_prompt(
    *,
    prompt_catalog: PromptCatalog,
    structure_tree: dict[str, Any] | None,
    range_prompt: str,
    page_numbers: list[int] | None,
    extracted_text: str | None,
) -> str:
    if structure_tree is None:
        prompt = prompt_catalog.render("ai_prompt_import_document_mindmap")
    else:
        prompt = prompt_catalog.render(
            "ai_prompt_import_batch_mindmap",
            {"structure_tree_json": json.dumps(structure_tree, ensure_ascii=False)},
        )
    if extracted_text:
        prompt += f"\n\n已提取的图片文字参考：\n{extracted_text}"
    return _extend_image_prompt(prompt, page_numbers=page_numbers, range_prompt=range_prompt)


def _extend_image_prompt(
    base_prompt: str,
    *,
    page_numbers: list[int] | None,
    range_prompt: str,
) -> str:
    next_prompt = str(base_prompt or "").strip()
    if page_numbers:
        next_prompt += f"\n\n本次只允许处理这些图片序号：{', '.join(str(value) for value in page_numbers)}。"
    normalized_range_prompt = str(range_prompt or "").strip()
    if normalized_range_prompt:
        next_prompt += f"\n用户补充提示：{normalized_range_prompt}"
    return next_prompt
