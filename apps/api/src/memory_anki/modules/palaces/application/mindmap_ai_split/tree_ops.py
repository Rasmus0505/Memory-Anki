from __future__ import annotations

import copy
from typing import Any, TypedDict
from uuid import NAMESPACE_URL, uuid4, uuid5

from .contracts import (
    AI_SPLIT_DEFAULT_MAX_DEPTH,
    AI_SPLIT_MAX_TOTAL_NODES,
    MindMapAiSplitError,
)
from .primitives import ensure_dict, first_non_empty, plain_identifier, plain_text, stringify


class _SplitBucket(TypedDict):
    node: dict[str, Any]
    generated: dict[str, str]


def infer_split_max_children(
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    *,
    configured_max_children: int,
) -> int:
    cap = max(1, configured_max_children)
    child_count = len(existing_children)
    if child_count > 0:
        if child_count <= 3:
            inferred = 2
        elif child_count <= 6:
            inferred = 3
        elif child_count <= 10:
            inferred = 4
        elif child_count <= 16:
            inferred = 5
        elif child_count <= 24:
            inferred = 6
        else:
            inferred = 8
        return min(cap, inferred)

    data = ensure_dict(target_node.get("data"))
    text_size = len(plain_text(data.get("text"), fallback="")) + len(
        plain_text(data.get("note"), fallback="")
    )
    if text_size <= 80:
        inferred = 2
    elif text_size <= 200:
        inferred = 3
    else:
        inferred = 4
    return min(cap, inferred)


def normalize_target_card_count(value: Any, *, hard_cap: int = 12) -> int | None:
    """Soft target for sibling card count after replace. None = auto."""
    if value is None or value == "":
        return None
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    if count < 2:
        return 2
    if count > hard_cap:
        return hard_cap
    return count


def resolve_max_top_level_nodes(
    *,
    inferred_max: int,
    target_card_count: int | None,
    hard_cap: int = 12,
) -> int:
    """Hard safety cap for validation; soft target may be lower."""
    cap = max(1, hard_cap)
    base = max(1, inferred_max)
    if target_card_count is None:
        return min(cap, base)
    # Headroom above soft target so the model is not forced to exact N.
    return min(cap, max(base, target_card_count, target_card_count + 2))


def build_model_input(
    *,
    target_node: dict[str, Any],
    existing_children: list[dict[str, Any]],
    include_note: bool,
    max_children: int,
    split_mode: str = "legacy_children",
    target_card_count: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "task": "split_mindmap_node",
        "max_children": max_children,
        "target_node": serialize_prompt_node(
            target_node,
            include_note=include_note,
            source_ref=None,
        ),
        "existing_first_level_children": [
            serialize_prompt_node(
                child["node"],
                include_note=include_note,
                source_ref=child["source_ref"],
            )
            for child in existing_children
        ],
    }
    if split_mode in {"auto", "parallel", "hierarchy"}:
        payload["structure_preference"] = {
            "auto": "根据内容自行判断：纯并列要点用同级卡片；有分类/时间线/目的-内容关系时用父子树。",
            "parallel": "只要并列：只输出同级卡片，每个节点的 children 必须是空数组 []，不要创建父子。",
            "hierarchy": "可以分层：允许父子树；中间标题只作组织，事实落在保留原句的叶子上；优先最少必要层级。",
        }.get(split_mode, "")
    if target_card_count is not None:
        payload["prefer_about_n_sibling_cards"] = target_card_count
        payload["card_count_guidance"] = (
            f"替换原长卡后，并排出现的卡片（第一层）大约 {target_card_count} 张；"
            "这是软目标，可按内容略多或略少，不要为凑数硬拆或硬并，也不得删减原句信息。"
        )
    return payload


def collect_first_level_children(target_node: dict[str, Any]) -> list[dict[str, Any]]:
    children = target_node.get("children")
    if not isinstance(children, list):
        children = []
        target_node["children"] = children

    items: list[dict[str, Any]] = []
    for index, child in enumerate(children, start=1):
        if not isinstance(child, dict):
            continue
        data = ensure_dict(child.get("data"))
        uid = stringify(data.get("uid")).strip() or None
        memory_anki_id = data.get("memoryAnkiId")
        if memory_anki_id not in (None, ""):
            source_ref = f"id:{memory_anki_id}"
        elif uid:
            source_ref = f"uid:{uid}"
        else:
            source_ref = f"child:{index}"
        items.append(
            {
                "source_ref": source_ref,
                "uid": uid,
                "node": copy.deepcopy(child),
            }
        )
    return items


def serialize_prompt_node(
    node: dict[str, Any],
    *,
    include_note: bool,
    source_ref: str | None,
) -> dict[str, Any]:
    data = ensure_dict(node.get("data"))
    payload: dict[str, Any] = {
        "text": plain_text(data.get("text"), fallback="未命名节点"),
        "children": [],
    }
    if source_ref:
        payload["source_ref"] = source_ref
    uid = stringify(data.get("uid")).strip()
    if uid:
        payload["uid"] = uid
    node_type = stringify(data.get("memoryAnkiNodeType")).strip()
    if node_type:
        payload["node_type"] = node_type
    if include_note:
        note = plain_text(data.get("note"), fallback="")
        if note:
            payload["note"] = note
    raw_children = node.get("children")
    if isinstance(raw_children, list):
        payload["children"] = [
            serialize_prompt_node(child, include_note=include_note, source_ref=None)
            for child in raw_children
            if isinstance(child, dict)
        ]
    return payload


