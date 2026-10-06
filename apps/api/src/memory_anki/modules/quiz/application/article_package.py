"""Portable article quiz content; transaction ownership remains with the caller.

Learning history, scheduling, deletion history and generation runs are not package
content. Unsupported foreign relations are rejected instead of being detached.
Legacy rows without explicit UUIDs use UUID5 of persisted owner/question IDs and
creation timestamps; export never repairs or mutates them.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable
from copy import deepcopy
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import delete, insert, or_, select
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
    palace_quiz_question_segment_table,
)
from memory_anki.modules.mindmap_document.api import collect_node_descendants

from .question_contracts import PalaceQuizNotFoundError, PalaceQuizValidationError
from .questions.validation import normalize_question_content

FORMAT = "memory-anki-article-quiz-v1"
_UID_KEY = "article_question_uid"
_JSON_FIELDS = {
    "options": "options_json", "answer_payload": "answer_payload_json",
    "source_meta": "source_meta_json", "evidence": "evidence_json",
    "knowledge_tags": "knowledge_tags_json", "quality_review": "quality_review_json",
}
_SCALAR_FIELDS = (
    "question_type", "stem", "analysis", "lifecycle_status", "cognitive_level",
    "difficulty", "quality_score", "version_number", "sort_order", "marked",
)
_QUESTION_KEYS = {"uid", "segments", *_JSON_FIELDS, *_SCALAR_FIELDS}
_BINDING_KEYS = {"question_uid", "node_uid", "confidence", "reason", "source"}


def _error(message: str) -> PalaceQuizValidationError:
    return PalaceQuizValidationError(f"Article quiz package: {message}")


def _uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise _error("question uid must be an explicit UUID string")
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise _error("question uid must be an explicit UUID string") from exc


def _json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise _error("invalid stored JSON") from exc


def _identity(meta: dict[str, Any]) -> str | None:
    if not isinstance(meta, dict):
        raise _error("invalid source_meta")
    manual = meta.get("manual_import")
    value = manual.get(_UID_KEY) if isinstance(manual, dict) else None
    return _uuid(value) if value is not None else None


def _row_identity(row: PalaceQuizQuestion, palace: Palace) -> str:
    explicit = _identity(_json(row.source_meta_json))
    if explicit:
        return explicit
    if row.created_at is None or palace.created_at is None:
        raise _error("legacy question identity requires stable creation timestamps")
    return str(uuid5(NAMESPACE_URL, (
        f"{FORMAT}/{palace.id}/{palace.created_at.isoformat()}/"
        f"{row.id}/{row.created_at.isoformat()}"
    )))


def _portable(value: Any) -> None:
    """Reject opaque foreign database references, including nested provenance."""
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise _error("metadata keys must be strings")
            if (key.endswith("_id") or key.endswith("_ids")) and child not in (None, [], ""):
                # Option/category IDs are local answer symbols, never database references.
                if key not in {"correct_option_id", "left_id", "right_id", "category_id", "correct_order_ids"}:
                    raise _error(f"unsupported foreign reference: {key}")
            _portable(child)
    elif isinstance(value, list):
        for child in value:
            _portable(child)
    elif value is not None and not isinstance(value, str | bool | int | float):
        raise _error("content must be JSON")
    elif isinstance(value, float) and not math.isfinite(value):
        raise _error("non-finite number")


def _palace(session: Session, palace_id: int) -> Palace:
    row = session.get(Palace, palace_id)
    if row is None or row.deleted_at is not None:
        raise PalaceQuizNotFoundError("宫殿不存在。")
    return row


def _supported(row: PalaceQuizQuestion) -> None:
    if any(getattr(row, key) is not None for key in (
        "mini_palace_id", "source_chapter_id", "classified_chapter_id", "origin_question_id",
    )):
        raise _error("chapter, mini-palace and origin relations are unsupported")


def _segments(session: Session, palace_id: int) -> list[dict[str, Any]]:
    from memory_anki.modules.content.api import list_article_package_segments

    return list_article_package_segments(session, palace_id)


def _segment_descriptor(raw: Any) -> dict[str, Any]:
    keys = {"name", "color", "node_uids", "sort_order"}
    if not isinstance(raw, dict) or set(raw) != keys:
        raise _error("invalid segment descriptor")
    if not isinstance(raw["name"], str) or not isinstance(raw["color"], str) or type(raw["sort_order"]) is not int:
        raise _error("invalid segment metadata")
    nodes = raw["node_uids"]
    if not isinstance(nodes, list) or any(not isinstance(node, str) or not node for node in nodes):
        raise _error("invalid segment node_uids")
    if len(nodes) != len(set(nodes)):
        raise _error("duplicate segment node UID")
    return deepcopy(raw)


def _segment_key(raw: dict[str, Any]) -> str:
    return json.dumps(_segment_descriptor(raw), sort_keys=True, ensure_ascii=False)


def _closure(session: Session, palace_id: int) -> tuple[list[PalaceQuizQuestion], list[PalaceQuizQuestionNodeBinding]]:
    rows = session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.palace_id == palace_id,
        PalaceQuizQuestion.deleted_at.is_(None),
    ).order_by(PalaceQuizQuestion.sort_order, PalaceQuizQuestion.id).all()
    ids = {row.id for row in rows}
    edges = session.query(PalaceQuizQuestionNodeBinding).filter(or_(
        PalaceQuizQuestionNodeBinding.palace_id == palace_id,
        PalaceQuizQuestionNodeBinding.question_id.in_(ids),
    )).all()
    for edge in edges:
        owner = session.get(PalaceQuizQuestion, edge.question_id)
        if owner is None or owner.palace_id != palace_id or edge.palace_id != palace_id:
            raise _error("external question ownership or binding target is unsupported")
    return rows, edges


def validate_article_quiz_target(session: Session, palace_id: int, target_uids: Iterable[str]) -> None:
    """Reject replacement that removes any bound node, including deleted questions."""
    _palace(session, palace_id)
    _rows, edges = _closure(session, palace_id)
    missing = {edge.node_uid for edge in edges} - set(target_uids)
    if missing:
        raise _error(f"replacement removes bound nodes: {', '.join(sorted(missing))}")


def export_article_quiz(session: Session, palace_id: int) -> dict[str, Any]:
    palace = _palace(session, palace_id)
    nodes, _labels = collect_node_descendants(palace.editor_doc)
    rows, edges = _closure(session, palace_id)
    questions = []
    identities: dict[int, str] = {}
    segment_catalog: dict[int, dict[str, Any]] | None = None
    for row in rows:
        _supported(row)
        item = {key: getattr(row, key) for key in _SCALAR_FIELDS}
        item.update({key: _json(getattr(row, column)) for key, column in _JSON_FIELDS.items()})
        uid = _row_identity(row, palace)
        if uid in identities.values():
            raise _error("duplicate stored question UUID")
        identities[row.id] = uid
        item["uid"] = uid
        segment_ids = list(session.scalars(select(palace_quiz_question_segment_table.c.segment_id).where(
            palace_quiz_question_segment_table.c.question_id == row.id,
        )))
        item["segments"] = []
        if segment_ids:
            if segment_catalog is None:
                segment_catalog = {entry["id"]: {key: value for key, value in entry.items() if key != "id"}
                                   for entry in _segments(session, palace_id)}
            for segment_id in segment_ids:
                if segment_id not in segment_catalog:
                    raise _error("segment belongs to an external owner")
                descriptor = _segment_descriptor(segment_catalog[segment_id])
                if set(descriptor["node_uids"]) - set(nodes):
                    raise _error("segment points to a missing article node")
                item["segments"].append(descriptor)
        _validate_question(item)
        questions.append(item)
    bindings = []
    for edge in edges:
        if edge.node_uid not in nodes:
            raise _error("binding points to a missing article node")
        if edge.question_id not in identities:  # Deleted history is deliberately not portable.
            continue
        bindings.append({
            "question_uid": identities[edge.question_id], "node_uid": edge.node_uid,
            "confidence": edge.confidence, "reason": edge.reason, "source": edge.source,
        })
    all_segments = [_segment_descriptor({key: value for key, value in entry.items() if key != "id"})
                    for entry in _segments(session, palace_id)]
    if any(set(entry["node_uids"]) - set(nodes) for entry in all_segments):
        raise _error("segment points to a missing article node")
    result = {"format": FORMAT, "questions": questions, "bindings": bindings, "segments": all_segments}
    result["source_revision"] = _revision(result)
    return result


def _revision(payload: dict[str, Any]) -> str:
    canonical = json.dumps({key: value for key, value in payload.items() if key != "source_revision"},
                           sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_article_quiz_revision(session: Session, palace_id: int, payload: dict[str, Any]) -> None:
    """Call before changing article content/segments in the caller's transaction."""
    expected = payload.get("source_revision")
    if not isinstance(expected, str) or expected != export_article_quiz(session, palace_id)["source_revision"]:
        raise _error("quiz changed since export; re-export before replacing")


