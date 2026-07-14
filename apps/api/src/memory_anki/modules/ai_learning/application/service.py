from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.ai_learning import AiLearningRun
from memory_anki.infrastructure.llm import OpenAICompatibleChatConfig, call_chat_completion_text
from memory_anki.modules.ai_learning.domain.schemas import AiRunDraft
from memory_anki.platform.application import (
    AiRuntimeOptions,
    AiRuntimeProvider,
    PromptCatalog,
    extract_first_json_object,
    serialize_resolved_ai_runtime,
)

TASK_INSTRUCTIONS = {
    "ask": "请直接回答用户问题。优先依据提供的学习上下文，明确区分上下文事实与推断。",
    "explain": "请像耐心导师一样解释上下文，先给核心结论，再给直观例子和自检问题。",
    "quiz": '请基于上下文生成练习题草稿。只返回 JSON：{"questions":[{"id":"q1","stem":"题目","answer":"答案","analysis":"解析","source_node_uids":["uid"]}]}。不要自动发布题目。',
    "correct": '请检查上下文中的错误、缺口或不清晰表述。只返回 JSON：{"suggestions":[{"id":"s1","type":"modify|add|move|note|verify","node_uid":"uid","original":"原内容","proposed":"建议内容","reason":"理由"}]}。不要声称已修改原文。',
}
DEFAULT_REQUESTS = {
    "ask": "请回答我对这部分内容的疑问。",
    "explain": "请解释这部分内容。",
    "quiz": "请围绕这部分内容出题。",
    "correct": "请检查这部分内容。",
}


def serialize_context(envelope: dict[str, Any]) -> str:
    lines = [f"# {envelope.get('title') or '学习上下文'}", f"范围：{envelope.get('scope')}"]
    for node in envelope.get("nodes") or []:
        indent = "  " * max(0, int(node.get("depth") or 0))
        title = str(node.get("title") or node.get("body") or "未命名节点").strip()
        lines.append(f"{indent}- [{node.get('uid')}] {title}")
        note = str(node.get("note") or "").strip()
        if envelope.get("include_notes") and note:
            lines.append(f"{indent}  笔记：{note}")
        if node.get("learning_state"):
            state = json.dumps(node["learning_state"], ensure_ascii=False, sort_keys=True)
            lines.append(f"{indent}  学习状态：{state}")
    return "\n".join(lines).strip()


