from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import PalaceQuizOcrSource

from .question_contracts import json_dump, json_load
from .question_lookup_queries import get_palace_or_raise


SOURCE_SET_ORDER = {
    "zhongjiao_questions": 10,
    "waijiao_questions": 10,
    "questions": 10,
    "image_upload": 10,
    "text_files": 10,
    "zhongjiao_answers": 20,
    "waijiao_answers": 20,
    "answers": 20,
}


def normalize_ocr_source_payload(payload: dict[str, Any]) -> dict[str, Any]:
    source_set = str(payload.get("source_set") or "").strip()
    page_key = str(payload.get("page_key") or "").strip()
    import_batch = str(payload.get("import_batch") or "").strip()
    if not source_set or not page_key or not import_batch:
        raise ValueError("OCR source requires source_set, page_key, and import_batch.")
    page_number = payload.get("page_number")
    try:
        normalized_page_number = int(page_number) if page_number not in (None, "") else None
    except (TypeError, ValueError):
        normalized_page_number = None
    lines = payload.get("lines")
    source_meta = payload.get("source_meta")
    return {
        "source_kind": str(payload.get("source_kind") or "ocr").strip() or "ocr",
        "source_set": source_set,
        "page_key": page_key,
        "page_number": normalized_page_number,
        "image_path": str(payload.get("image_path") or "").strip(),
        "raw_text": str(payload.get("raw_text") or ""),
        "lines_json": json_dump(lines if isinstance(lines, list) else [], default=[]),
        "source_meta_json": json_dump(source_meta if isinstance(source_meta, dict) else {}, default={}),
        "import_batch": import_batch,
    }


def upsert_palace_ocr_sources(
    session: Session,
    *,
    palace_id: int,
    payloads: list[dict[str, Any]],
) -> list[PalaceQuizOcrSource]:
    get_palace_or_raise(session, palace_id)
    rows: list[PalaceQuizOcrSource] = []
    for payload in payloads:
        normalized = normalize_ocr_source_payload(payload)
        row = (
            session.query(PalaceQuizOcrSource)
            .filter_by(
                palace_id=palace_id,
                source_set=normalized["source_set"],
                page_key=normalized["page_key"],
                import_batch=normalized["import_batch"],
            )
            .first()
        )
        if row is None:
            row = PalaceQuizOcrSource(palace_id=palace_id)
            session.add(row)
        row.source_kind = normalized["source_kind"]
        row.source_set = normalized["source_set"]
        row.page_key = normalized["page_key"]
        row.page_number = normalized["page_number"]
        row.image_path = normalized["image_path"]
        row.raw_text = normalized["raw_text"]
        row.lines_json = normalized["lines_json"]
        row.source_meta_json = normalized["source_meta_json"]
        row.import_batch = normalized["import_batch"]
        row.updated_at = utc_now_naive()
        rows.append(row)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows


def serialize_ocr_source(row: PalaceQuizOcrSource) -> dict[str, Any]:
    return {
        "id": row.id,
        "palace_id": row.palace_id,
        "source_kind": row.source_kind,
        "source_set": row.source_set,
        "page_key": row.page_key,
        "page_number": row.page_number,
        "image_path": row.image_path,
        "raw_text": row.raw_text,
        "lines": json_load(row.lines_json, []),
        "source_meta": json_load(row.source_meta_json, {}),
        "import_batch": row.import_batch,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_palace_ocr_sources(session: Session, palace_id: int) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    rows = session.query(PalaceQuizOcrSource).filter_by(palace_id=palace_id).all()
    rows.sort(
        key=lambda row: (
            SOURCE_SET_ORDER.get(str(row.source_set), 50),
            str(row.source_set),
            row.page_number if row.page_number is not None else 10**9,
            str(row.page_key),
            row.id,
        )
    )
    return [serialize_ocr_source(row) for row in rows]


__all__ = [
    "list_palace_ocr_sources",
    "serialize_ocr_source",
    "upsert_palace_ocr_sources",
]
