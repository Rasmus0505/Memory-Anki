from __future__ import annotations

import copy
from typing import Any

from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.modules.mindmap_document.api import (
    DEFAULT_EDITOR_CONFIG,
    DEFAULT_LAYOUT,
    DEFAULT_THEME,
    NODE_ID_KEY,
    NODE_TYPE_KEY,
    NODE_UID_KEY,
    ROOT_KIND_KEY,
    coerce_editor_int,
    deserialize_editor_payload,
    ensure_editor_dict,
    plain_editor_text,
    stringify_editor_value,
)

REVIEW_PLACEHOLDER_TEXT = "待回忆"
REVIEW_PLACEHOLDER_NODE_STYLE = {
    "fillColor": "#fffbeb",
    "borderColor": "#f59e0b",
    "borderWidth": 2,
    "color": "#92400e",
}
REVIEW_REVEALED_NODE_STYLE = {
    "fillColor": "#ecfdf5",
    "borderColor": "#10b981",
    "borderWidth": 2,
    "color": "#065f46",
}
REVIEW_RED_NODE_STYLE = {
    "fillColor": "#fff1f2",
    "borderColor": "#e11d48",
    "borderWidth": 2,
    "color": "#881337",
}
REVIEW_ROOT_NODE_STYLE = {
    "fillColor": "#18181b",
    "borderColor": "#09090b",
    "borderWidth": 2,
    "color": "#fafafa",
    "fontWeight": "bold",
}
LEGACY_REVIEW_NODE_STYLES = (
    {
        "fillColor": "#eef2f7",
        "borderColor": "#94a3b8",
        "borderWidth": 2,
        "color": "#475569",
    },
    {
        "fillColor": "#fff8e7",
        "borderColor": "#d7a84d",
        "borderWidth": 2,
        "color": "#7a5423",
    },
    {
        "fillColor": "#fff7ed",
        "borderColor": "#f59e0b",
        "borderWidth": 2,
        "color": "#9a3412",
    },
    {
        "fillColor": "#eef8ef",
        "borderColor": "#86ad86",
        "borderWidth": 2,
        "color": "#2e5d49",
    },
    {
        "fillColor": "#ecfdf5",
        "borderColor": "#22c55e",
        "borderWidth": 2,
        "color": "#14532d",
    },
    {
        "fillColor": "#ecfdf5",
        "borderColor": "#10b981",
        "borderWidth": 2,
        "color": "#065f46",
    },
    {
        "fillColor": "#fff3f3",
        "borderColor": "#c77882",
        "borderWidth": 2,
        "color": "#7c3840",
    },
    {
        "fillColor": "#fef2f2",
        "borderColor": "#ef4444",
        "borderWidth": 2,
        "color": "#7f1d1d",
    },
)
LEGACY_REVIEW_ROOT_NODE_STYLES = (
    {
        "fillColor": "#315b4f",
        "borderColor": "#284c42",
        "borderWidth": 2,
        "color": "#f8fbf6",
        "fontWeight": "bold",
    },
    {
        "fillColor": "#111827",
        "borderColor": "#0f172a",
        "borderWidth": 2,
        "color": "#f8fafc",
        "fontWeight": "bold",
    },
)
REVIEW_NODE_STYLE_VARIANTS = (
    REVIEW_PLACEHOLDER_NODE_STYLE,
    REVIEW_REVEALED_NODE_STYLE,
    REVIEW_RED_NODE_STYLE,
    *LEGACY_REVIEW_NODE_STYLES,
)
REVIEW_ROOT_STYLE_VARIANTS = (
    REVIEW_ROOT_NODE_STYLE,
    *LEGACY_REVIEW_ROOT_NODE_STYLES,
)
REVIEW_LINE_STYLES = (
    {"lineColor": "#d4d4d8", "lineWidth": 2},
    {"lineColor": "#10b981", "lineWidth": 3},
    {"lineColor": "#b8c9bf", "lineWidth": 2},
    {"lineColor": "#86ad86", "lineWidth": 3},
    {"lineColor": "#cbd5e1", "lineWidth": 2},
    {"lineColor": "#22c55e", "lineWidth": 3},
)
REVIEW_TRANSIENT_FIELDS = (
    "fillColor",
    "borderColor",
    "borderWidth",
    "color",
    "lineColor",
    "lineWidth",
    "fontWeight",
    "hideNote",
    "customTextWidth",
)


def build_palace_editor_doc(palace: Palace) -> dict[str, Any]:
    root_children = [_peg_to_editor_node(peg) for peg in palace.pegs if peg.parent_id is None]
    return _default_editor_doc(palace.title, "palace", root_children)


def sanitize_palace_editor_doc(palace: Palace, doc: dict[str, Any]) -> dict[str, Any]:
    clone = ensure_editor_dict(doc)
    if not _looks_like_review_overlay_doc(clone):
        return clone

    peg_map = _collect_palace_peg_map(palace)
    version_recovery_map = _collect_palace_version_recovery_map(palace)

    def visit(node: dict[str, Any], *, is_root: bool = False) -> None:
        data = ensure_editor_dict(node.get("data"))
        node["data"] = data
        peg_id = coerce_editor_int(data.get(NODE_ID_KEY))
        peg = peg_map.get(peg_id) if peg_id is not None else None
        recovered = version_recovery_map.get(peg_id) if peg_id is not None else None
        restore_text = _looks_like_review_placeholder_text(data.get("text"))
        fallback_text = (
            stringify_editor_value(recovered.get("text"))
            if recovered and stringify_editor_value(recovered.get("text"))
            else peg.name
            if peg is not None
            else "新节点"
        )
        fallback_note = (
            stringify_editor_value(recovered.get("note"))
            if recovered and stringify_editor_value(recovered.get("note"))
            else peg.content
            if peg is not None
            else ""
        )
        if peg is not None and restore_text:
            data["text"] = fallback_text or "新节点"
            data["note"] = fallback_note
        elif (
            (peg is not None or recovered is not None)
            and bool(data.get("hideNote"))
            and not stringify_editor_value(data.get("note"))
        ):
            data["note"] = fallback_note
        _strip_review_overlay_fields(data, is_root=is_root)
        children = node.get("children")
        if not isinstance(children, list):
            children = []
            node["children"] = children
        for child in children:
            if isinstance(child, dict):
                visit(child, is_root=False)

    root = clone.get("root")
    if isinstance(root, dict):
        visit(root, is_root=True)
    return clone