def _selection_value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _selection_payload(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return dict(item)
    return item.model_dump()


def preview_run(draft: AiRunDraft, prompt_catalog: PromptCatalog) -> dict[str, Any]:
    context_text = serialize_context(draft.context.model_dump())
    selected_contexts = [
        item
        for item in draft.context_selections
        if _selection_value(item, "enabled", True)
        and str(_selection_value(item, "content", "")).strip()
    ]
    if selected_contexts:
        context_text = "\n\n".join(
            [context_text]
            + [
                f"# 附加上下文：{_selection_value(item, 'label') or _selection_value(item, 'kind')}\n{str(_selection_value(item, 'content', '')).strip()}"
                for item in selected_contexts
            ]
        )
    base_prompt = (
        draft.ai_options.prompt_override.strip()
        if draft.ai_options and draft.ai_options.prompt_override
        else prompt_catalog.render(
            "ai_prompt_ai_learning_workbench",
            {"task_instruction": TASK_INSTRUCTIONS[draft.task_key]},
        )
    )
    task_instruction = TASK_INSTRUCTIONS[draft.task_key]
    system_prompt = (
        base_prompt
        if task_instruction in base_prompt
        else f"{base_prompt}\n\n当前任务要求：{task_instruction}"
    )
    user_prompt = draft.user_prompt.strip() or DEFAULT_REQUESTS[draft.task_key]
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"{context_text}\n\n# 用户要求\n{user_prompt}"},
    ]
    estimated_tokens = max(
        draft.context.estimated_tokens,
        sum(len(item["content"]) for item in messages) // 2,
    )
    warnings = list(draft.context.truncation)
    warnings.extend(
        f"{_selection_value(item, 'label') or _selection_value(item, 'kind')}内容已截断。"
        for item in selected_contexts
        if _selection_value(item, "truncated", False)
    )
    if estimated_tokens > 24000:
        warnings.append("预计上下文较长，请缩小范围或选择长上下文模型。")
    return {
        "system_prompt": system_prompt,
        "context_text": context_text,
        "user_prompt": user_prompt,
        "messages": messages,
        "estimated_tokens": estimated_tokens,
        "warnings": warnings,
    }


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _load(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def serialize_run(row: AiLearningRun) -> dict[str, Any]:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "parent_run_id": row.parent_run_id,
        "retry_of_run_id": row.retry_of_run_id,
        "owner_id": row.owner_id,
        "operation_id": row.operation_id,
        "scenario_key": row.scenario_key,
        "entrypoint_key": row.entrypoint_key,
        "review_session_id": row.review_session_id,
        "palace_id": row.palace_id,
        "task_key": row.task_key,
        "output_type": row.output_type,
        "status": row.status,
        "user_prompt": row.user_prompt,
        "prompt_snapshot": row.prompt_snapshot,
        "context": _load(row.context_json, {}),
        "context_selections": _load(row.context_selections_json, []),
        "request": _load(row.request_json, {}),
        "response_text": row.response_text,
        "result": _load(row.result_json, {}),
        "model_meta": _load(row.model_meta_json, {}),
        "warnings": _load(row.warnings_json, []),
        "error": row.error_text,
        "feedback": row.feedback,
        "application_status": row.application_status,
        "application_result": _load(row.application_result_json, {}),
        "deleted": row.deleted,
        "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def _parse_result(
    task_key: str,
    response_text: str,
    node_uids: list[str],
) -> tuple[dict[str, Any], str | None]:
    if task_key not in {"quiz", "correct"}:
        return {"kind": "text", "text": response_text, "referenced_node_uids": node_uids}, None
    raw_json = extract_first_json_object(response_text)
    if not raw_json:
        return {
            "kind": "text",
            "text": response_text,
            "referenced_node_uids": node_uids,
        }, "AI 未返回可解析的结构化结果，已保留原文。"
    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError:
        return {
            "kind": "text",
            "text": response_text,
            "referenced_node_uids": node_uids,
        }, "AI 返回的 JSON 无法解析，已保留原文。"
    collection_key = "questions" if task_key == "quiz" else "suggestions"
    items = payload.get(collection_key)
    if not isinstance(items, list):
        return {
            "kind": "text",
            "text": response_text,
            "referenced_node_uids": node_uids,
        }, "AI 结构化结果缺少项目列表，已保留原文。"
    normalized = [
        {**item, "id": str(item.get("id") or f"{task_key}-{index}"), "decision": "pending"}
        for index, item in enumerate(items, start=1)
        if isinstance(item, dict)
    ]
    return {
        "kind": "quiz_draft" if task_key == "quiz" else "change_suggestions",
        collection_key: normalized,
        "text": response_text,
        "referenced_node_uids": node_uids,
    }, None