def normalize_generated_children(raw_value: Any, *, max_children: int) -> list[dict[str, str]]:
    if not isinstance(raw_value, list):
        return []
    generated: list[dict[str, str]] = []
    seen_texts: set[str] = set()
    seen_ids: set[str] = set()
    for item in raw_value:
        if len(generated) >= max_children:
            break
        if isinstance(item, str):
            text = item.strip()
            child_id = ""
        elif isinstance(item, dict):
            text = first_non_empty(
                item.get("text"),
                item.get("title"),
                item.get("name"),
                item.get("label"),
            )
            child_id = first_non_empty(item.get("id"), item.get("key"), item.get("code"))
        else:
            continue
        text = plain_text(text, fallback="").strip()
        if not text:
            continue
        normalized_text = text.casefold()
        if normalized_text in seen_texts:
            continue
        next_id = plain_identifier(child_id or f"category_{len(generated) + 1}")
        if not next_id:
            next_id = f"category_{len(generated) + 1}"
        while next_id in seen_ids:
            next_id = f"{next_id}_{len(seen_ids) + 1}"
        seen_ids.add(next_id)
        seen_texts.add(normalized_text)
        generated.append({"id": next_id, "text": text})
    return generated


def build_split_children(
    *,
    generated_children: list[dict[str, str]],
    existing_children: list[dict[str, Any]],
    raw_assignments: Any,
    fallback_bucket: str,
) -> tuple[list[dict[str, Any]], int]:
    bucket_lookup: dict[str, _SplitBucket] = {
        child["id"]: {
            "node": {
                "data": {
                    "text": child["text"],
                    "note": "",
                    "uid": f"ai-split-{uuid4().hex}",
                },
                "children": [],
            },
            "generated": child,
        }
        for child in generated_children
    }
    assigned_refs: set[str] = set()
    existing_lookup = {child["source_ref"]: child for child in existing_children}
    bucket_text_lookup = {
        child["text"].casefold(): child["id"]
        for child in generated_children
        if child.get("text")
    }
    normalized_assignments = normalize_assignments(raw_assignments)
    for assignment in normalized_assignments:
        source_ref = resolve_existing_source_ref(existing_lookup, assignment["source_ref"])
        target_new_child_id = assignment["target_new_child_id"]
        if source_ref in assigned_refs:
            continue
        child = existing_lookup.get(source_ref)
        bucket = bucket_lookup.get(target_new_child_id)
        if bucket is None:
            bucket = bucket_lookup.get(bucket_text_lookup.get(target_new_child_id.casefold(), ""))
        if child is None or bucket is None:
            continue
        bucket["node"]["children"].append(copy.deepcopy(child["node"]))
        assigned_refs.add(source_ref)

    unassigned = [
        child
        for child in existing_children
        if child["source_ref"] not in assigned_refs
    ]
    if unassigned:
        fallback_node = {
            "data": {
                "text": fallback_bucket,
                "note": "",
                "uid": f"ai-split-{uuid4().hex}",
            },
            "children": [copy.deepcopy(child["node"]) for child in unassigned],
        }
        bucket_lookup[f"fallback-{uuid4().hex}"] = {
            "node": fallback_node,
            "generated": {"id": "fallback", "text": fallback_bucket},
        }

    next_children = [payload["node"] for payload in bucket_lookup.values()]
    return next_children, len(existing_children)


def resolve_existing_source_ref(
    existing_lookup: dict[str, dict[str, Any]],
    source_ref: str,
) -> str:
    if source_ref in existing_lookup:
        return source_ref
    if ":" not in source_ref:
        uid_key = f"uid:{source_ref}"
        if uid_key in existing_lookup:
            return uid_key
        id_key = f"id:{source_ref}"
        if id_key in existing_lookup:
            return id_key
    return source_ref


def normalize_assignments(raw_value: Any) -> list[dict[str, str]]:
    if isinstance(raw_value, dict):
        items = [
            {"source_ref": key, "target_new_child_id": value}
            for key, value in raw_value.items()
        ]
    elif isinstance(raw_value, list):
        items = raw_value
    else:
        items = []

    normalized: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        source_ref = first_non_empty(
            item.get("source_ref"),
            item.get("existing_child_ref"),
            item.get("uid"),
            item.get("existing_child_uid"),
        )
        target_new_child_id = first_non_empty(
            item.get("target_new_child_id"),
            item.get("new_child_id"),
            item.get("bucket_id"),
            item.get("target"),
        )
        source_ref = stringify(source_ref).strip()
        raw_target_value = stringify(target_new_child_id).strip()
        target_new_child_id = plain_identifier(raw_target_value) or raw_target_value
        if not source_ref or not target_new_child_id:
            continue
        normalized.append(
            {
                "source_ref": source_ref,
                "target_new_child_id": target_new_child_id,
            }
        )
    return normalized


