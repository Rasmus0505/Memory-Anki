import json
from collections.abc import Collection
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import SessionProgress


def _serialize_json(value: Any, fallback: str) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return fallback


def _deserialize_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _progress_json(progress: SessionProgress | None) -> dict | None:
    if progress is None:
        return None
    return {
        "id": progress.id,
        "session_kind": progress.session_kind,
        "palace_id": progress.palace_id,
        "review_schedule_id": progress.review_schedule_id,
        "palace_segment_id": getattr(progress, "palace_segment_id", None),
        "mini_palace_id": getattr(progress, "mini_palace_id", None),
        "palace_segment_review_schedule_id": getattr(progress, "palace_segment_review_schedule_id", None),
        "mini_palace_review_schedule_id": getattr(progress, "mini_palace_review_schedule_id", None),
        "reveal_map": _deserialize_json(progress.reveal_map, {}),
        "red_node_ids": _deserialize_json(progress.red_node_ids, []),
        "completed": bool(progress.completed),
        "updated_at": progress.updated_at.isoformat() if progress.updated_at else None,
    }


def calculate_reveal_progress(
    progress: dict | None,
    valid_node_uids: Collection[str],
) -> float | None:
    if progress is None or progress.get("completed"):
        return None
    reveal_map = progress.get("reveal_map")
    if not isinstance(reveal_map, dict):
        return None
    valid_ids = {
        str(uid).strip()
        for uid in valid_node_uids
        if str(uid).strip()
    }
    total = len(valid_ids)
    if total <= 0:
        return None
    revealed = sum(1 for uid in valid_ids if reveal_map.get(uid) == "revealed")
    return max(0.0, min(revealed / total, 1.0))


def get_practice_progress(session: Session, palace_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="practice", palace_id=palace_id)
        .first()
    )
    return _progress_json(progress)


def get_review_progress(session: Session, schedule_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="review", review_schedule_id=schedule_id)
        .first()
    )
    return _progress_json(progress)


def get_focus_practice_progress(session: Session, palace_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="focus_practice", palace_id=palace_id)
        .first()
    )
    return _progress_json(progress)


def get_segment_practice_progress(session: Session, segment_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="segment_practice", palace_segment_id=segment_id)
        .first()
    )
    return _progress_json(progress)


def get_mini_practice_progress(session: Session, mini_palace_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="mini_practice", mini_palace_id=mini_palace_id)
        .first()
    )
    return _progress_json(progress)


def get_segment_review_progress(session: Session, schedule_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(
            session_kind="segment_review",
            palace_segment_review_schedule_id=schedule_id,
        )
        .first()
    )
    return _progress_json(progress)


def get_mini_review_progress(session: Session, schedule_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(
            session_kind="mini_review",
            mini_palace_review_schedule_id=schedule_id,
        )
        .first()
    )
    return _progress_json(progress)


