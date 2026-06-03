from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Generator

from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    build_chat_completions_url,
    extract_chat_completion_stream_delta,
    extract_chat_completion_text_from_body,
    extract_message_content_text as extract_openai_compatible_message_content_text,
    parse_chat_completion_stream,
    stream_chat_completion_text,
)

from .contracts import MindMapImportError, PdfImportOptions
from .normalization import (
    MAX_IMAGE_BYTES,
    build_image_content_part,
    normalize_extracted_text,
    normalize_source_tree,
    parse_source_tree_json,
)
from .prompts import (
    BATCH_PROMPT,
    PROMPT,
    TEXT_PROMPT,
    build_pdf_batch_prompt,
    build_pdf_direct_prompt,
    extend_prompt_for_pdf,
)


@dataclass(frozen=True, slots=True)
class DashscopeImportRuntime:
    api_key: str
    base_url: str
    model: str
    temperature: float = 0.1
    timeout_seconds: float = 90.0


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
) -> tuple[list[tuple[bytes, str | None]], int]:
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

    resolved_structure_index = structure_image_index if structure_image_index is not None else 0
    if resolved_structure_index < 0 or resolved_structure_index >= len(normalized_items):
        raise MindMapImportError("结构图索引无效，请重新选择结构图后再试。")
    return normalized_items, resolved_structure_index


def call_dashscope_json(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
) -> dict[str, Any]:
    content_text = call_dashscope(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def call_dashscope_text(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
) -> str:
    return call_dashscope_text_with_images(
        runtime=runtime,
        image_items=[(image_bytes, filename)],
        page_numbers=None,
        range_prompt="",
    )


def call_dashscope_text_with_images(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
) -> str:
    content_text = call_dashscope(
        runtime=runtime,
        image_bytes=image_items[0][0],
        filename=image_items[0][1],
        prompt=extend_prompt_for_pdf(
            TEXT_PROMPT,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
        ),
        response_format=None,
        image_items=image_items,
    )
    return normalize_extracted_text(content_text)


def call_dashscope_batch_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    prompt = _build_batch_prompt(
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        import_options=import_options,
        extracted_text=extracted_text,
    )
    content_text = call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def call_dashscope_pdf_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> dict[str, Any]:
    content_text = call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=build_pdf_direct_prompt(
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            import_options=import_options or PdfImportOptions(),
            extracted_text=extracted_text,
        ),
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def stream_call_dashscope_json(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
) -> Generator[str, None, dict[str, Any]]:
    content_text = yield from stream_call_dashscope(
        runtime=runtime,
        image_bytes=image_bytes,
        filename=filename,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def stream_call_dashscope_text(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
) -> Generator[str, None, str]:
    content_text = yield from stream_call_dashscope(
        runtime=runtime,
        image_bytes=image_items[0][0],
        filename=image_items[0][1],
        prompt=extend_prompt_for_pdf(
            TEXT_PROMPT,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
        ),
        response_format=None,
        image_items=image_items,
    )
    return normalize_extracted_text(content_text)


def stream_call_dashscope_batch_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> Generator[str, None, dict[str, Any]]:
    prompt = _build_batch_prompt(
        structure_tree=structure_tree,
        range_prompt=range_prompt,
        page_numbers=page_numbers,
        import_options=import_options,
        extracted_text=extracted_text,
    )
    content_text = yield from stream_call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def stream_call_dashscope_pdf_json(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
) -> Generator[str, None, dict[str, Any]]:
    content_text = yield from stream_call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items,
        prompt=build_pdf_direct_prompt(
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            import_options=import_options or PdfImportOptions(),
            extracted_text=extracted_text,
        ),
        response_format={"type": "json_object"},
    )
    source_tree = parse_source_tree_json(content_text)
    return normalize_source_tree(source_tree, disable_rebalance=disable_rebalance)


def call_dashscope(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> str:
    return call_dashscope_with_images(
        runtime=runtime,
        image_items=image_items or [(image_bytes, filename)],
        prompt=prompt,
        response_format=response_format,
    )


def stream_call_dashscope(
    *,
    runtime: DashscopeImportRuntime,
    image_bytes: bytes,
    filename: str | None,
    prompt: str,
    response_format: dict[str, Any] | None,
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> Generator[str, None, str]:
    return (
        yield from stream_call_dashscope_with_images(
            runtime=runtime,
            image_items=image_items or [(image_bytes, filename)],
            prompt=prompt,
            response_format=response_format,
        )
    )


def call_dashscope_with_images(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
) -> str:
    generator = iter_dashscope_with_images_stream(
        runtime=runtime,
        image_items=image_items,
        prompt=prompt,
        response_format=response_format,
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
) -> Generator[str, None, str]:
    return (
        yield from iter_dashscope_with_images_stream(
            runtime=runtime,
            image_items=image_items,
            prompt=prompt,
            response_format=response_format,
        )
    )


def iter_dashscope_with_images_stream(
    *,
    runtime: DashscopeImportRuntime,
    image_items: list[tuple[bytes, str | None]],
    prompt: str,
    response_format: dict[str, Any] | None,
) -> Generator[str, None, str]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for index, (image_bytes, filename) in enumerate(image_items, start=1):
        content.append({"type": "text", "text": f"第 {index} 张图片："})
        content.append(build_image_content_part(image_bytes=image_bytes, filename=filename))
    try:
        return (
            yield from stream_chat_completion_text(
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
            )
        )
    except OpenAICompatibleProtocolError as exc:
        raise MindMapImportError(str(exc)) from exc
    except OpenAICompatibleHttpError as exc:
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
    structure_tree: dict[str, Any],
    range_prompt: str,
    page_numbers: list[int] | None,
    import_options: PdfImportOptions | None,
    extracted_text: str | None,
) -> str:
    if page_numbers is not None or import_options is not None or extracted_text:
        return build_pdf_batch_prompt(
            structure_tree=structure_tree,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            import_options=import_options or PdfImportOptions(),
            extracted_text=extracted_text,
        )
    return (
        f"{BATCH_PROMPT}\n\n"
        f"下面是已经从结构图中提取出的原始脑图 JSON，请以它为主结构进行增强：\n"
        f"{json.dumps(structure_tree, ensure_ascii=False)}\n\n"
        "接下来会按顺序提供结构图和正文图片。请综合所有图片后输出增强后的完整脑图 JSON。"
    )