def execute_run(
    session: Session,
    draft: AiRunDraft,
    runtime_provider: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
) -> dict[str, Any]:
    existing = session.query(AiLearningRun).filter_by(operation_id=draft.operation_id).one_or_none()
    if existing is not None:
        return serialize_run(existing)
    preview = preview_run(draft, prompt_catalog)
    row = AiLearningRun(
        id=str(uuid.uuid4()),
        thread_id=draft.thread_id or str(uuid.uuid4()),
        parent_run_id=draft.parent_run_id,
        retry_of_run_id=draft.retry_of_run_id,
        owner_id=draft.owner_id,
        operation_id=draft.operation_id,
        scenario_key=draft.scenario_key,
        entrypoint_key=draft.entrypoint_key,
        review_session_id=draft.review_session_id,
        palace_id=draft.palace_id,
        task_key=draft.task_key,
        output_type=draft.output_type,
        status="running",
        user_prompt=preview["user_prompt"],
        prompt_snapshot=preview["system_prompt"],
        context_json=_json(draft.context.model_dump()),
        context_selections_json=_json(
            [_selection_payload(item) for item in draft.context_selections]
        ),
        request_json=_json(
            {
                "messages": preview["messages"],
                "estimated_tokens": preview["estimated_tokens"],
                "ai_options": draft.ai_options.model_dump() if draft.ai_options else None,
            }
        ),
        warnings_json=_json(preview["warnings"]),
    )
    session.add(row)
    session.commit()
    try:
        normalized = runtime_provider.normalize_options(
            draft.ai_options.model_dump() if draft.ai_options else None
        )
        runtime = runtime_provider.resolve(
            draft.scenario_key,
            options=AiRuntimeOptions(
                model=normalized.model,
                thinking_enabled=normalized.thinking_enabled,
                prompt_override=normalized.prompt_override,
                prompt_options=normalized.prompt_options,
            ),
        )
        row.model_meta_json = _json(serialize_resolved_ai_runtime(runtime))
        extra_payload = dict(runtime.extra_payload or {})
        if runtime.thinking_enabled:
            extra_payload["enable_thinking"] = True
        row.response_text = call_chat_completion_text(
            config=OpenAICompatibleChatConfig(
                api_key=runtime.api_key,
                base_url=runtime.base_url,
                model=runtime.model,
                temperature=0.2 if runtime.supports_temperature else None,
            ),
            messages=preview["messages"],
            extra_payload=extra_payload or None,
        )
        parsed_result, parse_warning = _parse_result(
            draft.task_key, row.response_text, draft.context.node_uids
        )
        row.result_json = _json(parsed_result)
        if parse_warning:
            row.warnings_json = _json([*preview["warnings"], parse_warning])
        row.status = "completed"
    except Exception as exc:
        row.status = "failed"
        row.error_text = str(exc)
    row.completed_at = utc_now_naive()
    session.commit()
    return serialize_run(row)


def list_runs(
    session: Session,
    *,
    review_session_id: int | None = None,
    palace_id: int | None = None,
    thread_id: str | None = None,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    query = session.query(AiLearningRun)
    if not include_deleted:
        query = query.filter(AiLearningRun.deleted.is_(False))
    if review_session_id is not None:
        query = query.filter(AiLearningRun.review_session_id == review_session_id)
    if palace_id is not None:
        query = query.filter(AiLearningRun.palace_id == palace_id)
    if thread_id:
        query = query.filter(AiLearningRun.thread_id == thread_id)
    return [serialize_run(row) for row in query.order_by(AiLearningRun.created_at.asc()).limit(200)]


def _get_run(session: Session, run_id: str) -> AiLearningRun:
    row = session.get(AiLearningRun, run_id)
    if row is None:
        raise ValueError("AI 运行记录不存在。")
    return row


def set_feedback(session: Session, run_id: str, feedback: str) -> dict[str, Any]:
    row = _get_run(session, run_id)
    row.feedback = feedback
    session.commit()
    return serialize_run(row)


def set_application_status(
    session: Session,
    run_id: str,
    status: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    row = _get_run(session, run_id)
    if row.status != "completed":
        raise ValueError("只有已完成的 AI 结果可以接受或应用。")
    row.application_status = status
    row.application_result_json = _json(result)
    session.commit()
    return serialize_run(row)


def set_deleted(session: Session, run_id: str, deleted: bool) -> dict[str, Any]:
    row = _get_run(session, run_id)
    row.deleted = deleted
    row.deleted_at = utc_now_naive() if deleted else None
    session.commit()
    return serialize_run(row)


def purge_run(session: Session, run_id: str) -> None:
    row = _get_run(session, run_id)
    if not row.deleted:
        raise ValueError("请先将 AI 运行记录移入回收站。")
    session.delete(row)
    session.commit()


def set_item_decision(session: Session, run_id: str, item_id: str, decision: str) -> dict[str, Any]:
    row = session.get(AiLearningRun, run_id)
    if row is None:
        raise ValueError("AI 学习记录不存在。")
    result = _load(row.result_json, {})
    collection_key = "questions" if isinstance(result.get("questions"), list) else "suggestions"
    items = result.get(collection_key)
    if not isinstance(items, list):
        raise ValueError("当前 AI 结果没有可审核项目。")
    matched = False
    for item in items:
        if isinstance(item, dict) and str(item.get("id")) == item_id:
            item["decision"] = decision
            matched = True
            break
    if not matched:
        raise ValueError("AI 结果项目不存在。")
    row.result_json = _json(result)
    session.commit()
    return serialize_run(row)
