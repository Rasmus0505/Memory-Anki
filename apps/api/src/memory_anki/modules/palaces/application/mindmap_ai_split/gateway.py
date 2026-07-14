from __future__ import annotations

import json
from typing import Any

from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    build_chat_completions_url,
    call_chat_completion_text,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.platform.application import PromptCatalog, PromptRunSelection

from .contracts import MindMapAiSplitConfig, MindMapAiSplitError
from .primitives import extract_json_object


def _prompt_selection(prompt_options: dict[str, Any] | None) -> PromptRunSelection:
    options = prompt_options or {}
    block_keys = options.get("block_keys")
    return PromptRunSelection(
        block_keys=(
            tuple(str(item) for item in block_keys)
            if isinstance(block_keys, list)
            else None
        ),
        scene_instruction=(
            str(options.get("scene_instruction"))
            if options.get("scene_instruction") is not None
            else None
        ),
        run_instruction=(
            str(options.get("run_instruction"))
            if options.get("run_instruction") is not None
            else None
        ),
    )


def call_model(
    *,
    config: MindMapAiSplitConfig,
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    prompt_catalog: PromptCatalog,
    build_model_input_fn,
    split_mode: str,
    prompt_options: dict[str, Any] | None,
    operation_id: str | None,
) -> dict[str, Any]:
    request_url = build_chat_completions_url(config.base_url)
    compiled_prompt = None
    if split_mode in {"parallel", "hierarchy"}:
        compiled_prompt = prompt_catalog.compose(
            f"ai_split_{split_mode}",
            selection=_prompt_selection(prompt_options),
        )
        system_prompt = compiled_prompt.text
    else:
        system_prompt = prompt_catalog.render("ai_prompt_mindmap_ai_split_system")
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
    model_input["split_mode"] = split_mode
    if operation_id:
        model_input["operation_id"] = operation_id
    messages.append(
        {
            "role": "user",
            "content": json.dumps(model_input, ensure_ascii=False),
        }
    )
    compiled_prompt_payload = (
        {
            "scene_key": compiled_prompt.scene_key,
            "prompt_key": compiled_prompt.prompt_key,
            "block_keys": list(compiled_prompt.block_keys),
            "block_versions": compiled_prompt.block_versions,
            "scene_version_id": compiled_prompt.scene_version_id,
            "warnings": list(compiled_prompt.warnings),
        }
        if compiled_prompt is not None
        else None
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
            "split_mode": split_mode,
            "operation_id": operation_id,
            "compiled_prompt": compiled_prompt_payload,
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
            "split_mode": split_mode,
            "operation_id": operation_id,
            "compiled_prompt": compiled_prompt_payload,
        },
    )
    parsed["_ai_call_log_id"] = log_id
    return parsed
