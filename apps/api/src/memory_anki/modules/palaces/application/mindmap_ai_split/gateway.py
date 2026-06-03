from __future__ import annotations

import json
from typing import Any

from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
)

from .contracts import AI_SPLIT_SYSTEM_PROMPT, MindMapAiSplitConfig, MindMapAiSplitError
from .primitives import extract_json_object


def call_model(
    *,
    config: MindMapAiSplitConfig,
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    build_model_input_fn,
) -> dict[str, Any]:
    request_url = f"{config.base_url.rstrip('/')}/chat/completions"
    messages: list[dict[str, str]] = [{"role": "system", "content": AI_SPLIT_SYSTEM_PROMPT}]
    if config.custom_instruction:
        messages.append(
            {
                "role": "system",
                "content": (
                    "用户自定义附加说明（仍需完全遵守上一条系统约束）：\n"
                    f"{config.custom_instruction}"
                ),
            }
        )
    messages.append(
        {
            "role": "user",
            "content": json.dumps(
                build_model_input_fn(
                    target_node=target_node,
                    existing_children=existing_children,
                    include_note=config.include_note,
                    max_children=config.max_children,
                ),
                ensure_ascii=False,
            ),
        }
    )
    try:
        content_text = call_chat_completion_text(
            config=OpenAICompatibleChatConfig(
                api_key=config.api_key,
                base_url=config.base_url,
                model=config.model,
                temperature=config.temperature,
                timeout_seconds=90,
            ),
            messages=messages,
            response_format={"type": "json_object"},
        )
    except OpenAICompatibleProtocolError as exc:
        raise MindMapAiSplitError(str(exc)) from exc
    except OpenAICompatibleHttpError as exc:
        detail = exc.response_body.strip()
        if exc.is_auth_error:
            raise MindMapAiSplitError(
                f"AI 分卡接口鉴权失败：HTTP {exc.status_code} {detail}".strip()
            ) from exc
        if exc.is_rate_limited:
            raise MindMapAiSplitError(
                f"AI 分卡接口限流：HTTP {exc.status_code} {detail}".strip()
            ) from exc
        raise MindMapAiSplitError(
            f"AI 分卡接口调用失败：HTTP {exc.status_code} {detail}".strip()
        ) from exc
    except OpenAICompatibleNetworkError as exc:
        if "10061" in exc.reason:
            raise MindMapAiSplitError(
                "AI 分卡接口连接被拒绝："
                f"{exc.reason}。当前目标地址：{request_url}。"
                "请检查 base_url 是否正确，以及本地代理或网关是否拦截。"
            ) from exc
        raise MindMapAiSplitError(
            f"AI 分卡接口网络异常：{exc.reason}。当前目标地址：{request_url}"
        ) from exc

    parsed = extract_json_object(content_text)
    if not isinstance(parsed, dict):
        raise MindMapAiSplitError("AI 分卡返回的顶层结果不是对象。")
    return parsed
