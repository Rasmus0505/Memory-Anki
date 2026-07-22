from __future__ import annotations

from dataclasses import replace
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
)
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.api import build_review_preview_payload
from memory_anki.modules.mindmap_document.api import normalize_editor_doc
from memory_anki.platform.application import (
    AiRuntimeOptions,
    AiRuntimeProvider,
    PromptCatalog,
    serialize_resolved_ai_runtime,
)

from .mindmap_ai_split import config_loader, gateway, tree_ops
from .mindmap_ai_split import contracts as split_contracts
from .mindmap_ai_split.primitives import ensure_dict

AI_SPLIT_CONFIG_KEYS = split_contracts.AI_SPLIT_CONFIG_KEYS
AI_SPLIT_DEFAULT_MAX_CHILDREN = split_contracts.AI_SPLIT_DEFAULT_MAX_CHILDREN
AI_SPLIT_DEFAULT_TEMPERATURE = split_contracts.AI_SPLIT_DEFAULT_TEMPERATURE
AI_SPLIT_FALLBACK_BUCKET = split_contracts.AI_SPLIT_FALLBACK_BUCKET
AI_SPLIT_MAX_CHILDREN_LIMIT = split_contracts.AI_SPLIT_MAX_CHILDREN_LIMIT
MindMapAiSplitConfig = split_contracts.MindMapAiSplitConfig
MindMapAiSplitError = split_contracts.MindMapAiSplitError
MindMapAiSplitResult = split_contracts.MindMapAiSplitResult


def _normalize_split_mode(split_mode: str) -> str:
    if split_mode in split_contracts.AI_SPLIT_ADD_CHILDREN_ALIASES:
        return split_contracts.AI_SPLIT_ADD_CHILDREN_MODE
    return split_mode