def _validate_question(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict) or set(item) - _QUESTION_KEYS:
        raise _error("unsupported question fields")
    item = deepcopy(item)
    item["uid"] = _uuid(item.get("uid"))
    for key, default in (("options", []), ("answer_payload", {}), ("source_meta", {}),
                         ("evidence", []), ("knowledge_tags", []), ("quality_review", {})):
        item.setdefault(key, default)
        if not isinstance(item[key], type(default)):
            raise _error(f"invalid {key}")
    item.setdefault("segments", [])
    if not isinstance(item["segments"], list):
        raise _error("segments must be a list")
    item["segments"] = [_segment_descriptor(raw) for raw in item["segments"]]
    if len({_segment_key(raw) for raw in item["segments"]}) != len(item["segments"]):
        raise _error("duplicate segment descriptor")
    _portable(item)
    normalized = normalize_question_content(item)
    # Normalization must not silently discard nested fields or change the answer.
    for key in ("question_type", "stem", "options", "answer_payload", "analysis"):
        item.setdefault(key, normalized[key])
        if item[key] != normalized[key]:
            raise _error(f"noncanonical or unsupported {key}")
    defaults = {"lifecycle_status": "published", "cognitive_level": "recall", "difficulty": 3,
                "quality_score": None, "version_number": 1, "sort_order": 0, "marked": False}
    for key, scalar_default in defaults.items():
        item.setdefault(key, scalar_default)
    if not isinstance(item["lifecycle_status"], str) or item["lifecycle_status"] not in {"draft", "published", "rejected", "archived"}:
        raise _error("invalid lifecycle_status")
    for key in ("difficulty", "version_number", "sort_order"):
        if type(item[key]) is not int:
            raise _error(f"invalid {key}")
    if not 1 <= item["difficulty"] <= 5 or item["version_number"] < 1:
        raise _error("invalid difficulty or version_number")
    if not isinstance(item["cognitive_level"], str) or type(item["marked"]) is not bool:
        raise _error("invalid cognitive_level or marked")
    score = item["quality_score"]
    if score is not None and (type(score) not in (int, float) or not math.isfinite(score)):
        raise _error("invalid quality_score")
    manual = item["source_meta"].get("manual_import")
    if manual is not None and not isinstance(manual, dict):
        raise _error("invalid manual_import metadata")
    stored_uid = _identity(item["source_meta"])
    if stored_uid is not None and stored_uid != item["uid"]:
        raise _error("question UUID conflicts with metadata identity")
    return item


