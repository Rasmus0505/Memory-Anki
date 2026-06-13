from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any

from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceMiniPalace,
    PalaceMiniPalaceReviewLog,
    PalaceMiniPalaceReviewSchedule,
    engine,
)
from memory_anki.modules.palaces.application.segment_nodes import (
    build_segments_editor_doc,
    collect_doc_nodes_with_descendants,
    get_reviewable_doc_node_uids,
)
from memory_anki.modules.mindmap.application.editor_state_service import _deserialize
from memory_anki.modules.reviews.application.schedule_policy import (
    ReviewScheduleDraft,
    ReviewSchedulePolicy,
    build_review_schedule_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    normalize_algorithm,
    schedule_display_datetime_for_policy,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_algorithm_stage_labels,
    get_config_value,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    calculate_reveal_progress,
    get_mini_review_progress,
)


def ensure_mini_palace_schema() -> None:
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "palace_mini_palaces" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_mini_palaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_id INTEGER NOT NULL,
                    name VARCHAR(200) NOT NULL DEFAULT '',
                    node_uids_json TEXT DEFAULT '[]',
                    needs_practice BOOLEAN NOT NULL DEFAULT 0,
                    sort_order INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
                )
                """
            )
        else:
            existing_columns = {
                row[1]
                for row in conn.exec_driver_sql(
                    "PRAGMA table_info(palace_mini_palaces)"
                ).fetchall()
            }
            columns = (
                ("name", "VARCHAR(200) NOT NULL DEFAULT ''"),
                ("node_uids_json", "TEXT DEFAULT '[]'"),
                ("needs_practice", "BOOLEAN NOT NULL DEFAULT 0"),
                ("sort_order", "INTEGER DEFAULT 0"),
                ("created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
                ("updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
            )
            for column_name, column_type in columns:
                if column_name not in existing_columns:
                    conn.exec_driver_sql(
                        f"ALTER TABLE palace_mini_palaces ADD COLUMN {column_name} {column_type}"
                    )

        if "palace_mini_palace_review_schedules" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_mini_palace_review_schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_mini_palace_id INTEGER NOT NULL,
                    scheduled_date DATE NOT NULL,
                    scheduled_at DATETIME NULL,
                    interval_days INTEGER DEFAULT 0,
                    algorithm_used VARCHAR(30) DEFAULT 'ebbinghaus',
                    completed BOOLEAN DEFAULT 0,
                    completed_at DATETIME NULL,
                    review_number INTEGER DEFAULT 0,
                    review_type VARCHAR(20) DEFAULT 'standard',
                    anchor_date DATE NULL,
                    FOREIGN KEY(palace_mini_palace_id) REFERENCES palace_mini_palaces(id) ON DELETE CASCADE
                )
                """
            )
        if "palace_mini_palace_review_logs" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_mini_palace_review_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_mini_palace_id INTEGER NOT NULL,
                    review_date DATE DEFAULT CURRENT_DATE,
                    score INTEGER DEFAULT 0,
                    review_mode VARCHAR(20) DEFAULT 'flashcard',
                    duration_seconds INTEGER DEFAULT 0,
                    FOREIGN KEY(palace_mini_palace_id) REFERENCES palace_mini_palaces(id) ON DELETE CASCADE
                )
                """
            )

        for table_name, columns in {
            "palace_mini_palace_review_schedules": (
                ("scheduled_at", "DATETIME"),
                ("completed_at", "DATETIME"),
            ),
        }.items():
            existing_columns = {
                row[1]
                for row in conn.exec_driver_sql(
                    f"PRAGMA table_info({table_name})"
                ).fetchall()
            }
            for column_name, column_type in columns:
                if column_name not in existing_columns:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    )

        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_mini_palaces_palace_sort "
            "ON palace_mini_palaces (palace_id, sort_order)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_mini_review_schedule_mini "
            "ON palace_mini_palace_review_schedules (palace_mini_palace_id, completed, review_number)"
        )


def parse_mini_palace_node_uids(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return _unique_strings(data)


def serialize_mini_palace_node_uids(node_uids: list[str]) -> str:
    return json.dumps(_unique_strings(node_uids), ensure_ascii=False)


def list_palace_mini_palaces(session: Session, palace: Palace) -> list[dict[str, Any]]:
    changed = cleanup_mini_palace_node_uids(session, palace)
    schedule_changed = False
    for mini_palace in palace.mini_palaces:
        schedule_changed = ensure_mini_palace_schedule_model(session, mini_palace) or schedule_changed
    if changed or schedule_changed:
        session.commit()
        session.refresh(palace)
    return [mini_palace_summary_json(item, session) for item in palace.mini_palaces]


def mini_palace_summary_json(
    mini_palace: PalaceMiniPalace,
    session: Session | None = None,
) -> dict[str, Any]:
    node_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
    if session is None:
        review_stage_total = 0
        review_stage_completed = 0
        review_stage_progress = 0.0
        stage_labels: list[str] = []
        review_stages: list[dict[str, Any]] = []
        next_review_at = None
        has_due_review = False
        current_review_schedule_id = None
        current_review_type = None
        estimated_review_seconds = estimate_mini_review_seconds(mini_palace)
    else:
        ensure_mini_palace_schedule_model(session, mini_palace)
        review_stage_total, review_stage_completed, review_stage_progress = _mini_progress(
            session,
            mini_palace,
        )
        algorithm = _mini_algorithm(session, mini_palace)
        stage_labels = get_algorithm_stage_labels(session, algorithm)
        review_stages = mini_review_stages_json(session, mini_palace, stage_labels)
        timing = build_mini_palace_timing(session, mini_palace)
        next_review_at = timing["next_review_at"]
        has_due_review = timing["has_due_review"]
        current_review_schedule_id = timing["current_review_schedule_id"]
        current_review_type = timing["current_review_type"]
        estimated_review_seconds = estimate_mini_review_seconds(mini_palace)
        active_review_progress = None
        if current_review_schedule_id is not None:
            review_progress = get_mini_review_progress(session, current_review_schedule_id)
            if review_progress:
                review_doc = build_segments_editor_doc(mini_palace.palace, [node_uids])
                active_review_progress = calculate_reveal_progress(
                    review_progress,
                    get_reviewable_doc_node_uids(review_doc),
                )
    if session is None:
        active_review_progress = None
    return {
        "id": mini_palace.id,
        "palace_id": mini_palace.palace_id,
        "name": mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}",
        "node_uids": node_uids,
        "node_count": len(node_uids),
        "sort_order": mini_palace.sort_order,
        "created_at": mini_palace.created_at.isoformat() if mini_palace.created_at else None,
        "updated_at": mini_palace.updated_at.isoformat() if mini_palace.updated_at else None,
        "is_empty": len(node_uids) == 0,
        "needs_practice": bool(getattr(mini_palace, "needs_practice", False)),
        "estimated_review_seconds": estimated_review_seconds,
        "review_stage_total": review_stage_total,
        "review_stage_completed": review_stage_completed,
        "review_stage_progress": review_stage_progress,
        "stage_labels": stage_labels,
        "review_stages": review_stages,
        "next_review_at": next_review_at,
        "has_due_review": has_due_review,
        "current_review_schedule_id": current_review_schedule_id,
        "current_review_type": current_review_type,
        "active_review_progress": active_review_progress,
    }


def build_mini_palace_editor_doc(
    palace: Palace,
    mini_palace: PalaceMiniPalace,
) -> dict[str, Any]:
    return build_segments_editor_doc(
        palace,
        [parse_mini_palace_node_uids(mini_palace.node_uids_json)],
    )


def create_palace_mini_palace(
    session: Session,
    palace: Palace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    normalized_node_uids = _normalize_node_uids(palace, payload.get("node_uids", []))
    mini_palace = PalaceMiniPalace(
        palace_id=palace.id,
        name=_resolve_name(palace, payload.get("name"), node_uids=normalized_node_uids),
        node_uids_json=serialize_mini_palace_node_uids(normalized_node_uids),
        needs_practice=bool(payload.get("needs_practice", False)),
        sort_order=max([item.sort_order for item in palace.mini_palaces], default=-1) + 1,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    session.add(mini_palace)
    session.flush()
    ensure_mini_palace_schedule_model(session, mini_palace)
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def update_palace_mini_palace(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    normalized_node_uids = None
    if "node_uids" in payload:
        normalized_node_uids = _normalize_node_uids(
            mini_palace.palace, payload.get("node_uids", [])
        )
    if "name" in payload:
        mini_palace.name = _resolve_name(
            mini_palace.palace,
            payload.get("name"),
            node_uids=normalized_node_uids,
            exclude_id=mini_palace.id,
        )
    if normalized_node_uids is not None:
        mini_palace.node_uids_json = serialize_mini_palace_node_uids(normalized_node_uids)
    if "sort_order" in payload:
        mini_palace.sort_order = max(0, int(payload.get("sort_order") or 0))
    if "needs_practice" in payload:
        mini_palace.needs_practice = bool(payload.get("needs_practice", False))
    mini_palace.updated_at = utc_now_naive()
    ensure_mini_palace_schedule_model(session, mini_palace)
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def delete_palace_mini_palace(session: Session, mini_palace: PalaceMiniPalace) -> None:
    session.delete(mini_palace)
    session.commit()


def get_palace_mini_palace(
    session: Session,
    mini_palace_id: int,
) -> PalaceMiniPalace | None:
    return session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()


def cleanup_mini_palace_node_uids(session: Session, palace: Palace) -> bool:
    valid_uids = _valid_checkpoint_uids(palace)
    changed = False
    for mini_palace in palace.mini_palaces:
        current_uids = parse_mini_palace_node_uids(mini_palace.node_uids_json)
        next_uids = [uid for uid in current_uids if uid in valid_uids]
        if next_uids != current_uids:
            mini_palace.node_uids_json = serialize_mini_palace_node_uids(next_uids)
            mini_palace.updated_at = utc_now_naive()
            changed = True
    if changed:
        session.flush()
    return changed


def ensure_mini_palace_schedule_model(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> bool:
    schedules = sorted(
        list(mini_palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    if schedules or _mini_is_empty(mini_palace):
        return False
    policy = load_review_schedule_policy(session)
    algorithm = _mini_algorithm(
        session,
        mini_palace,
        default_algorithm=policy.default_algorithm,
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    if not intervals:
        return False
    anchor = _mini_anchor_date(mini_palace)
    slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    for review_number in range(min(slot_count, len(intervals))):
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
        _create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=False,
            completed_at=None,
        )
    session.flush()
    return True


def get_mini_palace_schedule_display_datetime(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
) -> datetime | None:
    if schedule is None:
        return None
    return schedule_display_datetime_for_policy(
        load_review_schedule_policy(session),
        scheduled_date=schedule.scheduled_date,
        scheduled_at=schedule.scheduled_at,
        review_type=schedule.review_type,
        anchor_datetime=_mini_anchor_datetime(mini_palace),
    )


def is_mini_palace_schedule_due(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed or _mini_is_empty(mini_palace):
        return False
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


def is_mini_palace_schedule_overdue(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed or _mini_is_empty(mini_palace):
        return False
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at.date() < current.date() and due_at <= current


def build_mini_palace_timing(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> dict[str, Any]:
    if _mini_is_empty(mini_palace):
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    pending_schedules = sorted(
        [schedule for schedule in (mini_palace.review_schedules or []) if not schedule.completed],
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    next_schedule = pending_schedules[0] if pending_schedules else None
    if next_schedule is not None:
        next_review_at = get_mini_palace_schedule_display_datetime(
            session,
            mini_palace,
            next_schedule,
        )
        return {
            "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
            "has_due_review": is_mini_palace_schedule_due(session, mini_palace, next_schedule),
            "current_review_schedule_id": next_schedule.id,
            "current_review_type": next_schedule.review_type,
        }

    algorithm = _mini_algorithm(session, mini_palace)
    intervals = get_algorithm_intervals(session, algorithm) or ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    _, completed, _ = _mini_progress(session, mini_palace)
    if completed >= total:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    policy = load_review_schedule_policy(session)
    anchor = _mini_anchor_date(mini_palace)
    fallback_draft = build_review_schedule_draft(
        policy,
        review_number=completed,
        algorithm=algorithm,
        base_date=anchor,
        anchor_date=anchor,
        completed=False,
    )
    if fallback_draft is None:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    next_review_at = schedule_display_datetime_for_policy(
        policy,
        scheduled_date=fallback_draft.scheduled_date,
        scheduled_at=fallback_draft.scheduled_at,
        review_type=fallback_draft.review_type,
        anchor_datetime=_mini_anchor_datetime(mini_palace),
    )
    has_due_review = bool(next_review_at and next_review_at <= datetime.now())
    return {
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": None,
        "current_review_type": fallback_draft.review_type,
    }


def mini_review_stages_json(
    session: Session,
    mini_palace: PalaceMiniPalace,
    stage_labels: list[str],
) -> list[dict[str, Any]]:
    schedules = {
        schedule.review_number: schedule
        for schedule in sorted(mini_palace.review_schedules or [], key=lambda item: item.id)
    }
    _, completed_count, _ = _mini_progress(session, mini_palace)
    stages: list[dict[str, Any]] = []
    for index, label in enumerate(stage_labels):
        schedule = schedules.get(index)
        completed = index < completed_count
        stages.append(
            {
                "review_number": index,
                "label": label,
                "completed": completed,
                "completed_at": _serialize_stage_datetime(
                    schedule.completed_at if completed and schedule else None
                ),
                "scheduled_at": _serialize_stage_datetime(
                    get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
                ),
            }
        )
    return stages


def estimate_mini_review_seconds(mini_palace: PalaceMiniPalace) -> int:
    logs = mini_palace.review_logs or []
    total_duration = sum(max(0, int(log.duration_seconds or 0)) for log in logs)
    node_count = len(parse_mini_palace_node_uids(mini_palace.node_uids_json))
    if total_duration > 0 and logs:
        return max(60, round(total_duration / len(logs)))
    if node_count > 0:
        return max(60, node_count * 45)
    return 0


def create_mini_palace_review_log(
    session: Session,
    *,
    mini_palace: PalaceMiniPalace,
    duration_seconds: int,
    completed_at: datetime | None = None,
) -> PalaceMiniPalaceReviewLog:
    effective_completed_at = completed_at or datetime.now()
    log = PalaceMiniPalaceReviewLog(
        palace_mini_palace_id=mini_palace.id,
        review_date=effective_completed_at.date(),
        score=5,
        review_mode="review",
        duration_seconds=max(0, int(duration_seconds)),
    )
    session.add(log)
    session.flush()
    return log


def adjust_mini_palace_review_progress(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    completed_at = _parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    rebuild_mini_palace_review_progress(
        session,
        mini_palace,
        completed_count=int(payload.get("completed_count", 0)),
        completed_review_number=completed_review_number,
        completed_at=completed_at,
    )
    if "needs_practice" in payload:
        mini_palace.needs_practice = bool(payload.get("needs_practice", False))
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def rebuild_mini_palace_review_progress(
    session: Session,
    mini_palace: PalaceMiniPalace,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    algorithm_override: str | None = None,
) -> None:
    policy = load_review_schedule_policy(session)
    algorithm = normalize_algorithm(
        algorithm_override
        or _mini_algorithm(session, mini_palace, default_algorithm=policy.default_algorithm)
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = _mini_anchor_date(mini_palace)
    initial_slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    existing_schedules = sorted(
        list(mini_palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    completed_at_by_stage = _collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=safe_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < safe_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = _coerce_stage_completed_at(completed_at)
    elif completed_at is not None and safe_completed_count > 0:
        normalized_completed_at = _coerce_stage_completed_at(completed_at)
        completed_at_by_stage[safe_completed_count - 1] = normalized_completed_at
        for review_number in range(safe_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(PalaceMiniPalaceReviewSchedule).filter_by(
        palace_mini_palace_id=mini_palace.id
    ).delete(synchronize_session=False)
    session.flush()
    for schedule in existing_schedules:
        if sqlalchemy_inspect(schedule).session is session:
            session.expunge(schedule)
    session.expire(mini_palace, ["review_schedules"])

    previous_anchor_at: datetime | None = None
    for review_number in range(safe_completed_count):
        stage_completed_at = _coerce_stage_completed_at(
            completed_at_by_stage.get(review_number),
            fallback=previous_anchor_at,
        )
        base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        )
        _create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=True,
            completed_at=stage_completed_at,
        )
        scheduled_display_at = _existing_mini_schedule_display_at(
            existing_schedules,
            review_number,
            policy=policy,
            mini_palace=mini_palace,
        ) or (
            schedule_display_datetime_for_policy(
                policy,
                scheduled_date=draft.scheduled_date,
                scheduled_at=draft.scheduled_at,
                review_type=draft.review_type,
                anchor_datetime=_mini_anchor_datetime(mini_palace),
            )
            if draft is not None and draft.scheduled_at is not None
            else None
        )
        previous_anchor_at = _resolve_effective_stage_anchor_at(
            use_anchor_mode=policy.early_review_anchor,
            actual_completed_at=stage_completed_at,
            scheduled_display_at=scheduled_display_at,
        )

    if _mini_is_empty(mini_palace):
        session.flush()
        return

    for review_number in _target_pending_review_numbers(
        completed_count=safe_completed_count,
        total=total,
        initial_slot_count=initial_slot_count,
    ):
        base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=False,
        )
        _create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=False,
            completed_at=None,
        )
    session.flush()


def _mini_progress(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> tuple[int, int, float]:
    algorithm = _mini_algorithm(session, mini_palace)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed_count = infer_completed_stage_count(
        total=total,
        schedules=mini_palace.review_schedules or [],
    )
    return total, completed_count, completed_count / total


def _mini_algorithm(
    session: Session,
    mini_palace: PalaceMiniPalace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (mini_palace.review_schedules or [])
            if item.algorithm_used
        ),
        default_algorithm or normalize_algorithm(get_config_value(session, "default_algorithm")),
    )


def _mini_anchor_date(mini_palace: PalaceMiniPalace) -> date:
    for schedule in mini_palace.review_schedules or []:
        if schedule.anchor_date:
            return schedule.anchor_date
    if mini_palace.created_at:
        return mini_palace.created_at.date()
    if mini_palace.palace and mini_palace.palace.created_at:
        return mini_palace.palace.created_at.date()
    return date.today()


def _mini_anchor_datetime(mini_palace: PalaceMiniPalace) -> datetime | None:
    return (
        mini_palace.created_at
        or (mini_palace.palace.created_at if mini_palace.palace else None)
        or mini_palace.updated_at
    )


def _mini_is_empty(mini_palace: PalaceMiniPalace) -> bool:
    return len(parse_mini_palace_node_uids(mini_palace.node_uids_json)) == 0


def _serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def _copy_mini_schedule(
    mini_palace: PalaceMiniPalace,
    draft: ReviewScheduleDraft,
    *,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceMiniPalaceReviewSchedule:
    return PalaceMiniPalaceReviewSchedule(
        palace_mini_palace_id=mini_palace.id,
        scheduled_date=draft.scheduled_date,
        scheduled_at=draft.scheduled_at,
        interval_days=draft.interval_days,
        algorithm_used=draft.algorithm_used,
        completed=completed,
        completed_at=completed_at,
        review_number=draft.review_number,
        review_type=draft.review_type,
        anchor_date=draft.anchor_date,
    )


def _create_mini_schedule_from_draft(
    session: Session,
    *,
    mini_palace: PalaceMiniPalace,
    draft: ReviewScheduleDraft | None,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceMiniPalaceReviewSchedule | None:
    if draft is None:
        return None
    schedule = _copy_mini_schedule(
        mini_palace,
        draft,
        completed=completed,
        completed_at=completed_at,
    )
    session.add(schedule)
    return schedule


def _coerce_stage_completed_at(
    value: datetime | None,
    *,
    fallback: datetime | None = None,
) -> datetime:
    target = value or fallback or datetime.now()
    return target.replace(second=0, microsecond=0)


def _collect_completed_stage_times(
    *,
    schedules: list[Any],
    completed_count: int,
) -> dict[int, datetime]:
    completed_at_by_stage: dict[int, datetime] = {}
    for review_number in range(completed_count):
        matching = [
            schedule
            for schedule in schedules
            if int(schedule.review_number) == review_number
        ]
        completed_schedule = next(
            (schedule for schedule in matching if getattr(schedule, "completed", False)),
            None,
        )
        if completed_schedule is None:
            continue
        completed_at_by_stage[review_number] = _coerce_stage_completed_at(
            getattr(completed_schedule, "completed_at", None)
        )
    return completed_at_by_stage


def _target_pending_review_numbers(
    *,
    completed_count: int,
    total: int,
    initial_slot_count: int,
) -> list[int]:
    if completed_count >= total:
        return []
    if completed_count < initial_slot_count:
        return list(range(completed_count, min(initial_slot_count, total)))
    return [completed_count]


def _resolve_effective_stage_anchor_at(
    *,
    use_anchor_mode: bool,
    actual_completed_at: datetime,
    scheduled_display_at: datetime | None,
) -> datetime:
    normalized_completed_at = _coerce_stage_completed_at(actual_completed_at)
    if (
        use_anchor_mode
        and scheduled_display_at is not None
        and normalized_completed_at < scheduled_display_at
        and normalized_completed_at.date() == scheduled_display_at.date()
    ):
        return scheduled_display_at.replace(second=0, microsecond=0)
    return normalized_completed_at


def _existing_mini_schedule_display_at(
    schedules: list[Any],
    review_number: int,
    *,
    policy: ReviewSchedulePolicy,
    mini_palace: PalaceMiniPalace,
) -> datetime | None:
    existing_schedule = next(
        (
            schedule
            for schedule in schedules
            if int(getattr(schedule, "review_number", -1)) == review_number
        ),
        None,
    )
    if existing_schedule is None:
        return None
    if getattr(existing_schedule, "scheduled_at", None) is None:
        return None
    return schedule_display_datetime_for_policy(
        policy,
        scheduled_date=getattr(existing_schedule, "scheduled_date", None),
        scheduled_at=getattr(existing_schedule, "scheduled_at", None),
        review_type=getattr(existing_schedule, "review_type", None),
        anchor_datetime=_mini_anchor_datetime(mini_palace),
    )


def _normalize_node_uids(palace: Palace, value: Any) -> list[str]:
    valid_uids = _valid_checkpoint_uids(palace)
    return [uid for uid in _unique_strings(value if isinstance(value, list) else []) if uid in valid_uids]


def _valid_checkpoint_uids(palace: Palace) -> set[str]:
    valid_uids = set(collect_doc_nodes_with_descendants(palace.editor_doc)[0].keys())
    root_uid = _get_root_uid(palace.editor_doc)
    if root_uid:
        valid_uids.discard(root_uid)
    return valid_uids


def _get_root_uid(editor_doc: Any) -> str:
    try:
        doc = json.loads(editor_doc) if isinstance(editor_doc, str) else editor_doc
    except Exception:
        return ""
    if not isinstance(doc, dict):
        return ""
    root = doc.get("root")
    if not isinstance(root, dict):
        return ""
    data = root.get("data")
    if not isinstance(data, dict):
        return ""
    return str(data.get("uid") or "").strip()


def _unique_strings(values: Any) -> list[str]:
    result: list[str] = []
    if not isinstance(values, list):
        return result
    for item in values:
        text = str(item or "").strip()
        if text and text not in result:
            result.append(text)
    return result


def _default_mini_palace_name_from_first_child(palace: Palace) -> str:
    doc = _deserialize(getattr(palace, "editor_doc", None), {})
    root = doc.get("root") if isinstance(doc, dict) else None
    children = root.get("children") if isinstance(root, dict) else None
    first_child = children[0] if isinstance(children, list) and children else None
    data = first_child.get("data") if isinstance(first_child, dict) else None
    raw_text = str(data.get("text") or "").strip() if isinstance(data, dict) else ""
    if not raw_text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw_text).replace("&nbsp;", " ")).strip()


def _node_text_by_uid(palace: Palace) -> dict[str, str]:
    doc = _deserialize(getattr(palace, "editor_doc", None), {})
    root = doc.get("root") if isinstance(doc, dict) else None
    result: dict[str, str] = {}

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            uid = str(data.get("uid") or "").strip()
            raw_text = str(data.get("text") or "").strip()
            normalized_text = re.sub(
                r"\s+", " ", re.sub(r"<[^>]+>", " ", raw_text).replace("&nbsp;", " ")
            ).strip()
            if uid and normalized_text:
                result[uid] = normalized_text
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                visit(child)

    visit(root)
    return result


def _default_mini_palace_name_from_node_uids(palace: Palace, node_uids: list[str] | None) -> str:
    if not node_uids:
        return ""
    text_by_uid = _node_text_by_uid(palace)
    for uid in node_uids:
        text = text_by_uid.get(uid, "").strip()
        if text:
            return text
    return ""


def _resolve_name(
    palace: Palace,
    value: Any,
    *,
    node_uids: list[str] | None = None,
    exclude_id: int | None = None,
) -> str:
    raw = str(value or "").strip()
    if raw:
        return raw
    preferred = _default_mini_palace_name_from_node_uids(palace, node_uids)
    if preferred:
        return preferred
    preferred = _default_mini_palace_name_from_first_child(palace)
    if preferred:
        return preferred
    existing_names = {
        str(item.name or "").strip()
        for item in palace.mini_palaces
        if exclude_id is None or item.id != exclude_id
    }
    index = 1
    while True:
        candidate = f"小宫殿 {index}"
        if candidate not in existing_names:
            return candidate
        index += 1


def _parse_progress_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0)