def find_target_node(root: dict[str, Any], target_node_uid: str | None) -> dict[str, Any] | None:
    if target_node_uid in (None, ""):
        return root
    stack = [root]
    while stack:
        node = stack.pop()
        data = ensure_dict(node.get("data"))
        if stringify(data.get("uid")).strip() == target_node_uid:
            return node
        children = node.get("children")
        if isinstance(children, list):
            for child in reversed(children):
                if isinstance(child, dict):
                    stack.append(child)
    return None


def find_target_location(
    root: dict[str, Any],
    target_node_uid: str | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]] | None, int | None]:
    """返回目标节点、父级 children 列表和原始索引；根节点没有可替换位置。"""
    if target_node_uid in (None, ""):
        return root, None, None
    stack: list[dict[str, Any]] = [root]
    while stack:
        parent = stack.pop()
        children = parent.get("children")
        if not isinstance(children, list):
            continue
        for index, child in enumerate(children):
            if not isinstance(child, dict):
                continue
            data = ensure_dict(child.get("data"))
            if stringify(data.get("uid")).strip() == target_node_uid:
                return child, children, index
            stack.append(child)
    return None, None, None


def flatten_replacement_nodes_for_parallel(raw_value: Any) -> list[dict[str, Any]]:
    """Promote nested nodes to a single sibling list for parallel mode."""
    if not isinstance(raw_value, list):
        return []
    flat: list[dict[str, Any]] = []

    def walk(nodes: list[Any]) -> None:
        for value in nodes:
            if not isinstance(value, dict):
                continue
            raw_children = value.get("children")
            children = raw_children if isinstance(raw_children, list) else []
            text = plain_text(
                first_non_empty(value.get("text"), value.get("title"), value.get("name")),
                fallback="",
            ).strip()
            if text:
                next_node = dict(value)
                next_node["children"] = []
                flat.append(next_node)
            if children:
                walk(children)

    walk(raw_value)
    return flat


def normalize_replacement_nodes(
    raw_value: Any,
    *,
    split_mode: str,
    max_top_level_nodes: int,
    operation_id: str,
    max_depth: int = AI_SPLIT_DEFAULT_MAX_DEPTH,
    max_total_nodes: int = AI_SPLIT_MAX_TOTAL_NODES,
) -> list[dict[str, Any]]:
    if split_mode not in {"auto", "parallel", "hierarchy"}:
        raise MindMapAiSplitError(f"不支持的 AI 分卡模式：{split_mode}")
    if not isinstance(raw_value, list):
        return []
    working = (
        flatten_replacement_nodes_for_parallel(raw_value)
        if split_mode == "parallel"
        else raw_value
    )
    # Parallel flatten may expand nested model output; allow up to the safety hard cap.
    effective_max_top = (
        max(max_top_level_nodes, min(12, max_total_nodes))
        if split_mode == "parallel"
        else max_top_level_nodes
    )
    if len(working) > effective_max_top:
        raise MindMapAiSplitError(f"AI 分卡顶层节点超过限制（最多 {effective_max_top} 个）。")
    total_nodes = 0

    def normalize_node(value: Any, path: tuple[int, ...], depth: int) -> dict[str, Any]:
        nonlocal total_nodes
        if not isinstance(value, dict):
            raise MindMapAiSplitError("AI 分卡返回了无效的节点对象。")
        if depth > max_depth:
            raise MindMapAiSplitError(f"AI 分卡层级超过限制（最多 {max_depth} 层）。")
        text = plain_text(
            first_non_empty(value.get("text"), value.get("title"), value.get("name")),
            fallback="",
        ).strip()
        if not text:
            raise MindMapAiSplitError("AI 分卡返回了空标题节点。")
        raw_children = value.get("children")
        children_values = raw_children if isinstance(raw_children, list) else []
        if split_mode == "parallel":
            children_values = []
        total_nodes += 1
        if total_nodes > max_total_nodes:
            raise MindMapAiSplitError(f"AI 分卡节点总数超过限制（最多 {max_total_nodes} 个）。")
        uid_seed = f"memory-anki:ai-split:{operation_id}:{'.'.join(map(str, path))}"
        return {
            "data": {
                "text": text,
                "note": plain_text(value.get("note"), fallback="").strip(),
                "uid": f"ai-split-{uuid5(NAMESPACE_URL, uid_seed).hex}",
            },
            "children": [
                normalize_node(child, (*path, index), depth + 1)
                for index, child in enumerate(children_values)
            ],
        }

    normalized = [normalize_node(item, (index,), 1) for index, item in enumerate(working)]
    if not normalized:
        raise MindMapAiSplitError("AI 没有返回可用的替换节点。")
    return normalized


def replace_target_at_location(
    parent_children: list[dict[str, Any]],
    target_index: int,
    replacement_nodes: list[dict[str, Any]],
) -> None:
    """一次切片替换保证目标前后的兄弟节点顺序不变。"""
    parent_children[target_index : target_index + 1] = replacement_nodes
