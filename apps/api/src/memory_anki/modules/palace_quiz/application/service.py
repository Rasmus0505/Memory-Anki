from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
    engine,
)

QUESTION_TYPE_MULTIPLE_CHOICE = "multiple_choice"
QUESTION_TYPE_SHORT_ANSWER = "short_answer"
QUESTION_TYPE_TRUE_FALSE = "true_false"
QUESTION_TYPE_FILL_BLANK = "fill_blank"
QUESTION_TYPE_MATCHING = "matching"
QUESTION_TYPE_ORDERING = "ordering"
QUESTION_TYPE_CATEGORIZATION = "categorization"
QUESTION_TYPES = {
    QUESTION_TYPE_MULTIPLE_CHOICE,
    QUESTION_TYPE_SHORT_ANSWER,
    QUESTION_TYPE_TRUE_FALSE,
    QUESTION_TYPE_FILL_BLANK,
    QUESTION_TYPE_MATCHING,
    QUESTION_TYPE_ORDERING,
    QUESTION_TYPE_CATEGORIZATION,
}


class PalaceQuizValidationError(ValueError):
    pass


class PalaceQuizNotFoundError(LookupError):
    pass


def ensure_palace_quiz_schema() -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS palace_quiz_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                palace_id INTEGER NOT NULL,
                mini_palace_id INTEGER NULL,
                origin_question_id INTEGER NULL,
                question_type VARCHAR(32) NOT NULL DEFAULT 'multiple_choice',
                stem TEXT NOT NULL DEFAULT '',
                options_json TEXT NOT NULL DEFAULT '[]',
                answer_payload_json TEXT NOT NULL DEFAULT '{}',
                analysis TEXT NOT NULL DEFAULT '',
                source_meta_json TEXT NOT NULL DEFAULT '{}',
                sort_order INTEGER NOT NULL DEFAULT 0,
                correct_count INTEGER NOT NULL DEFAULT 0,
                incorrect_count INTEGER NOT NULL DEFAULT 0,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE,
                FOREIGN KEY(mini_palace_id) REFERENCES palace_mini_palaces(id) ON DELETE CASCADE
            )
            """
        )
        existing_columns = {
            row[1]
            for row in conn.exec_driver_sql(
                "PRAGMA table_info(palace_quiz_questions)"
            ).fetchall()
        }
        if "mini_palace_id" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE palace_quiz_questions ADD COLUMN mini_palace_id INTEGER NULL "
                "REFERENCES palace_mini_palaces(id) ON DELETE CASCADE"
            )
        if "origin_question_id" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE palace_quiz_questions ADD COLUMN origin_question_id INTEGER NULL"
            )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_palace_sort "
            "ON palace_quiz_questions (palace_id, sort_order)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_updated_at "
            "ON palace_quiz_questions (updated_at)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_mini_palace "
            "ON palace_quiz_questions (mini_palace_id)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_origin_mini "
            "ON palace_quiz_questions (origin_question_id, mini_palace_id)"
        )


def _json_dump(value: Any, *, default: Any) -> str:
    payload = default if value is None else value
    return json.dumps(payload, ensure_ascii=False)


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return default if parsed is None else parsed


def _normalize_question_type(value: Any) -> str:
    normalized = str(value or "").strip()
    if normalized not in QUESTION_TYPES:
        raise PalaceQuizValidationError(
            "题型必须是 multiple_choice、short_answer、true_false、fill_blank、matching、ordering 或 categorization。"
        )
    return normalized


def _normalize_option_id(index: int) -> str:
    if 0 <= index < 26:
        return chr(ord("A") + index)
    return f"OPTION_{index + 1}"


def _normalize_options(raw_options: Any) -> list[dict[str, str]]:
    if raw_options is None:
        return []
    if not isinstance(raw_options, list):
        raise PalaceQuizValidationError("选择题选项必须是数组。")
    normalized: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_options):
        if isinstance(item, dict):
            option_id = str(item.get("id") or "").strip() or _normalize_option_id(index)
            option_text = str(item.get("text") or "").strip()
        else:
            option_id = _normalize_option_id(index)
            option_text = str(item or "").strip()
        if not option_text:
            raise PalaceQuizValidationError("选择题每个选项都必须填写内容。")
        if option_id in seen_ids:
            raise PalaceQuizValidationError("选择题选项 id 不能重复。")
        seen_ids.add(option_id)
        normalized.append({"id": option_id, "text": option_text})
    return normalized


def _normalize_source_meta(raw_source_meta: Any) -> dict[str, Any]:
    now_iso = utc_now_naive().isoformat()
    source_meta = raw_source_meta if isinstance(raw_source_meta, dict) else {}
    source_kind = str(source_meta.get("source_kind") or "manual").strip() or "manual"
    generation_mode = str(source_meta.get("generation_mode") or source_kind).strip() or source_kind
    page_numbers_raw = source_meta.get("page_numbers")
    image_names_raw = source_meta.get("image_names")
    page_numbers = (
        sorted({int(item) for item in page_numbers_raw if int(item) > 0})
        if isinstance(page_numbers_raw, list)
        else None
    )
    image_names = (
        [str(item).strip() for item in image_names_raw if str(item).strip()]
        if isinstance(image_names_raw, list)
        else None
    )
    subject_document_id_raw = source_meta.get("subject_document_id")
    subject_document_id = (
        int(subject_document_id_raw)
        if subject_document_id_raw not in (None, "", 0, "0")
        else None
    )
    raw_pdf_sources = source_meta.get("pdf_sources")
    pdf_sources: list[dict[str, Any]] | None = None
    if isinstance(raw_pdf_sources, list):
        normalized_pdf_sources: list[dict[str, Any]] = []
        for item in raw_pdf_sources:
            if not isinstance(item, dict):
                continue
            subject_document_id_value = item.get("subject_document_id")
            try:
                subject_document_id_item = (
                    int(subject_document_id_value)
                    if subject_document_id_value not in (None, "", 0, "0")
                    else None
                )
            except (TypeError, ValueError):
                subject_document_id_item = None
            page_numbers_raw = item.get("page_numbers")
            page_numbers_item = (
                sorted({int(page) for page in page_numbers_raw if int(page) > 0})
                if isinstance(page_numbers_raw, list)
                else None
            )
            image_names_raw = item.get("image_names")
            image_names_item = (
                [str(name).strip() for name in image_names_raw if str(name).strip()]
                if isinstance(image_names_raw, list)
                else None
            )
            document_name = str(item.get("document_name") or "").strip() or None
            role_hint = str(item.get("role_hint") or "").strip() or None
            if (
                subject_document_id_item is None
                and not page_numbers_item
                and not image_names_item
                and not document_name
            ):
                continue
            normalized_pdf_sources.append(
                {
                    "subject_document_id": subject_document_id_item,
                    "document_name": document_name,
                    "page_numbers": page_numbers_item,
                    "image_names": image_names_item,
                    "role_hint": role_hint,
                }
            )
        if normalized_pdf_sources:
            pdf_sources = normalized_pdf_sources
    if pdf_sources is None and subject_document_id is not None:
        pdf_sources = [
            {
                "subject_document_id": subject_document_id,
                "document_name": str(source_meta.get("document_name") or "").strip() or None,
                "page_numbers": page_numbers,
                "image_names": image_names,
                "role_hint": str(source_meta.get("role_hint") or "").strip() or None,
            }
        ]
    flattened_page_numbers = page_numbers
    flattened_image_names = image_names
    primary_subject_document_id = subject_document_id
    if pdf_sources:
        flattened_page_numbers = sorted(
            {
                page
                for item in pdf_sources
                for page in (item.get("page_numbers") or [])
                if isinstance(page, int) and page > 0
            }
        ) or None
        flattened_image_names_list = [
            str(name).strip()
            for item in pdf_sources
            for name in (item.get("image_names") or [])
            if str(name).strip()
        ]
        flattened_image_names = flattened_image_names_list or None
        primary_subject_document_id = next(
            (
                int(item["subject_document_id"])
                for item in pdf_sources
                if item.get("subject_document_id") not in (None, "", 0, "0")
            ),
            subject_document_id,
        )
    related_palace_ids_raw = source_meta.get("related_palace_ids")
    related_palace_ids = (
        sorted({int(item) for item in related_palace_ids_raw if int(item) > 0})
        if isinstance(related_palace_ids_raw, list)
        else None
    )
    question_types_raw = source_meta.get("question_types")
    question_types = (
        [str(item).strip() for item in question_types_raw if str(item).strip()]
        if isinstance(question_types_raw, list)
        else None
    )
    question_count_raw = source_meta.get("question_count")
    try:
        question_count = (
            int(question_count_raw)
            if question_count_raw not in (None, "", 0, "0")
            else None
        )
    except (TypeError, ValueError):
        question_count = None
    related_palace_summaries = (
        [item for item in source_meta.get("related_palace_summaries") if isinstance(item, dict)]
        if isinstance(source_meta.get("related_palace_summaries"), list)
        else None
    )
    return {
        "source_kind": source_kind,
        "subject_document_id": primary_subject_document_id,
        "page_numbers": flattened_page_numbers,
        "image_names": flattened_image_names,
        "extra_prompt": str(source_meta.get("extra_prompt") or "").strip(),
        "ai_call_log_id": str(source_meta.get("ai_call_log_id") or "").strip() or None,
        "generated_at": str(source_meta.get("generated_at") or now_iso),
        "generation_mode": generation_mode,
        "pdf_sources": pdf_sources,
        "review_mode": str(source_meta.get("review_mode") or "").strip() or None,
        "related_palace_ids": related_palace_ids,
        "related_palace_summaries": related_palace_summaries,
        "question_types": question_types,
        "question_count": question_count,
    }


def _normalize_optional_int(raw_value: Any) -> int | None:
    if raw_value in (None, "", 0, "0"):
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError) as exc:
        raise PalaceQuizValidationError("题目归属标识格式不正确。") from exc


def _get_mini_palace_or_raise(
    session: Session,
    palace_id: int,
    mini_palace_id: int,
) -> PalaceMiniPalace:
    mini_palace = (
        session.query(PalaceMiniPalace)
        .filter_by(id=mini_palace_id, palace_id=palace_id)
        .first()
    )
    if not mini_palace:
        raise PalaceQuizValidationError("小宫殿不存在，或不属于当前宫殿。")
    return mini_palace


def _normalize_mini_palace_id(
    session: Session | None,
    palace_id: int | None,
    raw_value: Any,
) -> int | None:
    mini_palace_id = _normalize_optional_int(raw_value)
    if mini_palace_id is None:
        return None
    if session is None or palace_id is None:
        return mini_palace_id
    _get_mini_palace_or_raise(session, palace_id, mini_palace_id)
    return mini_palace_id


def _normalize_origin_question_id(
    session: Session | None,
    palace_id: int | None,
    raw_value: Any,
) -> int | None:
    origin_question_id = _normalize_optional_int(raw_value)
    if origin_question_id is None:
        return None
    if session is None or palace_id is None:
        return origin_question_id
    origin_question = (
        session.query(PalaceQuizQuestion)
        .filter_by(id=origin_question_id, palace_id=palace_id)
        .first()
    )
    if not origin_question:
        raise PalaceQuizValidationError("原始题目不存在，无法建立小宫殿归类副本。")
    return origin_question_id


def _normalize_answer_payload(
    question_type: str,
    raw_answer_payload: Any,
    *,
    options: list[dict[str, str]],
) -> dict[str, Any]:
    payload = raw_answer_payload if isinstance(raw_answer_payload, dict) else {}
    if question_type == QUESTION_TYPE_MULTIPLE_CHOICE:
        correct_option_id = str(payload.get("correct_option_id") or "").strip()
        if len(options) < 2:
            raise PalaceQuizValidationError("选择题至少需要 2 个选项。")
        if not correct_option_id:
            raise PalaceQuizValidationError("选择题必须指定正确选项。")
        if correct_option_id not in {item["id"] for item in options}:
            raise PalaceQuizValidationError("选择题正确选项必须出现在选项列表中。")
        return {"correct_option_id": correct_option_id}

    if question_type == QUESTION_TYPE_SHORT_ANSWER:
        reference_answer = str(payload.get("reference_answer") or "").strip()
        if not reference_answer:
            raise PalaceQuizValidationError("简答题必须填写参考答案。")
        return {"reference_answer": reference_answer}

    if question_type == QUESTION_TYPE_TRUE_FALSE:
        if "correct_answer" not in payload:
            raise PalaceQuizValidationError("判断题必须给出 correct_answer。")
        correct_answer = payload.get("correct_answer")
        if not isinstance(correct_answer, bool):
            raise PalaceQuizValidationError("判断题 correct_answer 必须是布尔值。")
        false_explanation = str(
            payload.get("false_explanation") or payload.get("error_explanation") or ""
        ).strip()
        return {
            "correct_answer": correct_answer,
            "false_explanation": false_explanation,
        }

    if question_type == QUESTION_TYPE_FILL_BLANK:
        blanks_raw = payload.get("blanks")
        if not isinstance(blanks_raw, list) or len(blanks_raw) == 0:
            raise PalaceQuizValidationError("填空题必须提供 blanks。")
        if len(blanks_raw) > 3:
            raise PalaceQuizValidationError("填空题最多支持 3 个空。")
        blanks: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for index, item in enumerate(blanks_raw):
            if not isinstance(item, dict):
                raise PalaceQuizValidationError("填空题 blanks 格式不正确。")
            blank_id = str(item.get("id") or f"blank_{index + 1}").strip()
            answer = str(item.get("answer") or "").strip()
            if not blank_id or blank_id in seen_ids or not answer:
                raise PalaceQuizValidationError("填空题每个空都必须有唯一 id 和答案。")
            aliases_raw = item.get("aliases")
            aliases = (
                [str(alias).strip() for alias in aliases_raw if str(alias).strip()]
                if isinstance(aliases_raw, list)
                else []
            )
            seen_ids.add(blank_id)
            blanks.append({"id": blank_id, "answer": answer, "aliases": aliases})
        return {"blanks": blanks}

    if question_type == QUESTION_TYPE_MATCHING:
        pairs_raw = payload.get("pairs")
        if not isinstance(pairs_raw, list) or len(pairs_raw) < 2:
            raise PalaceQuizValidationError("连线题至少需要 2 组配对。")
        pairs: list[dict[str, str]] = []
        seen_left: set[str] = set()
        seen_right: set[str] = set()
        for index, item in enumerate(pairs_raw):
            if not isinstance(item, dict):
                raise PalaceQuizValidationError("连线题 pairs 格式不正确。")
            left_id = str(item.get("left_id") or f"L{index + 1}").strip()
            right_id = str(item.get("right_id") or f"R{index + 1}").strip()
            left = str(item.get("left") or "").strip()
            right = str(item.get("right") or "").strip()
            if not left_id or not right_id or not left or not right:
                raise PalaceQuizValidationError("连线题每组配对都必须有左右文本。")
            if left_id in seen_left or right_id in seen_right:
                raise PalaceQuizValidationError("连线题左右 id 不能重复。")
            seen_left.add(left_id)
            seen_right.add(right_id)
            pairs.append(
                {"left_id": left_id, "left": left, "right_id": right_id, "right": right}
            )
        return {"pairs": pairs}

    if question_type == QUESTION_TYPE_ORDERING:
        items_raw = payload.get("items")
        correct_order_raw = payload.get("correct_order_ids") or payload.get("correct_order")
        if not isinstance(items_raw, list) or len(items_raw) < 2:
            raise PalaceQuizValidationError("排序题至少需要 2 个项目。")
        items: list[dict[str, str]] = []
        for index, item in enumerate(items_raw):
            if isinstance(item, dict):
                item_id = str(item.get("id") or f"item_{index + 1}").strip()
                text = str(item.get("text") or "").strip()
            else:
                item_id = f"item_{index + 1}"
                text = str(item or "").strip()
            if not item_id or not text:
                raise PalaceQuizValidationError("排序题每个项目都必须有文本。")
            items.append({"id": item_id, "text": text})
        item_ids = [item["id"] for item in items]
        correct_order_ids = (
            [str(item).strip() for item in correct_order_raw if str(item).strip()]
            if isinstance(correct_order_raw, list)
            else item_ids
        )
        if set(correct_order_ids) != set(item_ids) or len(correct_order_ids) != len(item_ids):
            raise PalaceQuizValidationError("排序题正确顺序必须包含全部项目 id。")
        return {"items": items, "correct_order_ids": correct_order_ids}

    categories_raw = payload.get("categories")
    items_raw = payload.get("items")
    if not isinstance(categories_raw, list) or len(categories_raw) < 2:
        raise PalaceQuizValidationError("归类题至少需要 2 个分类。")
    if not isinstance(items_raw, list) or len(items_raw) < 2:
        raise PalaceQuizValidationError("归类题至少需要 2 个待分类项目。")
    categories: list[dict[str, str]] = []
    category_ids: set[str] = set()
    for index, item in enumerate(categories_raw):
        if isinstance(item, dict):
            category_id = str(item.get("id") or f"category_{index + 1}").strip()
            name = str(item.get("name") or item.get("text") or "").strip()
        else:
            category_id = f"category_{index + 1}"
            name = str(item or "").strip()
        if not category_id or not name or category_id in category_ids:
            raise PalaceQuizValidationError("归类题分类必须有唯一 id 和名称。")
        category_ids.add(category_id)
        categories.append({"id": category_id, "name": name})
    items: list[dict[str, str]] = []
    for index, item in enumerate(items_raw):
        if not isinstance(item, dict):
            raise PalaceQuizValidationError("归类题项目格式不正确。")
        item_id = str(item.get("id") or f"item_{index + 1}").strip()
        text = str(item.get("text") or "").strip()
        category_id = str(item.get("category_id") or "").strip()
        if not item_id or not text or category_id not in category_ids:
            raise PalaceQuizValidationError("归类题每个项目都必须指向已有分类。")
        items.append({"id": item_id, "text": text, "category_id": category_id})
    return {"categories": categories, "items": items}


def normalize_question_payload(
    payload: dict[str, Any],
    *,
    default_source_meta: dict[str, Any] | None = None,
    session: Session | None = None,
    palace_id: int | None = None,
) -> dict[str, Any]:
    question_type = _normalize_question_type(payload.get("question_type"))
    stem = str(payload.get("stem") or "").strip()
    if not stem:
        raise PalaceQuizValidationError("题干不能为空。")
    options = _normalize_options(payload.get("options"))
    answer_payload_input = payload.get("answer_payload")
    if not isinstance(answer_payload_input, dict):
        answer_payload_input = {}
    if "correct_option_id" in payload and "correct_option_id" not in answer_payload_input:
        answer_payload_input["correct_option_id"] = payload.get("correct_option_id")
    if "reference_answer" in payload and "reference_answer" not in answer_payload_input:
        answer_payload_input["reference_answer"] = payload.get("reference_answer")
    for key in (
        "correct_answer",
        "false_explanation",
        "error_explanation",
        "blanks",
        "pairs",
        "items",
        "correct_order_ids",
        "correct_order",
        "categories",
    ):
        if key in payload and key not in answer_payload_input:
            answer_payload_input[key] = payload.get(key)
    answer_payload = _normalize_answer_payload(
        question_type,
        answer_payload_input,
        options=options,
    )
    if question_type != QUESTION_TYPE_MULTIPLE_CHOICE:
        options = []
    analysis = str(payload.get("analysis") or "").strip()
    source_meta_input = payload.get("source_meta")
    source_meta = _normalize_source_meta(
        source_meta_input if source_meta_input is not None else default_source_meta
    )
    mini_palace_id = _normalize_mini_palace_id(
        session,
        palace_id,
        payload.get("mini_palace_id"),
    )
    origin_question_id = _normalize_origin_question_id(
        session,
        palace_id,
        payload.get("origin_question_id"),
    )
    return {
        "question_type": question_type,
        "stem": stem,
        "options": options,
        "answer_payload": answer_payload,
        "analysis": analysis,
        "source_meta": source_meta,
        "mini_palace_id": mini_palace_id,
        "origin_question_id": origin_question_id,
    }


def serialize_question(question: PalaceQuizQuestion) -> dict[str, Any]:
    mini_palace = getattr(question, "mini_palace", None)
    return {
        "id": question.id,
        "palace_id": question.palace_id,
        "mini_palace_id": question.mini_palace_id,
        "origin_question_id": question.origin_question_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": _json_load(question.options_json, []),
        "answer_payload": _json_load(question.answer_payload_json, {}),
        "analysis": question.analysis,
        "source_meta": _json_load(question.source_meta_json, {}),
        "mini_palace": (
            {"id": mini_palace.id, "name": mini_palace.name}
            if mini_palace
            else None
        ),
        "sort_order": question.sort_order,
        "correct_count": question.correct_count,
        "incorrect_count": question.incorrect_count,
        "attempt_count": question.attempt_count,
        "created_at": question.created_at.isoformat() if question.created_at else None,
        "updated_at": question.updated_at.isoformat() if question.updated_at else None,
    }


def get_palace_or_raise(session: Session, palace_id: int) -> Palace:
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        raise PalaceQuizNotFoundError("宫殿不存在。")
    return palace


def get_question_or_raise(session: Session, question_id: int) -> PalaceQuizQuestion:
    question = session.query(PalaceQuizQuestion).filter_by(id=question_id).first()
    if not question:
        raise PalaceQuizNotFoundError("题目不存在。")
    return question


def list_questions(session: Session, palace_id: int) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    rows = (
        session.query(PalaceQuizQuestion)
        .filter_by(palace_id=palace_id)
        .order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc())
        .all()
    )
    return [serialize_question(row) for row in rows]


def list_root_questions(session: Session, palace_id: int) -> list[PalaceQuizQuestion]:
    get_palace_or_raise(session, palace_id)
    return (
        session.query(PalaceQuizQuestion)
        .filter_by(palace_id=palace_id, mini_palace_id=None)
        .order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc())
        .all()
    )


def _next_sort_order(session: Session, palace_id: int) -> int:
    current = (
        session.query(func.max(PalaceQuizQuestion.sort_order))
        .filter(PalaceQuizQuestion.palace_id == palace_id)
        .scalar()
    )
    return int(current or 0)


def create_question(
    session: Session,
    palace_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    get_palace_or_raise(session, palace_id)
    normalized = normalize_question_payload(payload, session=session, palace_id=palace_id)
    next_sort_order = _next_sort_order(session, palace_id) + 1
    row = PalaceQuizQuestion(
        palace_id=palace_id,
        mini_palace_id=normalized["mini_palace_id"],
        origin_question_id=normalized["origin_question_id"],
        question_type=normalized["question_type"],
        stem=normalized["stem"],
        options_json=_json_dump(normalized["options"], default=[]),
        answer_payload_json=_json_dump(normalized["answer_payload"], default={}),
        analysis=normalized["analysis"],
        source_meta_json=_json_dump(normalized["source_meta"], default={}),
        sort_order=next_sort_order,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return serialize_question(row)


def batch_create_questions(
    session: Session,
    palace_id: int,
    payloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    if not isinstance(payloads, list) or len(payloads) == 0:
        raise PalaceQuizValidationError("批量保存时至少需要一题。")
    next_sort_order = _next_sort_order(session, palace_id)
    rows: list[PalaceQuizQuestion] = []
    for payload in payloads:
        normalized = normalize_question_payload(
            payload,
            session=session,
            palace_id=palace_id,
        )
        next_sort_order += 1
        row = PalaceQuizQuestion(
            palace_id=palace_id,
            mini_palace_id=normalized["mini_palace_id"],
            origin_question_id=normalized["origin_question_id"],
            question_type=normalized["question_type"],
            stem=normalized["stem"],
            options_json=_json_dump(normalized["options"], default=[]),
            answer_payload_json=_json_dump(normalized["answer_payload"], default={}),
            analysis=normalized["analysis"],
            source_meta_json=_json_dump(normalized["source_meta"], default={}),
            sort_order=next_sort_order,
        )
        session.add(row)
        rows.append(row)
    session.commit()
    for row in rows:
        session.refresh(row)
    return [serialize_question(row) for row in rows]


def update_question(
    session: Session,
    question_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    normalized = normalize_question_payload(
        {
            "mini_palace_id": payload.get("mini_palace_id", question.mini_palace_id),
            "origin_question_id": payload.get("origin_question_id", question.origin_question_id),
            "question_type": payload.get("question_type", question.question_type),
            "stem": payload.get("stem", question.stem),
            "options": payload.get("options", _json_load(question.options_json, [])),
            "answer_payload": payload.get("answer_payload", _json_load(question.answer_payload_json, {})),
            "analysis": payload.get("analysis", question.analysis),
            "source_meta": payload.get("source_meta", _json_load(question.source_meta_json, {})),
        },
        session=session,
        palace_id=question.palace_id,
    )
    question.mini_palace_id = normalized["mini_palace_id"]
    question.origin_question_id = normalized["origin_question_id"]
    question.question_type = normalized["question_type"]
    question.stem = normalized["stem"]
    question.options_json = _json_dump(normalized["options"], default=[])
    question.answer_payload_json = _json_dump(normalized["answer_payload"], default={})
    question.analysis = normalized["analysis"]
    question.source_meta_json = _json_dump(normalized["source_meta"], default={})
    question.updated_at = utc_now_naive()
    session.commit()
    session.refresh(question)
    return serialize_question(question)


def delete_question(session: Session, question_id: int) -> None:
    question = get_question_or_raise(session, question_id)
    session.delete(question)
    session.commit()


def record_choice_attempt(
    session: Session,
    question_id: int,
    selected_option_id: str,
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_MULTIPLE_CHOICE:
        raise PalaceQuizValidationError("只有选择题可以累计对错统计。")
    normalized_selected_option_id = str(selected_option_id or "").strip()
    if not normalized_selected_option_id:
        raise PalaceQuizValidationError("请选择一个选项。")
    answer_payload = _json_load(question.answer_payload_json, {})
    correct_option_id = str(answer_payload.get("correct_option_id") or "").strip()
    is_correct = normalized_selected_option_id == correct_option_id
    question.attempt_count += 1
    if is_correct:
        question.correct_count += 1
    else:
        question.incorrect_count += 1
    question.updated_at = utc_now_naive()
    session.commit()
    session.refresh(question)
    return {
        "question": serialize_question(question),
        "selected_option_id": normalized_selected_option_id,
        "is_correct": is_correct,
    }


def upsert_classified_question_copy(
    session: Session,
    *,
    source_question: PalaceQuizQuestion,
    mini_palace_id: int,
) -> PalaceQuizQuestion:
    _get_mini_palace_or_raise(session, source_question.palace_id, mini_palace_id)
    existing = (
        session.query(PalaceQuizQuestion)
        .filter_by(
            palace_id=source_question.palace_id,
            mini_palace_id=mini_palace_id,
            origin_question_id=source_question.id,
        )
        .first()
    )
    if existing:
        row = existing
    else:
        row = PalaceQuizQuestion(
            palace_id=source_question.palace_id,
            mini_palace_id=mini_palace_id,
            origin_question_id=source_question.id,
            sort_order=_next_sort_order(session, source_question.palace_id) + 1,
        )
        session.add(row)
    row.question_type = source_question.question_type
    row.stem = source_question.stem
    row.options_json = source_question.options_json
    row.answer_payload_json = source_question.answer_payload_json
    row.analysis = source_question.analysis
    row.source_meta_json = source_question.source_meta_json
    row.updated_at = utc_now_naive()
    session.flush()
    return row