def _default_editor_doc(
    root_text: str, root_kind: str, children: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "root": {
            "data": {
                "text": root_text or "Root",
                ROOT_KIND_KEY: root_kind,
                NODE_UID_KEY: f"{root_kind}-root",
            },
            "children": children,
        },
        "theme": copy.deepcopy(DEFAULT_THEME),
        "layout": DEFAULT_LAYOUT,
        "config": copy.deepcopy(DEFAULT_EDITOR_CONFIG),
        "view": None,
    }


def _peg_to_editor_node(peg: Peg) -> dict[str, Any]:
    return {
        "data": {
            "text": peg.name or "",
            "note": peg.content or "",
            NODE_UID_KEY: f"peg-{peg.id}",
            NODE_ID_KEY: peg.id,
            NODE_TYPE_KEY: "peg",
        },
        "children": [_peg_to_editor_node(child) for child in peg.children],
    }


def _collect_palace_peg_map(palace: Palace) -> dict[int, Peg]:
    peg_map: dict[int, Peg] = {}

    def visit(peg: Peg) -> None:
        if peg.id in peg_map:
            return
        peg_map[peg.id] = peg
        for child in peg.children or []:
            visit(child)

    for peg in palace.pegs or []:
        visit(peg)
    return peg_map


def _collect_palace_version_recovery_map(palace: Palace) -> dict[int, dict[str, str]]:
    version_map: dict[int, dict[str, str]] = {}
    versions = sorted(
        palace.versions or [],
        key=lambda version: int(getattr(version, "id", 0) or 0),
        reverse=True,
    )
    for version in versions:
        doc = deserialize_editor_payload(getattr(version, "editor_doc", None), None)
        if not isinstance(doc, dict) or _looks_like_review_overlay_doc(doc):
            continue

        def visit(node: dict[str, Any]) -> None:
            data = ensure_editor_dict(node.get("data"))
            node_id = coerce_editor_int(data.get(NODE_ID_KEY))
            text = stringify_editor_value(data.get("text"))
            if (
                node_id is not None
                and node_id not in version_map
                and text
                and not _looks_like_review_placeholder_text(text)
            ):
                version_map[node_id] = {
                    "text": text,
                    "note": stringify_editor_value(data.get("note")),
                }
            children = node.get("children")
            if not isinstance(children, list):
                return
            for child in children:
                if isinstance(child, dict):
                    visit(child)

        root = doc.get("root")
        if isinstance(root, dict):
            visit(root)
    return version_map


def _matches_style_subset(data: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(data.get(key) == value for key, value in expected.items())


def _looks_like_review_placeholder_text(value: Any) -> bool:
    return plain_editor_text(value, fallback="") == REVIEW_PLACEHOLDER_TEXT


def _looks_like_review_overlay_doc(doc: dict[str, Any]) -> bool:
    root = doc.get("root")
    if not isinstance(root, dict):
        return False

    found_root_overlay = False
    found_node_overlay = False
    found_placeholder_overlay = False

    def visit(node: dict[str, Any], *, is_root: bool = False) -> None:
        nonlocal found_root_overlay, found_node_overlay, found_placeholder_overlay
        data = ensure_editor_dict(node.get("data"))
        if is_root:
            found_root_overlay = any(
                _matches_style_subset(data, style) for style in REVIEW_ROOT_STYLE_VARIANTS
            )
        else:
            if any(_matches_style_subset(data, style) for style in REVIEW_NODE_STYLE_VARIANTS):
                found_node_overlay = True
            if _looks_like_review_placeholder_text(data.get("text")) and (
                bool(data.get("hideNote"))
                or data.get("customTextWidth") == 132
                or _matches_style_subset(data, REVIEW_PLACEHOLDER_NODE_STYLE)
            ):
                found_placeholder_overlay = True
        children = node.get("children")
        if not isinstance(children, list):
            return
        for child in children:
            if isinstance(child, dict):
                visit(child, is_root=False)

    visit(root, is_root=True)
    return found_placeholder_overlay or (found_root_overlay and found_node_overlay)


def _strip_review_overlay_fields(data: dict[str, Any], *, is_root: bool) -> None:
    overlay_styles = list(REVIEW_ROOT_STYLE_VARIANTS if is_root else REVIEW_NODE_STYLE_VARIANTS)
    overlay_styles.extend(REVIEW_LINE_STYLES)
    for style in overlay_styles:
        for key, value in style.items():
            if data.get(key) == value:
                data.pop(key, None)
    for field in REVIEW_TRANSIENT_FIELDS:
        if field == "fontWeight" and not is_root:
            continue
        if field in data and data.get(field) in (True, 132):
            data.pop(field, None)
