import copy
import json
import re
from html import unescape
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace, Peg, Subject, engine
from memory_anki.modules.backups.application.backup_service import (
    count_editor_doc_nodes,
    create_effective_palace_version,
    is_dangerous_structure_change,
)

DEFAULT_LAYOUT = "logicalStructure"
DEFAULT_THEME = {"template": "avocado", "config": {}}
DEFAULT_EDITOR_CONFIG: dict[str, Any] = {}
DEFAULT_EDITOR_LOCAL_CONFIG: dict[str, Any] = {}
LANG_KEY = "__lang"
NODE_ID_KEY = "memoryAnkiId"
NODE_TYPE_KEY = "memoryAnkiNodeType"
ROOT_KIND_KEY = "memoryAnkiRootKind"
NODE_UID_KEY = "uid"
SAFE_EDITOR_SOURCES = {"palace_edit", "version_restore", "backup_restore"}
DANGEROUS_EDITOR_SOURCES = {"review_edit", "practice_edit", "unknown"}

TAG_RE = re.compile(r"<[^>]+>")
HTML_BLOCK_BREAK_RE = re.compile(r"</(?:div|p|li|h[1-6]|blockquote|pre|tr)>", re.IGNORECASE)


def ensure_editor_schema() -> None:
    table_columns = {
        "subjects": ("editor_doc", "editor_config", "editor_local_config"),
        "palaces": ("editor_doc", "editor_config", "editor_local_config"),
    }
    with engine.begin() as conn:
        for table_name, columns in table_columns.items():
            existing = {
                row[1]
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            }
            for column in columns:
                if column not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {column} TEXT")


