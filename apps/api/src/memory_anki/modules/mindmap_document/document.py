from __future__ import annotations

import copy
import hashlib
import json
import re
from html import unescape
from typing import Any

DEFAULT_LAYOUT = "logicalStructure"
DEFAULT_THEME = {"template": "avocado", "config": {}}
DEFAULT_EDITOR_CONFIG: dict[str, Any] = {}
DEFAULT_EDITOR_LOCAL_CONFIG: dict[str, Any] = {}
EDITOR_FINGERPRINT_KEY = "editor_fingerprint"
LANG_KEY = "__lang"
NODE_ID_KEY = "memoryAnkiId"
NODE_TYPE_KEY = "memoryAnkiNodeType"
ROOT_KIND_KEY = "memoryAnkiRootKind"
NODE_UID_KEY = "uid"

TAG_RE = re.compile(r"<[^>]+>")
HTML_BLOCK_BREAK_RE = re.compile(r"</(?:div|p|li|h[1-6]|blockquote|pre|tr)>", re.IGNORECASE)


def normalize_editor_doc(doc: Any, *, root_text: str, root_kind: str) -> dict[str, Any]:
    clone = ensure_editor_dict(doc)
    root = ensure_editor_dict(clone.get("root"))
    clone["root"] = root
    root_data = ensure_editor_dict(root.get("data"))
    root["data"] = root_data
    root_data["text"] = root_text or "Root"
    root_data[ROOT_KIND_KEY] = root_kind
    if not stringify_editor_value(root_data.get(NODE_UID_KEY)).strip():
        root_data[NODE_UID_KEY] = f"{root_kind}-root"
    root_children = root.get("children")
    if not isinstance(root_children, list):
        root_children = []
    root["children"] = [
        _normalize_editor_node(node, path=(index,))
        for index, node in enumerate(root_children)
    ]
    clone["theme"] = ensure_editor_dict(clone.get("theme")) or copy.deepcopy(DEFAULT_THEME)
    clone["theme"].setdefault("template", DEFAULT_THEME["template"])
    clone["theme"].setdefault("config", copy.deepcopy(DEFAULT_THEME["config"]))
    clone["layout"] = clone.get("layout") or DEFAULT_LAYOUT
    clone["config"] = ensure_editor_dict(clone.get("config"))
    clone.setdefault("view", None)
    clone.setdefault("schemaVersion", 1)
    return clone


def build_editor_state_fingerprint(state: dict[str, Any]) -> str:
    payload = {
        "editor_doc": state.get("editor_doc"),
        "editor_config": state.get("editor_config"),
        "editor_local_config": state.get("editor_local_config"),
        "lang": state.get("lang") or "zh",
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def deserialize_editor_payload(raw: Any, default: Any) -> Any:
    if raw in (None, ""):
        return copy.deepcopy(default)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return copy.deepcopy(default)
    return copy.deepcopy(raw)


def serialize_editor_payload(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def ensure_editor_dict(value: Any) -> dict[str, Any]:
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def coerce_editor_local_config(local_config: Any, lang: Any) -> dict[str, Any]:
    config = ensure_editor_dict(local_config)
    if isinstance(lang, str) and lang.strip():
        config[LANG_KEY] = lang.strip()
    elif LANG_KEY not in config:
        config[LANG_KEY] = "zh"
    return config


def extract_editor_lang(local_config: dict[str, Any]) -> str:
    lang = local_config.get(LANG_KEY)
    if isinstance(lang, str) and lang.strip():
        return lang.strip()
    local_config[LANG_KEY] = "zh"
    return "zh"


def coerce_editor_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def stringify_editor_value(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def plain_editor_text(value: Any, *, fallback: str) -> str:
    text = stringify_editor_value(value)
    text = text.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = HTML_BLOCK_BREAK_RE.sub("\n", text)
    text = TAG_RE.sub("", text)
    text = unescape(text).strip()
    return text or fallback


def normalize_editor_lookup_text(value: Any) -> str:
    return "".join(plain_editor_text(value, fallback="").split()).strip()


def _build_legacy_node_uid(data: dict[str, Any], *, path: tuple[int, ...]) -> str:
    node_type = stringify_editor_value(data.get(NODE_TYPE_KEY)).strip() or "node"
    node_id = coerce_editor_int(data.get(NODE_ID_KEY))
    if node_id is not None:
        return f"{node_type}-{node_id}"
    seed = {
        "path": path,
        "text": stringify_editor_value(data.get("text")).strip(),
        "type": node_type,
    }
    encoded = json.dumps(
        seed, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return f"{node_type}-legacy-{hashlib.sha256(encoded).hexdigest()[:16]}"


def _normalize_editor_node(node: Any, *, path: tuple[int, ...]) -> dict[str, Any]:
    normalized = ensure_editor_dict(node)
    data = ensure_editor_dict(normalized.get("data"))
    normalized["data"] = data
    if not stringify_editor_value(data.get(NODE_UID_KEY)).strip():
        data[NODE_UID_KEY] = _build_legacy_node_uid(data, path=path)
    children = normalized.get("children")
    normalized["children"] = (
        [
            _normalize_editor_node(child, path=(*path, index))
            for index, child in enumerate(children)
            if isinstance(child, dict)
        ]
        if isinstance(children, list)
        else []
    )
    return normalized

def collect_node_descendants(
    editor_doc: Any,
) -> tuple[dict[str, set[str]], dict[str, str]]:
    doc = deserialize_editor_payload(editor_doc, {})
    root = doc.get("root") if isinstance(doc, dict) else None
    descendants: dict[str, set[str]] = {}
    labels: dict[str, str] = {}

    def walk(node: Any) -> set[str]:
        if not isinstance(node, dict):
            return set()
        raw_data = node.get("data")
        data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
        uid = str(data.get(NODE_UID_KEY) or "").strip()
        text = str(data.get("text") or "").strip()
        child_uids: set[str] = set()
        raw_children = node.get("children")
        children: list[Any] = raw_children if isinstance(raw_children, list) else []
        for child in children:
            child_uids.update(walk(child))
        if uid:
            labels[uid] = text or uid
            child_uids.add(uid)
            descendants[uid] = set(child_uids)
        return child_uids

    walk(root)
    return descendants, labels
