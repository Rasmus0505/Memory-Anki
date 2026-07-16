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


_STRUCTURE_SYSTEM_HINTS: dict[str, str] = {
    "auto": (
        "本次结构偏好：自动判断。"
        "纯并列要点输出同级卡片（children 为空数组）；"
        "有分类/时间线/目的-内容等关系时输出父子树。"
    ),
    "parallel": (
        "本次结构偏好：只要并列。"
        "只输出同级卡片，每个节点的 children 必须是空数组 []；"
        "不要创建中间标题层或父子关系。"
    ),
    "hierarchy": (
        "本次结构偏好：可以分层。"
        "允许父子树；中间标题只作组织，事实落在保留原句的叶子节点；"
        "优先最少且必要的层级。"
    ),
    "add_children": (
        "本次任务：AI 添卡（插入中间分类）。"
        "在目标节点与其一级子节点之间新建更少数量的中间分类标题；"
        "用 child_assignments 把每个已有一级子节点整体归到某个 new_children；"
        "不要改写、复制、拆分已有子节点；new_children 数量必须严格少于一级子节点数。"
    ),
    "legacy_children": (
        "本次任务：AI 添卡（插入中间分类）。"
        "在目标节点与其一级子节点之间新建更少数量的中间分类标题；"
        "用 child_assignments 把每个已有一级子节点整体归到某个 new_children；"
        "不要改写、复制、拆分已有子节点；new_children 数量必须严格少于一级子节点数。"
    ),
}


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
    target_card_count: int | None = None,
) -> dict[str, Any]:
    request_url = build_chat_completions_url(config.base_url)
    compiled_prompt = None
    is_add_mode = split_mode in {"add_children", "legacy_children"}
    if split_mode in {"auto", "parallel", "hierarchy"}:
        # Unified composition scene; legacy parallel/hierarchy entrypoints share the same defaults.
        compiled_prompt = prompt_catalog.compose(
            "ai_split",
            selection=_prompt_selection(prompt_options),
        )
        system_prompt = compiled_prompt.text
    else:
        # Critical: do NOT use prompt_catalog.render("ai_prompt_mindmap_ai_split_system").
        # That key is bound to the composition scene `ai_split`, which forces replacement_nodes
        # and makes the model ignore new_children — leading to empty category parse failures.
        from .add_children_prompt import ADD_CHILDREN_SYSTEM_PROMPT

        system_prompt = ADD_CHILDREN_SYSTEM_PROMPT
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    structure_hint = _STRUCTURE_SYSTEM_HINTS.get(split_mode)
    if structure_hint:
        messages.append({"role": "system", "content": structure_hint})
    if target_card_count is not None:
        if is_add_mode:
            count_hint = (
                f"本次数量偏好：中间分类大约 {target_card_count} 张（软目标，可略多略少）；"
                "仍必须严格少于一级子节点数；不要为凑数硬拆；不得改写已有子节点；"
                "只输出 new_children 与 child_assignments。"
            )
        else:
            count_hint = (
                f"本次数量偏好：替换后并排卡片大约 {target_card_count} 张（软目标，可略多略少）；"
                "不要为凑数硬拆/硬并，不得删减原句信息。"
            )
        messages.append({"role": "system", "content": count_hint})
    if is_add_mode and prompt_options:
        run_instruction = prompt_options.get("run_instruction")
        scene_instruction = prompt_options.get("scene_instruction")
        extra_bits: list[str] = []
        if isinstance(scene_instruction, str) and scene_instruction.strip():
            extra_bits.append(f"场景特殊说明：\n{scene_instruction.strip()}")
        if isinstance(run_instruction, str) and run_instruction.strip():
            extra_bits.append(f"本次运行追加要求：\n{run_instruction.strip()}")
        if extra_bits:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "用户附加说明（仍须遵守 new_children/child_assignments 输出协议）：\n"
                        + "\n\n".join(extra_bits)
                    ),
                }
            )
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
        split_mode=split_mode,
        target_card_count=target_card_count,
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