def get_subject_editor_state(subject: Subject) -> dict[str, Any]:
    local_config = _deserialize(subject.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    lang = _extract_lang(local_config)
    doc = _deserialize(subject.editor_doc, None)
    if not isinstance(doc, dict):
        doc = build_subject_editor_doc(subject)
    else:
        doc = normalize_editor_doc(doc, root_text=subject.name, root_kind="subject")
    return {
        "editor_doc": doc,
        "editor_config": _deserialize(subject.editor_config, DEFAULT_EDITOR_CONFIG),
        "editor_local_config": local_config,
        "lang": lang,
    }


def get_palace_editor_state(palace: Palace) -> dict[str, Any]:
    local_config = _deserialize(palace.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    lang = _extract_lang(local_config)
    doc = _deserialize(palace.editor_doc, None)
    if not isinstance(doc, dict):
        doc = build_palace_editor_doc(palace)
    else:
        doc = normalize_editor_doc(doc, root_text=palace.title, root_kind="palace")
    return {
        "editor_doc": doc,
        "editor_config": _deserialize(palace.editor_config, DEFAULT_EDITOR_CONFIG),
        "editor_local_config": local_config,
        "lang": lang,
    }


def save_subject_editor_state(session: Session, subject: Subject, payload: dict[str, Any]) -> dict[str, Any]:
    doc_input = payload.get("editor_doc")
    config_input = payload.get("editor_config")
    local_input = payload.get("editor_local_config")
    lang_input = payload.get("lang")

    local_config = (
        _coerce_local_config(local_input, lang_input)
        if local_input is not None or lang_input is not None
        else _deserialize(subject.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    )

    if doc_input is not None:
        doc = normalize_editor_doc(doc_input, root_text=subject.name, root_kind="subject")
        sync_subject_tree_from_doc(session, subject, doc)
        subject.editor_doc = _serialize(doc)
    if config_input is not None:
        subject.editor_config = _serialize(_ensure_dict(config_input))
    if local_config is not None:
        subject.editor_local_config = _serialize(local_config)

    session.commit()
    session.refresh(subject)
    return get_subject_editor_state(subject)


def save_palace_editor_state(session: Session, palace: Palace, payload: dict[str, Any]) -> dict[str, Any]:
    doc_input = payload.get("editor_doc")
    config_input = payload.get("editor_config")
    local_input = payload.get("editor_local_config")
    lang_input = payload.get("lang")
    allow_dangerous_delete = bool(payload.get("confirm_dangerous_change"))
    editor_source = str(payload.get("editor_source") or "unknown").strip() or "unknown"

    local_config = (
        _coerce_local_config(local_input, lang_input)
        if local_input is not None or lang_input is not None
        else _deserialize(palace.editor_local_config, DEFAULT_EDITOR_LOCAL_CONFIG)
    )

    if doc_input is not None:
        existing_node_count = count_editor_doc_nodes(palace.editor_doc)
        doc = normalize_editor_doc(doc_input, root_text=palace.title, root_kind="palace")
        next_node_count = count_editor_doc_nodes(doc)
        if editor_source in DANGEROUS_EDITOR_SOURCES and next_node_count < existing_node_count:
            raise ValueError("当前编辑内容来自复习/练习视图或未确认同步态，已拒绝写回宫殿，避免未显示节点被误删。")
        if editor_source not in SAFE_EDITOR_SOURCES and allow_dangerous_delete:
            raise ValueError("只有正式宫殿编辑器或受控恢复流程才能确认危险删除。")
        if is_dangerous_structure_change(existing_node_count, next_node_count) and not allow_dangerous_delete:
            raise ValueError("检测到危险结构变更：新导图节点数骤减，已拒绝保存。请在正式编辑中确认后再执行。")
        sync_palace_tree_from_doc(session, palace, doc)
        palace.editor_doc = _serialize(doc)
    if config_input is not None:
        palace.editor_config = _serialize(_ensure_dict(config_input))
    if local_config is not None:
        palace.editor_local_config = _serialize(local_config)

    create_effective_palace_version(session, palace, "editor_save")

    session.commit()
    session.refresh(palace)
    return get_palace_editor_state(palace)


def sync_subject_editor_root(subject: Subject) -> None:
    doc = _deserialize(subject.editor_doc, None)
    if not isinstance(doc, dict):
        return
    normalized = normalize_editor_doc(doc, root_text=subject.name, root_kind="subject")
    subject.editor_doc = _serialize(normalized)


def sync_palace_editor_root(palace: Palace) -> None:
    doc = _deserialize(palace.editor_doc, None)
    if not isinstance(doc, dict):
        return
    normalized = normalize_editor_doc(doc, root_text=palace.title, root_kind="palace")
    palace.editor_doc = _serialize(normalized)


def build_subject_editor_doc(subject: Subject) -> dict[str, Any]:
    root_children = [_chapter_to_editor_node(chapter) for chapter in subject.chapters if chapter.parent_id is None]
    return _default_editor_doc(subject.name, "subject", root_children)


def build_palace_editor_doc(palace: Palace) -> dict[str, Any]:
    root_children = [_peg_to_editor_node(peg) for peg in palace.pegs if peg.parent_id is None]
    return _default_editor_doc(palace.title, "palace", root_children)


def normalize_editor_doc(doc: Any, *, root_text: str, root_kind: str) -> dict[str, Any]:
    clone = _ensure_dict(doc)
    root = _ensure_dict(clone.get("root"))
    clone["root"] = root

    root_data = _ensure_dict(root.get("data"))
    root["data"] = root_data
    root_data["text"] = root_text or "Root"
    root_data[ROOT_KIND_KEY] = root_kind

    root_children = root.get("children")
    if not isinstance(root_children, list):
        root_children = []
    root["children"] = [_normalize_editor_node(node) for node in root_children]

    clone["theme"] = _ensure_dict(clone.get("theme")) or copy.deepcopy(DEFAULT_THEME)
    clone["theme"].setdefault("template", DEFAULT_THEME["template"])
    clone["theme"].setdefault("config", copy.deepcopy(DEFAULT_THEME["config"]))
    clone["layout"] = clone.get("layout") or DEFAULT_LAYOUT
    clone["config"] = _ensure_dict(clone.get("config"))
    clone.setdefault("view", None)
    return clone


def sync_subject_tree_from_doc(session: Session, subject: Subject, doc: dict[str, Any]) -> None:
    nodes = doc["root"]["children"]
    existing = session.query(Chapter).filter_by(subject_id=subject.id).all()
    by_id = {chapter.id: chapter for chapter in existing}
    uid_map = _collect_existing_id_map(_deserialize(subject.editor_doc, None))
    seen_ids: set[int] = set()

    def visit(items: list[dict[str, Any]], parent_id: int | None) -> None:
        for index, item in enumerate(items):
            data = _ensure_dict(item.get("data"))
            item["data"] = data
            original_text = _stringify(data.get("text"))
            original_note = _stringify(data.get("note"))
            chapter_name = _plain_text(data.get("text"), fallback="新章节")
            chapter_notes = _stringify(data.get("note"))
            chapter_id = _coerce_int(data.get(NODE_ID_KEY))
            if chapter_id is None:
                chapter_id = uid_map.get(_stringify(data.get(NODE_UID_KEY)))
            chapter = by_id.get(chapter_id) if chapter_id else None
            if chapter is None:
                chapter = Chapter(
                    subject_id=subject.id,
                    parent_id=parent_id,
                    sort_order=index,
                    name=chapter_name,
                    notes=chapter_notes,
                )
                session.add(chapter)
                session.flush()
                by_id[chapter.id] = chapter

            chapter.subject_id = subject.id
            chapter.parent_id = parent_id
            chapter.sort_order = index
            chapter.name = chapter_name
            chapter.notes = chapter_notes

            data["text"] = original_text or chapter_name
            data["note"] = original_note or chapter_notes
            data[NODE_ID_KEY] = chapter.id
            data[NODE_TYPE_KEY] = "chapter"
            seen_ids.add(chapter.id)

            children = item.get("children")
            if not isinstance(children, list):
                children = []
                item["children"] = children
            visit(children, chapter.id)

    visit(nodes, None)
    session.flush()

    removed_ids = {chapter.id for chapter in existing if chapter.id not in seen_ids}
    if removed_ids:
        for chapter in existing:
            if chapter.id in removed_ids and chapter.parent_id not in removed_ids:
                _delete_chapter_tree(session, chapter)
        session.flush()


def sync_palace_tree_from_doc(session: Session, palace: Palace, doc: dict[str, Any]) -> None:
    nodes = doc["root"]["children"]
    existing = session.query(Peg).filter_by(palace_id=palace.id).all()
    by_id = {peg.id: peg for peg in existing}
    uid_map = _collect_existing_id_map(_deserialize(palace.editor_doc, None))
    seen_ids: set[int] = set()

    def visit(items: list[dict[str, Any]], parent_id: int | None) -> None:
        for index, item in enumerate(items):
            data = _ensure_dict(item.get("data"))
            item["data"] = data
            original_text = _stringify(data.get("text"))
            original_note = _stringify(data.get("note"))
            peg_name = _plain_text(data.get("text"), fallback="新节点")
            peg_content = _stringify(data.get("note"))
            peg_id = _coerce_int(data.get(NODE_ID_KEY))
            if peg_id is None:
                peg_id = uid_map.get(_stringify(data.get(NODE_UID_KEY)))
            peg = by_id.get(peg_id) if peg_id else None
            if peg is None:
                peg = Peg(
                    palace_id=palace.id,
                    parent_id=parent_id,
                    sort_order=index,
                    name=peg_name,
                    content=peg_content,
                )
                session.add(peg)
                session.flush()
                by_id[peg.id] = peg

            peg.palace_id = palace.id
            peg.parent_id = parent_id
            peg.sort_order = index
            peg.name = peg_name
            peg.content = peg_content

            data["text"] = original_text or peg_name
            data["note"] = original_note or peg_content
            data[NODE_ID_KEY] = peg.id
            data[NODE_TYPE_KEY] = "peg"
            seen_ids.add(peg.id)

            children = item.get("children")
            if not isinstance(children, list):
                children = []
                item["children"] = children
            visit(children, peg.id)

    visit(nodes, None)
    session.flush()

    removed_ids = {peg.id for peg in existing if peg.id not in seen_ids}
    if removed_ids:
        for peg in existing:
            if peg.id in removed_ids and peg.parent_id not in removed_ids:
                _delete_peg_tree(session, peg)
        session.flush()


def _default_editor_doc(root_text: str, root_kind: str, children: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "root": {
            "data": {
                "text": root_text or "Root",
                ROOT_KIND_KEY: root_kind,
            },
            "children": children,
        },
        "theme": copy.deepcopy(DEFAULT_THEME),
        "layout": DEFAULT_LAYOUT,
        "config": copy.deepcopy(DEFAULT_EDITOR_CONFIG),
        "view": None,
    }


def _chapter_to_editor_node(chapter: Chapter) -> dict[str, Any]:
    return {
        "data": {
            "text": chapter.name or "",
            "note": chapter.notes or "",
            NODE_ID_KEY: chapter.id,
            NODE_TYPE_KEY: "chapter",
        },
        "children": [_chapter_to_editor_node(child) for child in chapter.children],
    }


def _peg_to_editor_node(peg: Peg) -> dict[str, Any]:
    return {
        "data": {
            "text": peg.name or "",
            "note": peg.content or "",
            NODE_ID_KEY: peg.id,
            NODE_TYPE_KEY: "peg",
        },
        "children": [_peg_to_editor_node(child) for child in peg.children],
    }


def _normalize_editor_node(node: Any) -> dict[str, Any]:
    clone = _ensure_dict(node)
    clone["data"] = _ensure_dict(clone.get("data"))
    children = clone.get("children")
    if not isinstance(children, list):
        children = []
    clone["children"] = [_normalize_editor_node(child) for child in children]
    return clone


def _delete_chapter_tree(session: Session, chapter: Chapter) -> None:
    for child in list(chapter.children or []):
        _delete_chapter_tree(session, child)
    session.delete(chapter)


def _delete_peg_tree(session: Session, peg: Peg) -> None:
    for child in list(peg.children or []):
        _delete_peg_tree(session, child)
    session.delete(peg)


def _collect_existing_id_map(doc: Any) -> dict[str, int]:
    if not isinstance(doc, dict):
        return {}
    result: dict[str, int] = {}

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            uid = _stringify(data.get(NODE_UID_KEY))
            business_id = _coerce_int(data.get(NODE_ID_KEY))
            if uid and business_id:
                result[uid] = business_id
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                walk(child)

    walk(doc.get("root"))
    return result


def _deserialize(raw: Any, default: Any) -> Any:
    if raw in (None, ""):
        return copy.deepcopy(default)
    if isinstance(raw, dict | list):
        return copy.deepcopy(raw)
    try:
        return json.loads(raw)
    except Exception:
        return copy.deepcopy(default)


def _serialize(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _ensure_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    return {}


def _coerce_local_config(local_config: Any, lang: Any) -> dict[str, Any]:
    config = _ensure_dict(local_config)
    if isinstance(lang, str) and lang.strip():
        config[LANG_KEY] = lang.strip()
    elif LANG_KEY not in config:
        config[LANG_KEY] = "zh"
    return config


def _extract_lang(local_config: dict[str, Any]) -> str:
    lang = local_config.get(LANG_KEY)
    if isinstance(lang, str) and lang.strip():
        return lang.strip()
    local_config[LANG_KEY] = "zh"
    return "zh"


def _coerce_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except Exception:
        return None


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _plain_text(value: Any, *, fallback: str) -> str:
    text = _stringify(value)
    text = (
        text.replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
    )
    text = HTML_BLOCK_BREAK_RE.sub("\n", text)
    text = TAG_RE.sub("", text)
    text = unescape(text).strip()
    if not text:
        text = fallback
    return text
