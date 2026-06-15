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
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from .contracts import MindMapAiSplitConfig, MindMapAiSplitError
from .primitives import extract_json_object


def call_model(
    *,
    config: MindMapAiSplitConfig,
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    build_model_input_fn,
) -> dict[str, Any]:
    request_url = f"{config.base_url.rstrip('/')}/chat/completions"
    system_prompt = render_prompt("ai_prompt_mindmap_ai_split_system", {})
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
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
    model_input = build_model_input_fn(
        target_node=target_node,
        existing_children=existing_children,
        include_note=config.include_note,
        max_children=config.max_children,
    )
    messages.append(
        {
            "role": "user",
            "content": json.dumps(model_input, ensure_ascii=False),
        }
    )
    log_id = begin_external_ai_call_log(
        feature="AI 分卡",
        operation="mindmap_ai_split",
        provider=config.provider,
        base_url=config.base_url,
        model=config.model,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "model_input": model_input,
        },
    )
    try:
        content_text = call_chat_completion_text(
            config=OpenAICompatibleChatConfig(
                api_key=config.api_key,
                base_url=config.base_url,
                model=config.model,
                temperature=(config.temperature if config.supports_temperature else None),
                timeout_seconds=90,
            ),
            messages=messages,
            response_format={"type": "json_object"},
            extra_payload=config.extra_payload,
        )
    except OpenAICompatibleProtocolError as exc:
        fail_external_ai_call_log(
            log_id,
            error_payload={"type": "protocol_error", "message": str(exc)},
        )
        raise MindMapAiSplitError(str(exc)) from exc
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
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "network_error",
                "message": str(exc),
                "reason": exc.reason,
            },
        )
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
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "protocol_error",
                "message": "AI 分卡返回的顶层结果不是对象。",
                "response_text": content_text,
            },
        )
        raise MindMapAiSplitError("AI 分卡返回的顶层结果不是对象。")
    complete_external_ai_call_log(
        log_id,
        response_payload={
            "response_text": content_text,
            "parsed_json": parsed,
        },
    )
    parsed["_ai_call_log_id"] = log_id
    return parsed
