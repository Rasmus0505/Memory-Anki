"""Palace-scoped article transfer. Never reads or restores a whole database package."""
from __future__ import annotations

import base64
import copy
import json
import re
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from memory_anki.modules.backups.api import create_effective_palace_version
from memory_anki.modules.content.application.article_package_segments import (
    restore_article_package_segments,
    validate_article_segment_target,
)
from memory_anki.modules.content.application.attachment_service import create_attachment
from memory_anki.modules.content.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
)
from memory_anki.modules.content.application.palace_service import create_palace, get_palace
from memory_anki.modules.content.domain.schemas import PalaceCreate
from memory_anki.modules.mindmap_document.api import (
    EditorStateConflictError,
    assert_expected_fingerprint,
)
from memory_anki.modules.quiz.api import (
    export_article_quiz,
    import_article_quiz,
    validate_article_quiz_revision,
    validate_article_quiz_target,
)
from memory_anki.platform.application import UnitOfWork


class ArticleAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=2000)
    name: str = Field(pattern=r"^[\w.-]+$", max_length=200)
    media_type: str
    base64: str = Field(max_length=12_000_000)


class ArticleTransferCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["create", "append", "replace", "update"]
    owner_id: str = Field(min_length=1, max_length=200)
    operation_id: str = Field(min_length=1, max_length=200)
    document: dict[str, Any]
    expected_revision: str | None = None
    source_owner: str | None = None
    base_revision: str | None = None
    parent_uid: str | None = None
    confirm_replace: bool = False
    title: str = Field(default="", max_length=1000)
    assets: list[ArticleAsset] = Field(default_factory=list, max_length=256)
    quiz: dict[str, Any] | None = None