def import_article_quiz(
    session: Session, palace_id: int, payload: dict[str, Any], uid_map: dict[str, str],
    *, same_owner: bool,
) -> dict[str, Any]:
    """Merge explicit question UUIDs or clone; flush only, never commit.

    Caller validates source_revision for same-owner imports BEFORE changing any
    content, then installs target document/segments and rolls back its UnitOfWork on
    failure. Questions absent from the package and all their bindings survive.
    """
    palace = _palace(session, palace_id)
    nodes, _labels = collect_node_descendants(palace.editor_doc)
    if not isinstance(payload, dict) or set(payload) - {"format", "questions", "bindings", "segments", "source_revision"} or not {"format", "questions", "bindings"} <= set(payload):
        raise _error("invalid package envelope")
    if payload["format"] != FORMAT or not isinstance(payload["questions"], list) or not isinstance(payload["bindings"], list):
        raise _error("unsupported format or invalid collections")
    questions = [_validate_question(item) for item in payload["questions"]]
    incoming = {item["uid"] for item in questions}
    if len(incoming) != len(questions):
        raise _error("duplicate question UUID")
    package_segments = payload.get("segments", [])
    if not isinstance(package_segments, list):
        raise _error("segments must be a list")
    package_segment_keys = {_segment_key(_segment_descriptor(raw)) for raw in package_segments}
    if len(package_segment_keys) != len(package_segments):
        raise _error("duplicate segment descriptor")
    target_segments: dict[str, list[int]] = {}
    if package_segments or any(item["segments"] for item in questions):
        for segment in _segments(session, palace_id):
            descriptor = {key: value for key, value in segment.items() if key != "id"}
            target_segments.setdefault(_segment_key(descriptor), []).append(segment["id"])
    resolved_segments: dict[str, list[int]] = {}
    def resolve_segment(raw: dict[str, Any]) -> int:
        if any(node not in uid_map for node in raw["node_uids"]):
            raise _error("segment node is outside package closure")
        mapped = {**raw, "node_uids": [uid_map[node] for node in raw["node_uids"]]}
        if set(mapped["node_uids"]) - set(nodes):
            raise _error("segment node is absent from target document")
        matches = target_segments.get(_segment_key(mapped), [])
        if len(matches) != 1:
            raise _error("target segment is missing or ambiguous; restore content segments first")
        return matches[0]
    for descriptor in package_segments:
        resolve_segment(descriptor)
    for item in questions:
        if any(_segment_key(raw) not in package_segment_keys for raw in item["segments"]):
            raise _error("question segment is outside package closure")
        resolved_segments[item["uid"]] = [resolve_segment(raw) for raw in item["segments"]]
    rows, _edges = _closure(session, palace_id)
    existing: dict[str, PalaceQuizQuestion] = {}
    for row in rows:
        identity = _row_identity(row, palace)
        if identity:
            if identity in existing:
                raise _error("duplicate stored question UUID")
            existing[identity] = row
    bindings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in payload["bindings"]:
        if not isinstance(raw, dict) or set(raw) - _BINDING_KEYS:
            raise _error("unsupported binding fields")
        uid = _uuid(raw.get("question_uid"))
        node = raw.get("node_uid")
        if uid not in incoming or not isinstance(node, str) or node not in uid_map:
            raise _error("binding is outside package question/node closure")
        target = uid_map[node]
        if not isinstance(target, str) or target not in nodes:
            raise _error("mapped binding node is absent from target document")
        if (uid, target) in seen:
            raise _error("duplicate or collapsed binding")
        seen.add((uid, target))
        confidence = raw.get("confidence")
        if confidence is not None and (type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise _error("invalid binding confidence")
        reason, source = raw.get("reason", ""), raw.get("source", "manual")
        if not isinstance(reason, str) or not isinstance(source, str) or source not in {"manual", "ai"}:
            raise _error("invalid binding reason/source")
        bindings.append({"question_uid": uid, "node_uid": target, "confidence": confidence,
                         "reason": reason, "source": source})
    for item in questions:
        if same_owner and item["uid"] in existing:
            _supported(existing[item["uid"]])
    # All input and relationship validation precedes the first mutation.
    imported: dict[str, PalaceQuizQuestion] = {}
    result_uids: dict[str, str] = {}
    created = 0
    for item in questions:
        old_uid = item["uid"]
        matched = existing.get(old_uid) if same_owner else None
        if matched is None:
            row = PalaceQuizQuestion(palace_id=palace_id)
            session.add(row)
            created += 1
        else:
            row = matched
        new_uid = old_uid if same_owner else str(uuid4())
        meta = item["source_meta"]
        manual = meta.get("manual_import")
        if manual is not None and not isinstance(manual, dict):
            raise _error("invalid manual_import metadata")
        meta["manual_import"] = {**(manual or {}), _UID_KEY: new_uid}
        for key in _SCALAR_FIELDS:
            setattr(row, key, item[key])
        for key, column in _JSON_FIELDS.items():
            setattr(row, column, json.dumps(item[key], ensure_ascii=False, allow_nan=False))
        imported[old_uid] = row
        result_uids[old_uid] = new_uid
    session.flush()
    for old_uid, row in imported.items():
        session.execute(delete(palace_quiz_question_segment_table).where(
            palace_quiz_question_segment_table.c.question_id == row.id,
        ))
        for segment_id in resolved_segments[old_uid]:
            session.execute(insert(palace_quiz_question_segment_table).values(
                question_id=row.id, segment_id=segment_id,
            ))
        session.expire(row, ["segments"])
        for edge in session.query(PalaceQuizQuestionNodeBinding).filter_by(question_id=row.id).all():
            session.delete(edge)
    session.flush()
    for binding in bindings:
        values = {key: value for key, value in binding.items() if key != "question_uid"}
        session.add(PalaceQuizQuestionNodeBinding(
            palace_id=palace_id, question_id=imported[binding["question_uid"]].id, **values,
        ))
    session.flush()
    return {"question_count": len(questions), "binding_count": len(bindings),
            "created_count": created, "updated_count": len(questions) - created,
            "question_uid_map": result_uids}
