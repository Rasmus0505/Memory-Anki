"""Commands for the AI variant history and the 待换题 mark."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion
from memory_anki.modules.quiz.application.question_contracts import (
    PalaceQuizValidationError,
    json_dump,
)

from .question_variants import (
    ACTIVE_VERSION_ORIGINAL,
    QuestionVariantError,
    json_variants,
    next_version_id,
    normalize_import_item,
    resolved_active_version_id,
    serialize_versions_payload,
)
from .questions.queries import get_question_or_raise
from .questions.serialization import serialize_question


def _require_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise PalaceQuizValidationError(f"{field} must be true or false")
    return value


def set_mutation_mark(
    session: Session,
    question_id: int,
    needs_mutation: bool,
    *,
    commit: bool = True,
) -> dict[str, Any]:
    marked = _require_bool(needs_mutation, "needs_mutation")
    question = get_question_or_raise(session, question_id)
    now = utc_now_naive()
    question.needs_mutation = marked
    question.mutation_marked_at = now if marked else None
    question.updated_at = now
    if commit:
        session.commit()
        session.refresh(question)
    else:
        session.flush()
    return serialize_question(question)


def activate_variant(
    session: Session,
    question_id: int,
    version_id: str,
    *,
    commit: bool = True,
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    target = str(version_id or "").strip() or ACTIVE_VERSION_ORIGINAL
    if target != ACTIVE_VERSION_ORIGINAL:
        if not any(
            str(variant.get("version_id")) == target
            for variant in json_variants(question)
        ):
            raise PalaceQuizValidationError("选择的题目版本不存在。")
    now = utc_now_naive()
    question.active_variant_id = target
    question.variant_activated_at = now
    question.consecutive_correct_count = 0
    question.last_answer_duration_ms = None
    if target != ACTIVE_VERSION_ORIGINAL:
        # A freshly displayed variant restarts the muscle-memory check.
        question.needs_mutation = False
        question.mutation_marked_at = None
    question.updated_at = now
    if commit:
        session.commit()
        session.refresh(question)
    else:
        session.flush()
    return serialize_question(question)


def delete_variant(
    session: Session,
    question_id: int,
    version_id: str,
    *,
    commit: bool = True,
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    target = str(version_id or "").strip()
    if target == ACTIVE_VERSION_ORIGINAL:
        raise PalaceQuizValidationError("原始真题不能删除。")
    variants = json_variants(question)
    remaining = [
        variant
        for variant in variants
        if str(variant.get("version_id")) != target
    ]
    if len(remaining) == len(variants):
        raise PalaceQuizValidationError("要删除的题目版本不存在。")
    now = utc_now_naive()
    was_active = str(getattr(question, "active_variant_id", ACTIVE_VERSION_ORIGINAL)) == target
    question.variant_history_json = json_dump(remaining, default=[])
    if was_active:
        question.active_variant_id = ACTIVE_VERSION_ORIGINAL
        question.variant_activated_at = now
        question.consecutive_correct_count = 0
        question.last_answer_duration_ms = None
    question.updated_at = now
    if commit:
        session.commit()
        session.refresh(question)
    else:
        session.flush()
    return serialize_question(question)


def list_versions(session: Session, question_id: int) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    return serialize_versions_payload(question)


def _question_for_item(
    session: Session,
    raw: Any,
    updated: dict[int, PalaceQuizQuestion],
) -> tuple[PalaceQuizQuestion | None, int | None, str]:
    if not isinstance(raw, dict):
        return None, None, "每道题必须是一个对象。"
    raw_id = raw.get("question_id", raw.get("id"))
    if raw_id is None:
        return None, None, "question_id 不合法。"
    try:
        question_id = int(raw_id)
    except (TypeError, ValueError):
        return None, None, "question_id 不合法。"
    question = updated.get(question_id)
    if question is None:
        question = session.get(PalaceQuizQuestion, question_id)
    if question is None or question.deleted_at is not None:
        return None, question_id, "题目不存在或已删除。"
    return question, question_id, ""


def _prepare_one(
    session: Session,
    raw: Any,
    updated: dict[int, PalaceQuizQuestion],
    preview_variants: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    question, question_id, error = _question_for_item(session, raw, updated)
    if question is None or question_id is None:
        return {
            "question_id": question_id,
            "status": "skipped",
            "code": "missing_question",
            "reason": error,
        }
    active = resolved_active_version_id(question)
    try:
        normalized = normalize_import_item(
            raw,
            question,
            active_version_id=active,
        )
    except QuestionVariantError as exc:
        return {
            "question_id": question_id,
            "status": "skipped",
            "code": exc.code,
            "reason": str(exc),
        }
    variants = preview_variants.get(
        question_id,
        json_variants(question),
    )
    version_id = next_version_id(variants)
    record = {
        **normalized,
        "version_id": version_id,
        "created_at": utc_now_naive().isoformat(),
    }
    preview_variants[question_id] = [*variants, record]
    return {
        "question_id": question_id,
        "status": "imported",
        "version_id": version_id,
        "question_type": record["question_type"],
        "stem": record["stem"],
        "record": record,
    }


def import_variants(
    session: Session,
    items: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    if not isinstance(items, list) or not items:
        raise PalaceQuizValidationError("导入时至少需要一道题目。")
    results: list[dict[str, Any]] = []
    updated: dict[int, PalaceQuizQuestion] = {}
    preview_variants: dict[int, list[dict[str, Any]]] = {}
    now = utc_now_naive()

    for raw in items:
        result = _prepare_one(session, raw, updated, preview_variants)
        if result["status"] == "imported" and not dry_run:
            question = updated.get(int(result["question_id"]))
            if question is None:
                question = session.get(PalaceQuizQuestion, int(result["question_id"]))
            if question is None:
                result = {
                    "question_id": result["question_id"],
                    "status": "skipped",
                    "code": "missing_question",
                    "reason": "题目不存在或已删除。",
                }
            else:
                record = result.pop("record")
                variants = json_variants(question)
                variants.append(record)
                question.variant_history_json = json_dump(variants, default=[])
                question.active_variant_id = str(record["version_id"])
                question.variant_activated_at = now
                question.needs_mutation = False
                question.mutation_marked_at = None
                question.consecutive_correct_count = 0
                question.last_answer_duration_ms = None
                question.updated_at = now
                updated[int(result["question_id"])] = question
        elif result["status"] == "imported":
            result.pop("record", None)
        results.append(result)

    imported_ids = [int(result["question_id"]) for result in results if result["status"] == "imported"]
    if dry_run:
        if not imported_ids:
            preview_variants = {}
        return {
            "dry_run": True,
            "imported_count": len(imported_ids),
            "skipped_count": len(results) - len(imported_ids),
            "items": [],
            "results": results,
        }

    if imported_ids:
        session.commit()
        for question_id in {*imported_ids}:
            question = updated.get(question_id)
            if question is not None:
                session.refresh(question)
    return {
        "dry_run": False,
        "imported_count": len(imported_ids),
        "skipped_count": len(results) - len(imported_ids),
        "items": [
            serialize_question(question)
            for question in updated.values()
            if question.id is not None
        ],
        "results": results,
    }


__all__ = [
    "activate_variant",
    "delete_variant",
    "import_variants",
    "list_versions",
    "set_mutation_mark",
]