def split_palace_editor_doc_with_ai(
    session: Session,
    palace: Palace,
    editor_doc: Any,
    target_node_uid: str | None,
    *,
    ai_runtime: AiRuntimeProvider,
    prompt_catalog: PromptCatalog,
    ai_options: AiRuntimeOptions | None = None,
    split_mode: str = "legacy_children",
    owner_id: str | None = None,
    operation_id: str | None = None,
    target_card_count: int | None = None,
) -> MindMapAiSplitResult:
    requested_mode = str(split_mode or "legacy_children").strip() or "legacy_children"
    if requested_mode not in {
        *split_contracts.AI_SPLIT_ADD_CHILDREN_ALIASES,
        *split_contracts.AI_SPLIT_REPLACEMENT_MODES,
    }:
        raise MindMapAiSplitError("不支持的 AI 分卡模式。")
    effective_mode = _normalize_split_mode(requested_mode)
    preferred_card_count = tree_ops.normalize_target_card_count(
        target_card_count,
        hard_cap=split_contracts.AI_SPLIT_TARGET_CARD_COUNT_HARD_CAP,
        minimum=1,
    )
    config = resolve_mindmap_ai_split_config(
        session,
        ai_runtime=ai_runtime,
        ai_options=ai_options,
    )
    resolved_runtime = config_loader.resolve_runtime(
        ai_runtime=ai_runtime,
        ai_options=ai_options,
    )
    normalized_doc = normalize_editor_doc(editor_doc, root_text=palace.title, root_kind="palace")
    root = ensure_dict(normalized_doc.get("root"))
    normalized_doc["root"] = root
    target_node = tree_ops.find_target_node(root, target_node_uid)
    if target_node is None:
        raise MindMapAiSplitError("未找到要分卡的目标节点，请重新选中节点后再试。")

    if effective_mode in split_contracts.AI_SPLIT_REPLACEMENT_MODES:
        expected_owner_id = f"palace:{palace.id}"
        if owner_id != expected_owner_id:
            raise MindMapAiSplitError("AI 分卡操作所属宫殿已变化，请重新发起操作。")
        if not operation_id:
            raise MindMapAiSplitError("AI 分卡缺少稳定的操作标识，请重新发起操作。")
        target_node, parent_children, target_index = tree_ops.find_target_location(
            root,
            target_node_uid,
        )
        if target_node is None:
            raise MindMapAiSplitError("未找到要分卡的目标节点，请重新选中节点后再试。")
        if parent_children is None or target_index is None:
            raise MindMapAiSplitError("根节点不能使用替换式 AI 分卡。")
        if tree_ops.collect_first_level_children(target_node):
            raise MindMapAiSplitError("替换式 AI 分卡目前只支持没有子节点的长内容卡片。")
        inferred_max_children = tree_ops.infer_split_max_children(
            target_node,
            [],
            configured_max_children=config.max_children,
        )
        # Soft preference for the model only; do not reject results that exceed it.
        prompt_max_children = tree_ops.resolve_max_top_level_nodes(
            inferred_max=inferred_max_children,
            target_card_count=preferred_card_count,
            hard_cap=split_contracts.AI_SPLIT_MAX_CHILDREN_LIMIT,
        )
        runtime_config = replace(config, max_children=prompt_max_children)
        ai_payload = _call_mindmap_ai_split_model(
            config=runtime_config,
            target_node=target_node,
            existing_children=[],
            prompt_catalog=prompt_catalog,
            split_mode=effective_mode,
            ai_options=ai_options,
            operation_id=operation_id,
            target_card_count=preferred_card_count,
        )
        replacements = tree_ops.normalize_replacement_nodes(
            ai_payload.get("replacement_nodes"),
            split_mode=effective_mode,
            max_top_level_nodes=split_contracts.AI_SPLIT_VALIDATION_MAX_TOP_LEVEL,
            operation_id=operation_id,
        )
        tree_ops.replace_target_at_location(parent_children, target_index, replacements)
        return MindMapAiSplitResult(
            editor_doc=normalized_doc,
            generated_children_count=len(replacements),
            reassigned_existing_children_count=0,
            model=config.model,
            ai_call_log_id=str(ai_payload.get("_ai_call_log_id") or "") or None,
            resolved_ai=serialize_resolved_ai_runtime(resolved_runtime),
            review_preview=build_review_preview_payload(editor_doc=normalized_doc),
            split_mode=effective_mode,
            replacement_node_count=len(replacements),
            replacement_nodes=replacements,
            owner_id=owner_id,
            operation_id=operation_id,
        )

    # AI 添卡：在父卡与一级子卡之间插入中间分类，并重挂已有一级子树。
    expected_owner_id = f"palace:{palace.id}"
    if owner_id is not None and owner_id != expected_owner_id:
        raise MindMapAiSplitError("AI 添卡操作所属宫殿已变化，请重新发起操作。")
    if owner_id is None:
        owner_id = expected_owner_id
    if not operation_id:
        raise MindMapAiSplitError("AI 添卡缺少稳定的操作标识，请重新发起操作。")

    existing_children = tree_ops.collect_first_level_children(target_node)
    existing_count = len(existing_children)
    if existing_count < 2:
        raise MindMapAiSplitError("AI 添卡需要至少 2 个一级子节点。")

    inferred_max_children = tree_ops.infer_split_max_children(
        target_node,
        existing_children,
        configured_max_children=config.max_children,
    )
    max_new_categories = tree_ops.resolve_add_children_max(
        existing_child_count=existing_count,
        inferred_max=inferred_max_children,
        target_card_count=preferred_card_count,
        hard_cap=split_contracts.AI_SPLIT_TARGET_CARD_COUNT_HARD_CAP,
    )
    if max_new_categories < 1:
        raise MindMapAiSplitError("AI 添卡需要至少 2 个一级子节点。")

    runtime_config = replace(config, max_children=max_new_categories)
    ai_payload = _call_mindmap_ai_split_model(
        config=runtime_config,
        target_node=target_node,
        existing_children=existing_children,
        prompt_catalog=prompt_catalog,
        split_mode=effective_mode,
        ai_options=ai_options,
        operation_id=operation_id,
        target_card_count=preferred_card_count,
    )
    generated_children = tree_ops.normalize_generated_children(
        tree_ops.extract_raw_new_children(ai_payload),
        max_children=max_new_categories,
    )
    raw_assignments = ai_payload.get("child_assignments")
    if not generated_children:
        # Model may still return replacement_nodes if it followed the leaf-split composition schema.
        recovered, recovered_assignments = tree_ops.coerce_add_children_from_replacement_nodes(
            ai_payload.get("replacement_nodes"),
            existing_children=existing_children,
            max_children=max_new_categories,
        )
        generated_children = recovered
        if recovered_assignments and not raw_assignments:
            raw_assignments = recovered_assignments
    if not generated_children:
        raise MindMapAiSplitError(
            "AI 没有返回可用的新分类节点（需要 new_children）。"
            "请确认模型输出含中间分类标题；若反复失败，可在「本次运行追加要求」中写明分类名称。"
        )
    if len(generated_children) >= existing_count:
        generated_children = generated_children[: existing_count - 1]
    if not generated_children:
        raise MindMapAiSplitError("AI 返回的中间分类数量无效，请重试。")

    next_children, reassigned_count = tree_ops.build_split_children(
        generated_children=generated_children,
        existing_children=existing_children,
        raw_assignments=raw_assignments,
        fallback_bucket=AI_SPLIT_FALLBACK_BUCKET,
    )
    if not next_children:
        raise MindMapAiSplitError("AI 没有产生可用的添卡结果，请调整提示词后重试。")
    target_node["children"] = next_children
    return MindMapAiSplitResult(
        editor_doc=normalized_doc,
        generated_children_count=len(next_children),
        reassigned_existing_children_count=reassigned_count,
        model=config.model,
        ai_call_log_id=str(ai_payload.get("_ai_call_log_id") or "") or None,
        resolved_ai=serialize_resolved_ai_runtime(resolved_runtime),
        review_preview=build_review_preview_payload(editor_doc=normalized_doc),
        split_mode=effective_mode,
        replacement_node_count=len(next_children),
        replacement_nodes=next_children,
        owner_id=owner_id,
        operation_id=operation_id,
    )


def resolve_mindmap_ai_split_config(
    session: Session,
    *,
    ai_runtime: AiRuntimeProvider,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapAiSplitConfig:
    return config_loader.resolve_config(
        session,
        ai_runtime=ai_runtime,
        ai_options=ai_options,
        legacy_defaults={
            "api_key": DASHSCOPE_API_KEY,
            "base_url": DASHSCOPE_BASE_URL,
            "model": DASHSCOPE_TEXT_MODEL,
        },
    )


def _call_mindmap_ai_split_model(
    *,
    config: MindMapAiSplitConfig,
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    prompt_catalog: PromptCatalog,
    split_mode: str = "add_children",
    ai_options: AiRuntimeOptions | None = None,
    operation_id: str | None = None,
    target_card_count: int | None = None,
) -> dict[str, Any]:
    return gateway.call_model(
        config=config,
        target_node=target_node,
        existing_children=existing_children,
        prompt_catalog=prompt_catalog,
        build_model_input_fn=tree_ops.build_model_input,
        split_mode=split_mode,
        prompt_options=ai_options.prompt_options if ai_options else None,
        operation_id=operation_id,
        target_card_count=target_card_count,
    )