def upsert_practice_progress(session: Session, palace_id: int, payload: dict) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="practice", palace_id=palace_id)
        .first()
    )
    if progress is None:
        progress = SessionProgress(session_kind="practice", palace_id=palace_id)
        session.add(progress)

    progress.review_schedule_id = None
    progress.palace_segment_id = None
    progress.mini_palace_id = None
    progress.palace_segment_review_schedule_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_review_progress(session: Session, schedule_id: int, palace_id: int | None, payload: dict) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="review", review_schedule_id=schedule_id)
        .first()
    )
    if progress is None:
        progress = SessionProgress(
            session_kind="review",
            review_schedule_id=schedule_id,
        )
        session.add(progress)

    progress.palace_id = palace_id
    progress.palace_segment_id = None
    progress.mini_palace_id = None
    progress.palace_segment_review_schedule_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_focus_practice_progress(session: Session, palace_id: int, payload: dict) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="focus_practice", palace_id=palace_id)
        .first()
    )
    if progress is None:
        progress = SessionProgress(session_kind="focus_practice", palace_id=palace_id)
        session.add(progress)

    progress.review_schedule_id = None
    progress.palace_segment_id = None
    progress.mini_palace_id = None
    progress.palace_segment_review_schedule_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_segment_practice_progress(
    session: Session,
    segment_id: int,
    palace_id: int | None,
    payload: dict,
) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="segment_practice", palace_segment_id=segment_id)
        .first()
    )
    if progress is None:
        progress = SessionProgress(
            session_kind="segment_practice",
            palace_segment_id=segment_id,
        )
        session.add(progress)

    progress.palace_id = palace_id
    progress.review_schedule_id = None
    progress.palace_segment_review_schedule_id = None
    progress.mini_palace_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_segment_review_progress(
    session: Session,
    schedule_id: int,
    segment_id: int,
    palace_id: int | None,
    payload: dict,
) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(
            session_kind="segment_review",
            palace_segment_review_schedule_id=schedule_id,
        )
        .first()
    )
    if progress is None:
        progress = SessionProgress(
            session_kind="segment_review",
            palace_segment_review_schedule_id=schedule_id,
        )
        session.add(progress)

    progress.palace_id = palace_id
    progress.review_schedule_id = None
    progress.palace_segment_id = segment_id
    progress.mini_palace_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_mini_practice_progress(
    session: Session,
    mini_palace_id: int,
    palace_id: int | None,
    payload: dict,
) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="mini_practice", mini_palace_id=mini_palace_id)
        .first()
    )
    if progress is None:
        progress = SessionProgress(
            session_kind="mini_practice",
            mini_palace_id=mini_palace_id,
        )
        session.add(progress)

    progress.palace_id = palace_id
    progress.review_schedule_id = None
    progress.palace_segment_id = None
    progress.palace_segment_review_schedule_id = None
    progress.mini_palace_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def upsert_mini_review_progress(
    session: Session,
    schedule_id: int,
    mini_palace_id: int,
    palace_id: int | None,
    payload: dict,
) -> dict:
    progress = (
        session.query(SessionProgress)
        .filter_by(
            session_kind="mini_review",
            mini_palace_review_schedule_id=schedule_id,
        )
        .first()
    )
    if progress is None:
        progress = SessionProgress(
            session_kind="mini_review",
            mini_palace_review_schedule_id=schedule_id,
        )
        session.add(progress)

    progress.palace_id = palace_id
    progress.review_schedule_id = None
    progress.palace_segment_id = None
    progress.mini_palace_id = mini_palace_id
    progress.palace_segment_review_schedule_id = None
    progress.reveal_map = _serialize_json(payload.get("reveal_map") or {}, "{}")
    progress.red_node_ids = _serialize_json(payload.get("red_node_ids") or [], "[]")
    progress.completed = bool(payload.get("completed", False))
    progress.updated_at = utc_now_naive()
    session.commit()
    session.refresh(progress)
    return _progress_json(progress) or {}


def clear_practice_progress(session: Session, palace_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(session_kind="practice", palace_id=palace_id)
        .delete()
    )
    session.commit()


def clear_review_progress(session: Session, schedule_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(session_kind="review", review_schedule_id=schedule_id)
        .delete()
    )
    session.commit()


def clear_focus_practice_progress(session: Session, palace_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(session_kind="focus_practice", palace_id=palace_id)
        .delete()
    )
    session.commit()


def clear_segment_practice_progress(session: Session, segment_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(session_kind="segment_practice", palace_segment_id=segment_id)
        .delete()
    )
    session.commit()


def clear_segment_review_progress(session: Session, schedule_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(
            session_kind="segment_review",
            palace_segment_review_schedule_id=schedule_id,
        )
        .delete()
    )
    session.commit()


def clear_mini_practice_progress(session: Session, mini_palace_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(session_kind="mini_practice", mini_palace_id=mini_palace_id)
        .delete()
    )
    session.commit()


def clear_mini_review_progress(session: Session, schedule_id: int) -> None:
    (
        session.query(SessionProgress)
        .filter_by(
            session_kind="mini_review",
            mini_palace_review_schedule_id=schedule_id,
        )
        .delete()
    )
    session.commit()