def document_nodes(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if document.get("schemaVersion") != 1 or not isinstance(document.get("root"), dict):
        raise ValueError("Expected canonical document schemaVersion 1")
    if len(json.dumps(document)) > 8_000_000:
        raise ValueError("Article document is too large")
    result: dict[str, dict[str, Any]] = {}
    stack = [(document["root"], 0)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            raise ValueError("Every node must contain data")
        uid = node["data"].get("uid")
        if not isinstance(uid, str) or not uid or uid in result:
            raise ValueError("Node UIDs must be nonempty and unique")
        if depth > 64 or len(result) >= 5000:
            raise ValueError("Article tree exceeds transfer limits")
        result[uid] = node
        children = node.get("children", [])
        if not isinstance(children, list):
            raise ValueError("Node children must be a list")
        stack.extend((child, depth + 1) for child in children)
    return result


def remap_document(document: dict[str, Any], *, fresh: bool, current: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, str]]:
    doc = copy.deepcopy(document)
    nodes = document_nodes(doc)
    known = document_nodes(current) if current else {}
    uid_map = {uid: f"article-{uuid.uuid4().hex}" if fresh else uid for uid in nodes}
    for uid, node in nodes.items():
        data = node["data"]
        # Numeric projection IDs are never accepted from a package, even for same-owner updates.
        data.pop("memoryAnkiId", None)
        data.pop("memoryAnkiRootKind", None)
        data["uid"] = uid_map[uid]
        if not fresh and uid in known and "memoryAnkiId" in known[uid]["data"]:
            data["memoryAnkiId"] = known[uid]["data"]["memoryAnkiId"]
    return doc, uid_map


def rewrite_references(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, str):
        if value in replacements:
            return replacements[value]
        # Rich HTML legacy notes may carry the same exact URL inside attributes.
        for source, target in replacements.items():
            value = value.replace(f'"{source}"', f'"{target}"').replace(f"'{source}'", f"'{target}'")
            value = value.replace(f"({source})", f"({target})").replace(f"({source} ", f"({target} ")
        return value
    if isinstance(value, list):
        return [rewrite_references(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_references(item, replacements) for key, item in value.items()}
    return value


def _asset_bytes(asset: ArticleAsset) -> bytes:
    allowed = {"image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff", "image/gif": b"GIF", "image/webp": b"RIFF"}
    if asset.media_type not in allowed:
        raise ValueError("Only PNG, JPEG, GIF and WebP image assets are supported; SVG is rejected")
    try:
        content = base64.b64decode(asset.base64, validate=True)
    except ValueError as exc:
        raise ValueError("Invalid asset base64") from exc
    if not content.startswith(allowed[asset.media_type]) or len(content) > 8 * 1024 * 1024:
        raise ValueError("Invalid image signature or asset too large")
    if asset.media_type == "image/webp" and content[8:12] != b"WEBP":
        raise ValueError("Invalid WebP asset")
    return content


def export_article_package(session: Session, palace_id: int) -> dict[str, Any]:
    palace = get_palace(session, palace_id)
    if palace is None:
        raise LookupError("Palace not found")
    state = get_palace_editor_state(palace)
    return {"source_owner": f"palace:{palace_id}", "base_revision": state["editor_fingerprint"], "document": state["editor_doc"], "quiz": export_article_quiz(session, palace_id)}


def apply_article_transfer(session: Session, command: ArticleTransferCommand, *, palace_id: int | None, attachments_dir: Path, participant: UnitOfWork, uow: UnitOfWork, before_write: Callable[[], None] | None = None) -> dict[str, Any]:
    created_files: list[Path] = []
    try:
        if (command.mode == "create") != (palace_id is None):
            raise ValueError("Create requires no target; all other operations require a target")
        if palace_id is not None and command.owner_id != f"palace:{palace_id}":
            raise ValueError("Target owner mismatch")
        if command.mode in {"replace", "update"} and not command.confirm_replace:
            raise ValueError("Replacement requires explicit comparison confirmation")
        doc, uid_map = remap_document(command.document, fresh=command.mode != "update")
        decoded = [(asset, _asset_bytes(asset)) for asset in command.assets]
        if len({asset.source for asset in command.assets}) != len(command.assets) or sum(len(data) for _, data in decoded) > 32 * 1024 * 1024:
            raise ValueError("Duplicate asset references or package too large")
        palace = get_palace(session, palace_id) if palace_id is not None else None
        if palace_id is not None and palace is None:
            raise LookupError("Palace not found")
        if palace is not None:
            if not command.expected_revision:
                raise ValueError("Target revision is mandatory")
            state = get_palace_editor_state(palace)
            assert_expected_fingerprint(current_fingerprint=state["editor_fingerprint"], expected_fingerprint=command.expected_revision or "", allow_stale_overwrite=False)
            if command.mode == "update":
                if command.source_owner != command.owner_id or not command.base_revision:
                    raise ValueError("Update requires matching source owner and base revision")
                assert_expected_fingerprint(current_fingerprint=state["editor_fingerprint"], expected_fingerprint=command.base_revision, allow_stale_overwrite=False)
                if command.quiz is not None:
                    validate_article_quiz_revision(session, palace.id, command.quiz)
                doc, uid_map = remap_document(command.document, fresh=False, current=state["editor_doc"])
            elif command.mode == "append":
                target_doc = copy.deepcopy(state["editor_doc"])
                parent = document_nodes(target_doc).get(command.parent_uid or "")
                if parent is None:
                    raise ValueError("Append target node no longer exists")
                parent.setdefault("children", []).append(doc["root"])
                doc = target_doc
            validate_article_quiz_target(session, palace.id, set(document_nodes(doc)))
            validate_article_segment_target(session, palace.id, set(document_nodes(doc)))
            if before_write is not None:
                before_write()
            create_effective_palace_version(session, palace, "article_transfer_before")
        else:
            palace = create_palace(session, PalaceCreate(title=command.title or str(doc["root"]["data"].get("text") or "Imported article")), uow=participant)
            state = get_palace_editor_state(palace)
        replacements: dict[str, str] = {}
        for asset, content in decoded:
            attachment = create_attachment(session, palace_id=palace.id, original_name=asset.name, content=content, attachments_dir=attachments_dir, uow=participant)
            if attachment is None:
                raise ValueError("Asset target not found")
            created_files.append(attachments_dir / attachment.filename)
            replacements[asset.source] = f"/api/v1/attachments/{attachment.id}"
        doc = rewrite_references(doc, replacements)
        # Never persist a package-local or another palace's attachment reference.
        serialized = json.dumps([doc, rewrite_references(command.quiz, replacements)])
        if re.search(r'"assets/[^"\\]+"', serialized):
            raise ValueError("Unresolved package asset reference")
        owned_attachments = {item.id for item in palace.attachments}
        session.flush()
        owned_attachments.update(int(url.rsplit("/", 1)[1]) for url in replacements.values())
        for match in re.finditer(r"/api/v1/attachments/(\d+)", serialized):
            if int(match.group(1)) not in owned_attachments:
                raise ValueError("Foreign attachment reference must be packaged")
        # The aggregate normalizer owns root text; carry an imported title into that owner.
        if command.mode in {"replace", "update"}:
            palace.title = str(doc["root"]["data"].get("text") or "Imported article")
            palace.manual_title = palace.title
            state = get_palace_editor_state(palace)
        save_palace_editor_state(session, palace, {"editor_doc": doc, "expected_editor_fingerprint": state["editor_fingerprint"], "editor_source": "import_apply", "confirm_dangerous_change": command.confirm_replace}, uow=participant)
        if command.quiz is not None:
            restore_article_package_segments(session, palace.id, command.quiz.get("segments", []), uid_map)
            import_article_quiz(session, palace.id, rewrite_references(command.quiz, replacements), uid_map, same_owner=command.mode == "update")
        uow.commit()
        return {"palace_id": palace.id, "owner_id": command.owner_id, "operation_id": command.operation_id, "uid_map": uid_map, **get_palace_editor_state(palace)}
    except Exception:
        uow.rollback()
        for path in created_files:
            path.unlink(missing_ok=True)
        raise


__all__ = ["ArticleTransferCommand", "EditorStateConflictError", "apply_article_transfer", "export_article_package"]
