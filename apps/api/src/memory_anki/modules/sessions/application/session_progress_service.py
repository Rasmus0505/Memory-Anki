import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import SessionProgress, engine


def ensure_session_progress_schema() -> None:
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "session_progress" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE session_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_kind VARCHAR(20) NOT NULL,
                    palace_id INTEGER NULL,
                    review_schedule_id INTEGER NULL,
                    palace_segment_id INTEGER NULL,
                    palace_segment_review_schedule_id INTEGER NULL,
                    reveal_map TEXT DEFAULT '{}',
                    red_node_ids TEXT DEFAULT '[]',
                    completed BOOLEAN DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_practice "
                "ON session_progress (session_kind, palace_id) "
                "WHERE session_kind = 'practice' AND palace_id IS NOT NULL"
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_review "
                "ON session_progress (session_kind, review_schedule_id) "
                "WHERE session_kind = 'review' AND review_schedule_id IS NOT NULL"
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_practice "
                "ON session_progress (session_kind, palace_segment_id) "
                "WHERE session_kind = 'segment_practice' AND palace_segment_id IS NOT NULL"
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_review "
                "ON session_progress (session_kind, palace_segment_review_schedule_id) "
                "WHERE session_kind = 'segment_review' AND palace_segment_review_schedule_id IS NOT NULL"
            )
            return

        existing_columns = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info(session_progress)").fetchall()
        }
        if "updated_at" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            )
        if "palace_segment_id" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN palace_segment_id INTEGER"
            )
        if "palace_segment_review_schedule_id" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN palace_segment_review_schedule_id INTEGER"
            )

        existing_indexes = {
            row[1]: row
            for row in conn.exec_driver_sql("PRAGMA index_list(session_progress)").fetchall()
        }

        review_index_sql = ""
        try:
            row = conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='ix_session_progress_review'"
            ).fetchone()
            review_index_sql = row[0] if row and row[0] else ""
        except Exception:
            review_index_sql = ""

        practice_index_sql = ""
        try:
            row = conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='ix_session_progress_practice'"
            ).fetchone()
            practice_index_sql = row[0] if row and row[0] else ""
        except Exception:
            practice_index_sql = ""

        if "ix_session_progress_review" in existing_indexes and "WHERE session_kind = 'review'" not in review_index_sql:
            conn.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_review")
        if "ix_session_progress_practice" in existing_indexes and "WHERE session_kind = 'practice'" not in practice_index_sql:
            conn.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_practice")

        duplicate_review_rows = conn.exec_driver_sql(
            """
            SELECT review_schedule_id, COUNT(*) AS row_count
            FROM session_progress
            WHERE session_kind = 'review' AND review_schedule_id IS NOT NULL
            GROUP BY review_schedule_id
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        for review_schedule_id, _ in duplicate_review_rows:
            rows = conn.exec_driver_sql(
                """
                SELECT id
                FROM session_progress
                WHERE session_kind = 'review' AND review_schedule_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (review_schedule_id,),
            ).fetchall()
            keep_id = rows[0][0]
            for row in rows[1:]:
                if row[0] != keep_id:
                    conn.exec_driver_sql("DELETE FROM session_progress WHERE id = ?", (row[0],))

        conn.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_review_palace_id")
        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_practice "
            "ON session_progress (session_kind, palace_id) "
            "WHERE session_kind = 'practice' AND palace_id IS NOT NULL"
        )
        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_review "
            "ON session_progress (session_kind, review_schedule_id) "
            "WHERE session_kind = 'review' AND review_schedule_id IS NOT NULL"
        )
        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_practice "
            "ON session_progress (session_kind, palace_segment_id) "
            "WHERE session_kind = 'segment_practice' AND palace_segment_id IS NOT NULL"
        )
        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_review "
            "ON session_progress (session_kind, palace_segment_review_schedule_id) "
            "WHERE session_kind = 'segment_review' AND palace_segment_review_schedule_id IS NOT NULL"
        )


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
        "palace_segment_review_schedule_id": getattr(progress, "palace_segment_review_schedule_id", None),
        "reveal_map": _deserialize_json(progress.reveal_map, {}),
        "red_node_ids": _deserialize_json(progress.red_node_ids, []),
        "completed": bool(progress.completed),
        "updated_at": progress.updated_at.isoformat() if progress.updated_at else None,
    }


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


def get_segment_practice_progress(session: Session, segment_id: int) -> dict | None:
    progress = (
        session.query(SessionProgress)
        .filter_by(session_kind="segment_practice", palace_segment_id=segment_id)
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
    progress.palace_segment_review_schedule_id = None
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
    progress.palace_segment_review_schedule_id = None
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
