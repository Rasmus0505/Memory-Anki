"""Permanent-mark review unit lifecycle, scheduling, sessions, and ratings."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from memory_anki.core.exam_horizon import (
    EXAM_SETTINGS_KEY,
    SprintHorizon,
    read_exam_settings,
    resolve_sprint_horizon,
)
from memory_anki.core.time import local_calendar_day_of, local_day, to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewSessionUnit,
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.mindmap_document.api import deserialize_editor_payload

from .unit_fsrs_adapter import (
    SCHEDULER_VERSION,
    FsrsUnitState,
    replay_history,
    state_payload,
)
from .unit_intraday import IntradayState
from .unit_reconcile import reconcile_palace_units
from .unit_review_projection import (
    _active_unit_key,
    adjust_unit_schedule,
    get_palace_unit_projection,
    json_load_list,
    list_due_units,
    remove_unit_permanently,
    resolve_unit_definitions,
    undo_content_schedule_batch,
    unit_payload,
)
from .unit_scheduler import RATING_LABELS, normalize_rating, rate_unit

SESSION_ACTIVE = "active"
SESSION_COMPLETED = "completed"
SESSION_ABANDONED = "abandoned"
ITEM_PENDING = "pending"
ITEM_RETRY = "retry"
ITEM_PASSED = "passed"
ENCOUNTER_OPEN = "open"
ENCOUNTER_CLOSED = "closed"


# Rated closed encounters are the only counted intervals; unrated glances are
# cancelled on leave, so freestyle never keeps a session open across other cards.
FREESTYLE_UNIT_REVIEW_SCENE = "freestyle_unit_review"

def _normalize_unit_review_client_source(value: Any) -> str | None:
    """Normalize the client source recorded on review sessions."""
    normalized = str(value or "").strip().lower()
    if normalized == "desktop":
        return "desktop"
    if normalized in {"pwa", "mobile"}:
        return "pwa"
    return None


def _load_study_summary(study: StudySession) -> dict[str, Any]:
    try:
        raw = json.loads(study.summary_json or "{}")
    except (TypeError, json.JSONDecodeError):
        raw = {}
    return raw if isinstance(raw, dict) else {}


def _first_billable_encounter_started_at(
    session: Session, study_session_id: str
) -> datetime | None:
    row = (
        session.query(ReviewUnitEncounter)
        .filter(
            ReviewUnitEncounter.study_session_id == study_session_id,
            ReviewUnitEncounter.status == ENCOUNTER_CLOSED,
            ReviewUnitEncounter.selected_rating.isnot(None),
        )
        .order_by(ReviewUnitEncounter.created_at.asc())
        .first()
    )
    return row.created_at if row is not None else None


def _delete_open_unrated_encounters(session: Session, study_session_id: str) -> int:
    rows = (
        session.query(ReviewUnitEncounter)
        .filter(
            ReviewUnitEncounter.study_session_id == study_session_id,
            ReviewUnitEncounter.status == ENCOUNTER_OPEN,
            ReviewUnitEncounter.selected_rating.is_(None),
        )
        .all()
    )
    deleted = 0
    for row in rows:
        session.delete(row)
        deleted += 1
    return deleted


def _session_has_billable_progress(session: Session, study_session_id: str) -> bool:
    """Does this study session already own real, billable progress?

    Read-only on purpose, and wrapped in ``no_autoflush`` for a reason that is
    not stylistic. Callers stage writes before asking this question (for example
    ``cancel_unit_review_encounter`` deletes the encounter first, then asks
    whether the session earned anything). A bare query would autoflush those
    staged writes, which opens the SQLite write transaction *there* — and it then
    stays open across everything the caller does until it commits. SQLite allows
    one writer, so every other write in the product waits out ``busy_timeout``
    (10s) and fails with "database is locked".

    Measured: `POST /review/units/{id}/sessions -> 503 in 51302ms` with
    `sql_total_ms=21.4` — 21 ms of real SQL, 51 s of holding the write lock. The
    session watchdog named this function as the opener.

    ``no_autoflush`` is correct here because the question is about *committed*
    progress, not about rows this same call just staged. Flushing early would
    also change the answer it is asking for.
    """
    with session.no_autoflush:
        rated_closed = (
            session.query(ReviewUnitEncounter.id)
            .filter(
                ReviewUnitEncounter.study_session_id == study_session_id,
                ReviewUnitEncounter.status == ENCOUNTER_CLOSED,
                ReviewUnitEncounter.selected_rating.isnot(None),
            )
            .first()
        )
        if rated_closed is not None:
            return True
        passed_item = (
            session.query(ReviewSessionUnit.id)
            .filter(
                ReviewSessionUnit.study_session_id == study_session_id,
                ReviewSessionUnit.status == ITEM_PASSED,
            )
            .first()
        )
    return passed_item is not None


def _abandon_freestyle_study_session(
    session: Session,
    study: StudySession,
    *,
    reason: str,
) -> None:
    """Drop a freestyle unit session that never earned billable study time."""
    _delete_open_unrated_encounters(session, study.id)
    now = utc_now_naive()
    study.status = SESSION_ABANDONED
    study.ended_at = now
    study.completion_method = reason
    summary = _load_study_summary(study)
    summary["abandoned_reason"] = reason
    summary["abandoned_at"] = to_api_datetime(now)
    study.summary_json = json.dumps(summary, ensure_ascii=False)


def _release_competing_freestyle_unit_sessions(
    session: Session,
    *,
    keep_unit_id: str | None,
    keep_study_id: str | None = None,
) -> int:
    """Ensure at most one freestyle unit-review session stays active.

    Rapid freestyle scrolling used to leave an active StudySession per card with
    the original started_at; later passes then billed the entire wall span.
    Unrated competing sessions are abandoned; rated-but-incomplete sessions keep
    their closed encounter history and only lose the open unrated glance.
    """
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == FREESTYLE_UNIT_REVIEW_SCENE,
            StudySession.status == SESSION_ACTIVE,
        )
        .all()
    )
    if not rows:
        return 0
    units_by_study: dict[str, set[str]] = {}
    for study_id, unit_id in (
        session.query(ReviewSessionUnit.study_session_id, ReviewSessionUnit.unit_id)
        .filter(ReviewSessionUnit.study_session_id.in_([study.id for study in rows]))
        .all()
    ):
        units_by_study.setdefault(study_id, set()).add(unit_id)
    released = 0
    for study in rows:
        if keep_study_id is not None and study.id == keep_study_id:
            continue
        unit_ids = units_by_study.get(study.id, set())
        if keep_unit_id is not None and keep_unit_id in unit_ids and len(unit_ids) == 1:
            continue
        _delete_open_unrated_encounters(session, study.id)
        if not _session_has_billable_progress(session, study.id):
            _abandon_freestyle_study_session(
                session,
                study,
                reason="superseded_by_other_unit",
            )
            released += 1
        else:
            # Keep retry state, but stop accruing an abandoned open glance.
            released += 1
    return released


def start_unit_review_session(
    session: Session,
    palace_id: int,
    *,
    scene: str = "formal_unit_review",
    unit_ids: list[str] | None = None,
    client_source: str | None = None,
    allow_not_due: bool = False,
    projection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Freestyle start already projected this palace to adopt the live revision.
    # Parsing the document again held the write lock for a second full walk.
    if projection is None:
        projection = get_palace_unit_projection(session, palace_id, allow_reconcile=True)
    if projection["mark_required"]:
        raise ValueError("permanent marks are required before review")
    definitions = {item["id"]: item for item in projection["units"]}
    selected = [item for item in projection["units"] if item["due"] or allow_not_due]
    if unit_ids is not None:
        requested = {str(item) for item in unit_ids}
        selected = [
            definitions[item]
            for item in requested
            if item in definitions and (definitions[item]["due"] or allow_not_due)
        ]
    if not selected:
        raise ValueError("no review units available")

    now = utc_now_naive()
    summary: dict[str, Any] = {}
    normalized_source = _normalize_unit_review_client_source(client_source)
    if normalized_source is not None:
        summary["client_source"] = normalized_source
    study = StudySession(
        id=uuid.uuid4().hex,
        status=SESSION_ACTIVE,
        scene=scene,
        target_type="palace",
        target_id=palace_id,
        palace_id=palace_id,
        title=str(projection.get("title") or ""),
        started_at=now,
        summary_json=json.dumps(summary, ensure_ascii=False),
        progress_json="{}",
        events_json="[]",
    )
    session.add(study)
    for index, item in enumerate(selected):
        session.add(
            ReviewSessionUnit(
                study_session_id=study.id,
                unit_id=item["id"],
                unit_revision=int(item["revision"]),
                node_uids_json=json.dumps(item["node_uids"], ensure_ascii=False),
                order_index=index,
                status=ITEM_PENDING,
            )
        )
    session.commit()
    return get_unit_review_session(session, study.id)


def get_unit_review_session(
    session: Session, study_session_id: str, *, encounter_id: str | None = None,
) -> dict[str, Any]:
    study = session.get(StudySession, study_session_id)
    if study is None or study.scene not in ("formal_unit_review", "freestyle_unit_review"):
        raise ValueError("unit review session not found")
    rows = (
        session.query(ReviewSessionUnit, ReviewUnitState)
        .join(ReviewUnitState, ReviewUnitState.id == ReviewSessionUnit.unit_id)
        .filter(ReviewSessionUnit.study_session_id == study.id)
        .order_by(ReviewSessionUnit.order_index.asc())
        .all()
    )
    requested_encounter = session.get(ReviewUnitEncounter, encounter_id) if encounter_id else None
    if encounter_id and (
        requested_encounter is None or requested_encounter.study_session_id != study.id
    ):
        raise ValueError("review encounter is outside the session")
    palace = session.get(Palace, study.palace_id) if study.palace_id is not None else None
    if study.palace_id is None:
        raise ValueError("unit review session has no palace")
    _, definitions = resolve_unit_definitions(session, study.palace_id)
    definition_by_key = {
        _active_unit_key(item.anchor_uid, item.unit_kind): item for item in definitions
    }
    units = []
    for item, state in rows:
        payload = unit_payload(
            state,
            definition_by_key.get(_active_unit_key(state.anchor_uid, state.unit_kind)),
        )
        encounter = (
            session.query(ReviewUnitEncounter)
            .filter_by(study_session_id=study.id, unit_id=state.id)
            .order_by(
                (ReviewUnitEncounter.status == ENCOUNTER_OPEN).desc(),
                ReviewUnitEncounter.sequence.desc(),
            )
            .first()
        )
        if requested_encounter is not None and requested_encounter.unit_id == state.id:
            encounter = requested_encounter
        encounter_payload = (
            _encounter_payload(encounter, horizon=_sprint_horizon(session), live_state=state)
            if encounter is not None
            else None
        )
        if encounter is not None and encounter_payload is not None:
            encounter_payload["rating_editable"] = _rating_editable(session, encounter)
        payload.update(
            {
                "node_uids": json_load_list(item.node_uids_json),
                "session_status": item.status,
                "retry_count": item.retry_count,
                "hard_count": item.hard_count,
                "again_count": item.again_count,
                "final_rating": item.final_rating,
                "encounter": encounter_payload,
            }
        )
        units.append(payload)
    return {
        "id": study.id,
        "palace_id": study.palace_id,
        "title": study.title,
        "palace": {
            "id": palace.id,
            "title": palace.title or "",
            # Always return a parsed object. Raw SQLite TEXT would arrive as a JSON
            # string on the client and break permanent-mark chip/toggle helpers that
            # expect editor_doc.root (L1/L2 invisible, click no-ops).
            "editor_doc": deserialize_editor_payload(palace.editor_doc, {}),
        }
        if palace is not None
        else None,
        "status": study.status,
        "started_at": to_api_datetime(study.started_at),
        "ended_at": to_api_datetime(study.ended_at),
        "units": units,
        "pending_unit_count": sum(1 for item in units if item["session_status"] != ITEM_PASSED),
        "completed_unit_count": sum(1 for item in units if item["session_status"] == ITEM_PASSED),
    }


def _fsrs_state_from_unit(state: ReviewUnitState) -> FsrsUnitState:
    stored = FsrsUnitState(
        stability=state.fsrs_stability,
        difficulty=state.fsrs_difficulty,
        fsrs_state=int(state.fsrs_state) if state.fsrs_state is not None else 1,
        step=state.fsrs_step,
        due_at=state.fsrs_due_at,
        last_review=state.fsrs_last_review,
    )
    if stored.is_empty():
        # Inheritance and pre-switch rows carry only the legacy projection.
        # Seeding from it keeps a mature unit from looking brand new on its
        # first FSRS rating (which would book a one-day interval).
        return FsrsUnitState.from_legacy(
            stage_index=state.stage_index,
            has_passed=state.has_passed,
            due_date=state.due_date,
        )
    return stored


def _fsrs_state_from_snapshot(state_data: dict[str, Any]) -> FsrsUnitState | None:
    raw = state_data.get("fsrs")
    if not isinstance(raw, dict):
        return None
    due_at = raw.get("due_at")
    last_review = raw.get("last_review")
    return FsrsUnitState(
        stability=raw.get("stability"),
        difficulty=raw.get("difficulty"),
        fsrs_state=int(raw.get("state") or 1),
        step=raw.get("step"),
        due_at=datetime.fromisoformat(str(due_at)) if due_at else None,
        last_review=datetime.fromisoformat(str(last_review)) if last_review else None,
    )


def _apply_fsrs_state(
    state: ReviewUnitState,
    fsrs: FsrsUnitState | None,
    *,
    clear: bool = False,
) -> None:
    if fsrs is None:
        if not clear:
            return
        state.fsrs_stability = None
        state.fsrs_difficulty = None
        state.fsrs_state = None
        state.fsrs_step = None
        state.fsrs_due_at = None
        state.fsrs_last_review = None
        state.fsrs_scheduler_version = None
        return
    state.fsrs_stability = fsrs.stability
    state.fsrs_difficulty = fsrs.difficulty
    state.fsrs_state = fsrs.fsrs_state
    state.fsrs_step = fsrs.step
    state.fsrs_due_at = fsrs.due_at
    state.fsrs_last_review = fsrs.last_review
    state.fsrs_scheduler_version = SCHEDULER_VERSION


def _replay_fsrs_state(
    session: Session,
    state: ReviewUnitState,
    *,
    exclude_operation_ids: set[str] | None = None,
) -> FsrsUnitState:
    """Rebuild FSRS state from effective history for legacy snapshots.

    Ratings recorded before the switch have no FSRS fields in their before/after
    snapshots. Undo and amendment still have the operation ledger, so replaying
    the remaining effective rows is the honest fallback. A unit whose entire
    ledger predates the switch has nothing to replay, so it starts from the
    legacy position the snapshot restored instead of being treated as brand new.
    """
    excluded = exclude_operation_ids or set()
    operations = (
        session.query(ReviewUnitRatingOperation)
        .filter(
            ReviewUnitRatingOperation.unit_id == state.id,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .order_by(
            ReviewUnitRatingOperation.created_at.asc(),
            ReviewUnitRatingOperation.id.asc(),
        )
        .all()
    )
    if excluded:
        operations = [operation for operation in operations if operation.id not in excluded]
    replay = replay_history(operations, unit_id=state.id)
    if replay.operations == 0:
        return FsrsUnitState.from_legacy(
            stage_index=state.stage_index,
            has_passed=state.has_passed,
            due_date=state.due_date,
        )
    return replay.state


def _intraday_from_unit(state: ReviewUnitState) -> IntradayState:
    return IntradayState(
        day=state.intraday_day,
        due_at=state.intraday_due_at,
        retries=int(state.intraday_retries or 0),
        step_pending=bool(state.intraday_step_pending),
    )


def _intraday_payload(intraday: IntradayState) -> dict[str, Any]:
    return {
        "day": intraday.day.isoformat() if intraday.day else None,
        "due_at": intraday.due_at.isoformat() if intraday.due_at else None,
        "retries": intraday.retries,
        "step_pending": intraday.step_pending,
    }


def _intraday_from_snapshot(state_data: dict[str, Any]) -> IntradayState | None:
    raw = state_data.get("intraday")
    if not isinstance(raw, dict):
        return None
    due_at = raw.get("due_at")
    day = raw.get("day")
    return IntradayState(
        day=date.fromisoformat(str(day)) if day else None,
        due_at=datetime.fromisoformat(str(due_at)) if due_at else None,
        retries=int(raw.get("retries") or 0),
        step_pending=bool(raw.get("step_pending")),
    )


def _apply_intraday(state: ReviewUnitState, intraday: IntradayState) -> None:
    state.intraday_due_at = intraday.due_at
    state.intraday_day = intraday.day
    state.intraday_retries = intraday.retries
    state.intraday_step_pending = intraday.step_pending


def _state_snapshot(state: ReviewUnitState, item: ReviewSessionUnit) -> dict[str, Any]:
    return {
        "state": {
            "stage_index": state.stage_index,
            "has_passed": state.has_passed,
            "due_date": state.due_date.isoformat(),
            "last_passed_at": to_api_datetime(state.last_passed_at),
            "hard_penalized_on": state.hard_penalized_on.isoformat()
            if state.hard_penalized_on
            else None,
            "fsrs": state_payload(_fsrs_state_from_unit(state)),
            "intraday": _intraday_payload(_intraday_from_unit(state)),
            "early_step": state.early_step,
            "lapse_original_days": state.lapse_original_interval_days,
            "lapse_started_on": (
                state.lapse_started_on.isoformat() if state.lapse_started_on else None
            ),
        },
        "item": {
            "status": item.status,
            "retry_count": item.retry_count,
            "hard_count": item.hard_count,
            "again_count": item.again_count,
            "final_rating": item.final_rating,
            "completed_at": to_api_datetime(item.completed_at),
        },
    }


def _restore_snapshot(
    state: ReviewUnitState,
    item: ReviewSessionUnit,
    snapshot: dict[str, Any],
) -> None:
    state_data = snapshot["state"]
    item_data = snapshot["item"]
    state.stage_index = int(state_data["stage_index"])
    state.has_passed = bool(state_data["has_passed"])
    state.due_date = date.fromisoformat(str(state_data["due_date"]))
    state.last_passed_at = (
        datetime.fromisoformat(str(state_data["last_passed_at"]).replace("Z", "+00:00")).replace(
            tzinfo=None
        )
        if state_data.get("last_passed_at")
        else None
    )
    penalized_on = state_data.get("hard_penalized_on")
    state.hard_penalized_on = date.fromisoformat(str(penalized_on)) if penalized_on else None
    raw_step = state_data.get("early_step")
    # Absent in pre-0080 snapshots: leave it None so the scheduler infers the
    # position from the booked gap instead of restarting a young unit at zero.
    state.early_step = int(raw_step) if raw_step not in (None, "") else None
    raw_lapse_days = state_data.get("lapse_original_days")
    state.lapse_original_interval_days = (
        int(raw_lapse_days) if raw_lapse_days not in (None, "") else None
    )
    raw_lapse_on = str(state_data.get("lapse_started_on") or "").strip()[:10]
    state.lapse_started_on = (
        date.fromisoformat(raw_lapse_on) if raw_lapse_on else None
    )
    snapshot_fsrs = _fsrs_state_from_snapshot(state_data)
    if snapshot_fsrs is None:
        # A pre-switch snapshot has no FSRS fields. Clear the live columns so the
        # caller's fallback (replay or legacy seed) owns the rebuilt card instead
        # of leaving the state of the operation being undone behind.
        _apply_fsrs_state(state, None, clear=True)
    else:
        _apply_fsrs_state(state, snapshot_fsrs)
    snapshot_intraday = _intraday_from_snapshot(state_data)
    if snapshot_intraday is None:
        # Pre-0078 snapshots never had a same-day ladder.
        _apply_intraday(state, IntradayState.empty())
    else:
        _apply_intraday(state, snapshot_intraday)
    item.status = str(item_data["status"])
    item.retry_count = int(item_data["retry_count"])
    item.hard_count = int(item_data["hard_count"])
    item.again_count = int(item_data["again_count"])
    item.final_rating = item_data.get("final_rating")
    item.completed_at = (
        datetime.fromisoformat(str(item_data["completed_at"]).replace("Z", "+00:00")).replace(
            tzinfo=None
        )
        if item_data.get("completed_at")
        else None
    )


def _schedule_lock_from_due(
    due_date: date,
    today: date,
    *,
    intraday_due_at: datetime | None = None,
    now: datetime | None = None,
) -> tuple[bool, date]:
    """A unit reviewed ahead of its booked day is locked.

    A same-day wait is enforced by the queue and the palace batch, not by this
    flag: if the learner deliberately opens the card and rates it early, that is
    a real attempt and should count.
    """
    return due_date > today, due_date


_SPRINT_HORIZON_KEY = "memory_anki_sprint_horizon"


def _sprint_horizon(session: Session, today: date | None = None) -> SprintHorizon | None:
    """Exam-horizon interval cap for this request, resolved once per session.

    Cached on ``session.info`` so the four rating buttons a preview renders and
    the rating the learner actually commits cannot disagree about the horizon.
    """
    if _SPRINT_HORIZON_KEY in session.info:
        return session.info[_SPRINT_HORIZON_KEY]
    row = session.query(Config).filter(Config.key == EXAM_SETTINGS_KEY).one_or_none()
    settings = read_exam_settings(row.value if row is not None else None)
    horizon = resolve_sprint_horizon(
        exam_date=settings.get("exam_date"),
        sprint_mode=bool(settings.get("sprint_mode")),
        today=today or local_day(),
    )
    session.info[_SPRINT_HORIZON_KEY] = horizon
    return horizon


def _spread_offset(unit_id: str, span_days: int) -> int:
    """Deterministic 0..span_days offset so a pulled backlog never lands on one day."""
    if span_days <= 0:
        return 0
    digest = hashlib.blake2b(unit_id.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (span_days + 1)


def clamp_due_dates_for_sprint(
    session: Session,
    *,
    today: date | None = None,
) -> dict[str, int]:
    """Pull due dates booked past the exam back inside the sprint horizon.

    Enabling sprint mode only constrains future ratings. Units already booked
    after the exam would otherwise never be reviewed again, so they are pulled
    into the last week before it — late enough to stay honest about how long the
    unit was really held, early enough to be seen once more. Spread is keyed on
    the unit id so the whole backlog does not arrive on a single day.
    """
    current = today or local_day()
    horizon = _sprint_horizon(session, current)
    if horizon is None:
        return {"clamped": 0, "exam_date": 0}
    floor = current + timedelta(days=1)
    limit = horizon.last_due
    if limit <= current:
        return {"clamped": 0, "exam_date": horizon.days_left}
    span = min(6, max(0, (limit - floor).days))
    rows = (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.active.is_(True))
        .filter(ReviewUnitState.due_date > limit)
        .all()
    )
    for state in rows:
        state.due_date = max(floor, limit - timedelta(days=_spread_offset(state.id, span)))
    if rows:
        session.commit()
    return {"clamped": len(rows), "exam_date": horizon.days_left}


def _rating_effects(
    snapshot: dict[str, Any],
    *,
    fuzz_key: str | None = None,
    horizon: SprintHorizon | None = None,
) -> list[dict[str, Any]]:
    state_data = snapshot["state"]
    item_data = snapshot["item"]
    stage_index = int(state_data["stage_index"])
    has_passed = bool(state_data["has_passed"])
    had_prior_failure = int(item_data["retry_count"]) > 0
    # Pin "today" once so every button in one preview shares a reference day and
    # the reported gap cannot drift across a midnight boundary mid-render.
    today = local_day()
    hard_penalized_today = state_data.get("hard_penalized_on") == today.isoformat()
    try:
        baseline_due = date.fromisoformat(str(state_data["due_date"]))
    except (TypeError, ValueError):
        baseline_due = today
    baseline_intraday = _intraday_from_snapshot(state_data) or IntradayState.empty()
    # One instant for every button, so the four previews share a reference.
    preview_at = utc_now_naive()
    schedule_locked, locked_due_date = _schedule_lock_from_due(
        baseline_due,
        today,
        intraday_due_at=baseline_intraday.due_at,
        now=preview_at,
    )
    snapshot_fsrs = _fsrs_state_from_snapshot(state_data)
    fsrs_state = (
        snapshot_fsrs
        if snapshot_fsrs is not None and not snapshot_fsrs.is_empty()
        else FsrsUnitState.from_legacy(
            stage_index=stage_index,
            has_passed=has_passed,
            due_date=baseline_due,
        )
    )
    baseline_interval = max(0, (baseline_due - today).days)
    effects: list[dict[str, Any]] = []
    for rating, label in RATING_LABELS.items():
        result = rate_unit(
            stage_index=stage_index,
            has_passed=has_passed,
            rating=rating,
            had_failure_in_encounter=had_prior_failure,
            today=today,
            fuzz_key=fuzz_key,
            schedule_locked=schedule_locked,
            locked_due_date=locked_due_date,
            hard_penalized_today=hard_penalized_today,
            horizon=horizon,
            fsrs_state=fsrs_state,
            intraday=baseline_intraday,
            now=preview_at,
            booked_due_date=baseline_due,
            early_step=(
                int(state_data["early_step"])
                if state_data.get("early_step") not in (None, "")
                else None
            ),
            lapse_original_days=(
                int(state_data["lapse_original_days"])
                if state_data.get("lapse_original_days") not in (None, "")
                else None
            ),
            lapse_started_on=(
                date.fromisoformat(str(state_data["lapse_started_on"])[:10])
                if state_data.get("lapse_started_on")
                else None
            ),
        )
        # FSRS returns the real booked gap. The old nominal-stage interval and
        # stage action remain in the payload for compatibility, but the UI must
        # read these real numbers, not the retired ladder table.
        actual_interval = max(0, (result.due_date - today).days)
        target_interval = actual_interval
        if not result.passed:
            stage_action = "reset" if rating == 1 else ("lower" if result.hard_penalty_applied else "keep")
        elif actual_interval > baseline_interval:
            stage_action = "advance"
        elif actual_interval < baseline_interval:
            stage_action = "lower"
        else:
            stage_action = "keep"
        effects.append(
            {
                "rating": rating,
                "label": label,
                "passed": result.passed,
                "target_stage_index": result.stage_index,
                "target_interval_days": target_interval,
                "target_actual_interval_days": actual_interval,
                "target_due_date": result.due_date.isoformat(),
                "retry_after_cards": result.retry_after_cards,
                "retry_after_minutes": result.retry_after_minutes,
                "intraday_kind": result.intraday_kind,
                "intraday_due_at": to_api_datetime(result.intraday_due_at),
                "intraday_exhausted": result.intraday_exhausted,
                "stage_action": stage_action,
                "schedule_changed": result.schedule_changed,
            }
        )
    return effects


def _encounter_payload(
    encounter: ReviewUnitEncounter,
    *,
    horizon: SprintHorizon | None = None,
    live_state: ReviewUnitState | None = None,
) -> dict[str, Any]:
    snapshot = json.loads(encounter.baseline_state_json)
    if live_state is not None and encounter.selected_rating is None:
        # An unrated glance is previewed against the unit as it is *now*. The
        # frozen baseline predates any failure this unit already served today,
        # and the commit path rates from the live same-day ladder; previewing
        # the stale baseline would promise a different date than the tap books.
        state_data = snapshot.get("state")
        if isinstance(state_data, dict):
            state_data["intraday"] = _intraday_payload(_intraday_from_unit(live_state))
            state_data["early_step"] = live_state.early_step
            state_data["lapse_original_days"] = live_state.lapse_original_interval_days
            state_data["lapse_started_on"] = (
                live_state.lapse_started_on.isoformat()
                if live_state.lapse_started_on
                else None
            )
    return {
        "id": encounter.id,
        "round_id": encounter.round_id,
        "sequence": encounter.sequence,
        "status": encounter.status,
        "selected_rating": encounter.selected_rating,
        "passed": encounter.passed,
        "retry_after_cards": encounter.retry_after_cards,
        "effective_operation_id": encounter.effective_operation_id,
        "closed_at": to_api_datetime(encounter.closed_at),
        # Same fuzz key as the commit path (unit id), so the previewed due date is
        # the one actually booked instead of an unfuzzed approximation.
        "rating_effects": _rating_effects(
            snapshot,
            fuzz_key=encounter.unit_id,
            horizon=horizon,
        ),
    }


def _session_item(
    session: Session,
    study_session_id: str,
    unit_id: str,
) -> ReviewSessionUnit:
    item = (
        session.query(ReviewSessionUnit)
        .filter_by(study_session_id=study_session_id, unit_id=unit_id)
        .one_or_none()
    )
    if item is None:
        raise ValueError("review unit is outside the session")
    return item


def open_unit_review_encounter(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    unit_revision: int,
    encounter_id: str,
    round_id: str,
    baseline: dict[str, Any] | None = None,
) -> dict[str, Any]:
    requested_encounter_id = str(encounter_id or "").strip()
    requested_round_id = str(round_id or "").strip()
    if not requested_encounter_id:
        raise ValueError("encounter_id is required")
    if not requested_round_id:
        raise ValueError("round_id is required")

    study = session.get(StudySession, study_session_id)
    if study is None or study.status != SESSION_ACTIVE:
        raise ValueError("active unit review session required")
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active or state.palace_id != study.palace_id:
        raise ValueError("review unit not found")
    if int(unit_revision) != int(state.revision):
        raise ValueError("review unit changed; rebuild the queue")
    item = _session_item(session, study.id, state.id)

    requested = session.get(ReviewUnitEncounter, requested_encounter_id)
    if requested is not None:
        if requested.study_session_id != study.id or requested.unit_id != state.id:
            raise ValueError("encounter_id belongs to another review unit")
        return get_unit_review_session(session, study.id)

    existing = (
        session.query(ReviewUnitEncounter)
        .filter_by(
            study_session_id=study.id,
            unit_id=state.id,
            status=ENCOUNTER_OPEN,
        )
        .one_or_none()
    )
    if existing is not None:
        return get_unit_review_session(session, study.id)
    if item.status == ITEM_PASSED:
        # Freestyle start must finish this session and open an amend glance
        # instead of reaching here. Formal review still cannot stack encounters.
        raise ValueError("passed review unit cannot start another encounter")

    max_sequence = (
        session.query(func.max(ReviewUnitEncounter.sequence))
        .filter_by(study_session_id=study.id, unit_id=state.id)
        .scalar()
    )
    sequence = int(max_sequence) + 1 if max_sequence is not None else 0
    session.add(
        ReviewUnitEncounter(
            id=requested_encounter_id,
            study_session_id=study.id,
            unit_id=state.id,
            unit_revision=state.revision,
            round_id=requested_round_id,
            sequence=sequence,
            baseline_state_json=json.dumps(baseline or _state_snapshot(state, item), ensure_ascii=False),
            status=ENCOUNTER_OPEN,
        )
    )
    try:
        session.commit()
    except IntegrityError:
        # Two starts for the same unit raced past the `existing` check above (the
        # card glance and a rating's own prepare do this). The partial unique index
        # keeps exactly one open encounter; the loser hands back the winner's glance
        # instead of failing the card with a 500.
        session.rollback()
        winner = (
            session.query(ReviewUnitEncounter)
            .filter_by(study_session_id=study.id, unit_id=state.id, status=ENCOUNTER_OPEN)
            .one_or_none()
        )
        if winner is None:
            raise
        return get_unit_review_session(session, study.id)
    return get_unit_review_session(session, study.id)


def _finish_stale_passed_freestyle_session(
    session: Session,
    study: StudySession,
    unit_id: str,
) -> StudySession | None:
    """Complete a passed glance that never closed its study session.

    Swipe-back mints a new encounter_id. If the previous pass left
    `ReviewSessionUnit.status == passed` with no open encounter, reusing that
    session would 400 `passed review unit cannot start another encounter`.
    Finish it so start can open an amend glance in the same round.
    """
    if study.status != SESSION_ACTIVE:
        return study
    item = (
        session.query(ReviewSessionUnit)
        .filter_by(study_session_id=study.id, unit_id=unit_id)
        .one_or_none()
    )
    if item is None or item.status != ITEM_PASSED:
        return study
    open_row = (
        session.query(ReviewUnitEncounter)
        .filter_by(
            study_session_id=study.id,
            unit_id=unit_id,
            status=ENCOUNTER_OPEN,
        )
        .one_or_none()
    )
    if open_row is not None:
        return study
    _complete_unit_review_session(session, study)
    session.commit()
    return None


def _release_failing_glance_for_new_encounter(
    session: Session,
    *,
    study: StudySession,
    unit_id: str,
    requested_encounter_id: str,
) -> None:
    """Close a still-open 忘记/困难 glance when a new encounter id arrives.

    The parent score already downgraded the unit and scheduled the 重练.
    Returning that open glance would make the retry card start on 困难.
    """
    requested = str(requested_encounter_id or "").strip()
    if not requested:
        return
    existing = (
        session.query(ReviewUnitEncounter)
        .filter_by(
            study_session_id=study.id,
            unit_id=unit_id,
            status=ENCOUNTER_OPEN,
        )
        .one_or_none()
    )
    if existing is None or existing.id == requested or existing.selected_rating not in (1, 2):
        return
    existing.status = ENCOUNTER_CLOSED
    existing.closed_at = utc_now_naive()
    if not existing.close_operation_id:
        existing.close_operation_id = f"retry-handoff:{existing.id}"[:64]
    session.commit()


def _active_successor_state(
    session: Session,
    retired: ReviewUnitState,
) -> ReviewUnitState | None:
    return (
        session.query(ReviewUnitState)
        .filter_by(
            palace_id=retired.palace_id,
            anchor_uid=retired.anchor_uid,
            unit_kind=retired.unit_kind,
            active=True,
        )
        .first()
    )


def start_freestyle_unit_review_session(
    session: Session,
    *,
    unit_id: str,
    unit_revision: int,
    encounter_id: str,
    round_id: str,
    client_source: str | None = None,
    allow_not_due: bool = False,
    card_id: str = "",
    occurrence_id: str = "",
    retry_attempt: int = 0,
) -> dict[str, Any]:
    state = session.get(ReviewUnitState, unit_id)
    if state is not None and not state.active:
        # A structural edit retires the old row and may create its successor under
        # a new id (unit_reconcile). The feed card still holds the old id, so follow
        # the same palace + anchor to the live row instead of failing the start.
        state = _active_successor_state(session, state)
    if state is None or not state.active:
        raise ValueError("review unit not found")

    # Queue projection may reconcile a stale editor document inside its request
    # and return the new revision before that request is committed. Re-project
    # here so the queue card and the session start observe the same unit state.
    #
    # Reconcile flushes but does not commit. Leaving that write transaction open
    # across the rest of this handler (another palace walk, competing-session
    # release) holds SQLite's single writer for the whole start. Every other
    # write — including 做题's overlay ensure — then waits out busy_timeout and
    # comes back 503 "数据正在写入中". Commit the projection before continuing
    # so a glance start is a short write, not a lock on the rest of the product.
    projection = get_palace_unit_projection(session, state.palace_id, allow_reconcile=True)
    if session.new or session.dirty or session.deleted:
        session.commit()
    session.refresh(state)
    if not state.active:
        raise ValueError("review unit not found")
    # Content edits bump revision and may invalidate the previous session.
    # Freestyle adopts the live revision in place instead of failing the feed.
    live_revision = int(state.revision)
    requested_round_id = str(round_id or "").strip()
    if not requested_round_id:
        raise ValueError("round_id is required")
    requested = session.get(ReviewUnitEncounter, str(encounter_id or "").strip())
    identity = _attempt_identity(card_id, occurrence_id, retry_attempt)
    if requested is not None and requested.unit_id == state.id and not identity:
        identity = json.loads(requested.baseline_state_json).get("attempt_identity", {})
    previous_rated = _same_day_attempt_source(
        session, unit_id=state.id, round_id=requested_round_id,
        identity=identity, encounter_id=encounter_id,
    )
    latest_rated = _latest_rated_round_encounter(
        session, unit_id=state.id, round_id=requested_round_id,
    )
    # An attempt the learner already re-practiced still opens: the feed keeps
    # answered cards so swipe-back can read them, and the map needs this session
    # to render. Such a glance is a read-only echo — ``get_unit_review_session``
    # marks it ``rating_editable: false`` and every write path
    # (``_rate_open_encounter`` / undo) still refuses it. A 400 here instead left
    # the card blank, its tap stuck on 未保存 and the round unable to finish.
    not_due_ok = bool(allow_not_due or previous_rated is not None)

    # Drop competing freestyle sessions from other units / clients before opening
    # this card. Prevents multi-palace wall-clock rows that all share one start.
    # Commit here too: the next lookup would autoflush these staged abandons and
    # keep the write transaction open until the encounter commit at the end.
    _release_competing_freestyle_unit_sessions(session, keep_unit_id=state.id)
    if session.new or session.dirty or session.deleted:
        session.commit()

    study = (
        session.query(StudySession)
        .join(ReviewSessionUnit, ReviewSessionUnit.study_session_id == StudySession.id)
        .filter(
            StudySession.scene == FREESTYLE_UNIT_REVIEW_SCENE,
            StudySession.status == SESSION_ACTIVE,
            ReviewSessionUnit.unit_id == state.id,
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if study is not None:
        # Resume path: stamp source if the active session still lacks one.
        normalized_source = _normalize_unit_review_client_source(client_source)
        if normalized_source is not None:
            summary = _load_study_summary(study)
            if summary.get("client_source") not in {"desktop", "pwa"}:
                summary["client_source"] = normalized_source
                study.summary_json = json.dumps(summary, ensure_ascii=False)
                session.commit()
        drifted = (
            session.query(ReviewUnitEncounter)
            .filter_by(
                study_session_id=study.id,
                unit_id=state.id,
                status=ENCOUNTER_OPEN,
            )
            .one_or_none()
        )
        if drifted is not None:
            revision_mismatch = int(drifted.unit_revision) != live_revision
            round_mismatch = str(drifted.round_id or "") != requested_round_id
            if revision_mismatch or round_mismatch:
                if drifted.selected_rating is None:
                    session.delete(drifted)
                else:
                    drifted.status = ENCOUNTER_CLOSED
                    drifted.closed_at = utc_now_naive()
                    if drifted.passed:
                        _complete_unit_review_session(session, study)
                if round_mismatch:
                    if study.status == SESSION_ACTIVE:
                        _abandon_freestyle_study_session(
                            session,
                            study,
                            reason="round_id_mismatch",
                        )
                    study = None
                session.commit()
        if study is not None and study.status != SESSION_ACTIVE:
            study = None

    if study is not None:
        study = _finish_stale_passed_freestyle_session(session, study, state.id)

    if study is None:
        if state.due_date > local_day() and not not_due_ok:
            raise ValueError("review unit is not due")
        created = start_unit_review_session(
            session,
            state.palace_id,
            scene=FREESTYLE_UNIT_REVIEW_SCENE,
            unit_ids=[state.id],
            client_source=client_source,
            allow_not_due=not_due_ok,
            projection=projection,
        )
        study = session.get(StudySession, str(created["id"]))
        if study is None:
            raise ValueError("failed to create unit review session")

    requested_encounter_id = str(encounter_id or "").strip()
    requested = (
        session.get(ReviewUnitEncounter, requested_encounter_id)
        if requested_encounter_id
        else None
    )
    if requested is not None:
        usable = (
            requested.study_session_id == study.id
            and requested.unit_id == state.id
            and int(requested.unit_revision) == live_revision
            and requested.status == ENCOUNTER_OPEN
        )
        if not usable:
            if requested.unit_id == state.id:
                requested_encounter_id = str(uuid.uuid4())
            elif requested.study_session_id != study.id:
                raise ValueError("encounter_id belongs to another review unit")

    _release_failing_glance_for_new_encounter(
        session,
        study=study,
        unit_id=state.id,
        requested_encounter_id=requested_encounter_id,
    )
    item = _session_item(session, study.id, state.id)
    baseline = _state_snapshot(state, item)
    if previous_rated is not None:
        baseline = json.loads(previous_rated.baseline_state_json)
        baseline["amend_source_id"] = previous_rated.id
    elif latest_rated is not None and _effective_rating_day(session, latest_rated) == local_day():
        # A freestyle session is a viewing/time owner, not the retry history.
        # Moving past another card may have abandoned it; carry failed attempts
        # into the new session without rolling the schedule back.
        previous_item = _session_item(session, latest_rated.study_session_id, state.id)
        for key in ("retry_count", "hard_count", "again_count"):
            baseline["item"][key] = getattr(previous_item, key)
    if identity:
        baseline["attempt_identity"] = identity
    return open_unit_review_encounter(
        session,
        study_session_id=study.id,
        unit_id=state.id,
        unit_revision=live_revision,
        encounter_id=requested_encounter_id,
        round_id=round_id,
        baseline=baseline,
    )


def cancel_unrated_unit_review_encounter(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    encounter_id: str,
) -> dict[str, Any]:
    """Cancel a freestyle glance that never received a rating.

    Leaving a card without scoring used to leave the open encounter + active
    StudySession in place; the eventual pass then billed wall clock from first
    open. Cancelling drops the unrated encounter and abandons empty sessions.
    """
    requested_encounter_id = str(encounter_id or "").strip()
    if not requested_encounter_id:
        raise ValueError("encounter_id is required")
    study = session.get(StudySession, study_session_id)
    encounter = session.get(ReviewUnitEncounter, requested_encounter_id)
    if (
        study is None
        or encounter is None
        or encounter.study_session_id != study.id
        or encounter.unit_id != unit_id
    ):
        raise ValueError("review encounter not found")
    if encounter.status == ENCOUNTER_CLOSED:
        return {
            "session_status": study.status,
            "cancelled": False,
            "reason": "already_closed",
        }
    if encounter.selected_rating is not None:
        raise ValueError("rated encounters must be closed, not cancelled")
    if encounter.status != ENCOUNTER_OPEN:
        raise ValueError("open review encounter required")

    session.delete(encounter)
    abandoned = False
    if (
        study.scene == FREESTYLE_UNIT_REVIEW_SCENE
        and study.status == SESSION_ACTIVE
        and not _session_has_billable_progress(session, study.id)
    ):
        _abandon_freestyle_study_session(
            session,
            study,
            reason="unrated_leave",
        )
        abandoned = True
    session.commit()
    return {
        "session_status": study.status,
        "cancelled": True,
        "abandoned": abandoned,
        "study_session_id": study.id,
    }


def _apply_rating_from_snapshot(
    session: Session,
    state: ReviewUnitState,
    item: ReviewSessionUnit,
    snapshot: dict[str, Any],
    rating: int,
    *,
    horizon: SprintHorizon | None = None,
    exclude_operation_ids: set[str] | None = None,
    intraday_baseline: IntradayState | None = None,
) -> Any:
    _restore_snapshot(state, item, snapshot)
    if intraday_baseline is not None:
        # A fresh attempt (a retry or a new step) rates from the unit's current
        # same-day ladder. The attempt's baseline snapshot may predate the
        # failure that scheduled this retry; rewinding the ladder would turn the
        # retry into a first pass.
        _apply_intraday(state, intraday_baseline)
    today = local_day()
    now = utc_now_naive()
    schedule_locked, locked_due_date = _schedule_lock_from_due(
        state.due_date,
        today,
        intraday_due_at=state.intraday_due_at,
        now=now,
    )
    fsrs_state = _fsrs_state_from_snapshot(snapshot["state"])
    if fsrs_state is None:
        # A snapshot recorded before the switch has no FSRS fields. Replaying
        # the remaining effective ledger is exact; starting from an empty card
        # would silently discard the unit's real history.
        fsrs_state = _replay_fsrs_state(
            session,
            state,
            exclude_operation_ids=exclude_operation_ids,
        )
    result = rate_unit(
        stage_index=state.stage_index,
        has_passed=state.has_passed,
        rating=rating,
        had_failure_in_encounter=item.retry_count > 0,
        # Same key the preview used, so the committed due date is the one the
        # button promised. Keyed on the unit so a same-day cohort still scatters.
        fuzz_key=state.id,
        today=today,
        schedule_locked=schedule_locked,
        locked_due_date=locked_due_date,
        hard_penalized_today=state.hard_penalized_on == today,
        horizon=horizon,
        fsrs_state=fsrs_state,
        intraday=_intraday_from_unit(state),
        now=now,
        booked_due_date=state.due_date,
        early_step=state.early_step,
        lapse_original_days=state.lapse_original_interval_days,
        lapse_started_on=state.lapse_started_on,
    )
    _apply_fsrs_state(state, result.fsrs_state)
    if result.intraday is not None:
        _apply_intraday(state, result.intraday)
    state.early_step = result.early_step
    state.stage_index = result.stage_index
    state.due_date = result.due_date
    state.lapse_original_interval_days = result.lapse_original_days
    state.lapse_started_on = result.lapse_started_on
    if result.hard_penalty_applied:
        state.hard_penalized_on = today
    if result.passed:
        state.has_passed = True
        state.last_passed_at = now
        item.status = ITEM_PASSED
        item.final_rating = rating
        item.completed_at = now
    else:
        item.status = ITEM_RETRY
        item.retry_count += 1
        item.final_rating = rating
        item.completed_at = None
        if rating == 1:
            item.again_count += 1
        else:
            item.hard_count += 1
    return result


_REVIEW_CARD_REVISION = re.compile(r"^(review_unit:[^:]+):r\d+$")


def _identity_card_key(value: Any) -> str:
    """An attempt's card identity ignores the content revision.

    ``review_unit:<unit>:rN`` names the same review work at every revision. An
    inline edit legitimately bumps N while the glance is open (the server adopts
    the live revision), so comparing the raw id rejected the learner's next tap
    with "rating attempt identity mismatch" — the first tap after 返回学习 failed
    and only a second one (after a reload) landed.
    """
    text = str(value or "").strip()
    match = _REVIEW_CARD_REVISION.match(text)
    return match.group(1) if match else text


def attempt_identity_matches(stored: Any, current: Any) -> bool:
    left = stored if isinstance(stored, dict) else {}
    right = current if isinstance(current, dict) else {}
    if not left or not right:
        return left == right
    return (
        _identity_card_key(left.get("card_id")) == _identity_card_key(right.get("card_id"))
        and str(left.get("occurrence_id") or "").strip()
        == str(right.get("occurrence_id") or "").strip()
        and int(left.get("retry_attempt") or 0) == int(right.get("retry_attempt") or 0)
    )


def _attempt_identity(card_id: str, occurrence_id: str, retry_attempt: int) -> dict[str, Any]:
    if not card_id and not occurrence_id:
        return {}
    return {
        "card_id": _identity_card_key(card_id or occurrence_id),
        "occurrence_id": str(occurrence_id or "").strip(),
        "retry_attempt": int(retry_attempt) if occurrence_id else 0,
    }


def _latest_rated_round_encounter(
    session: Session, *, unit_id: str, round_id: str,
) -> ReviewUnitEncounter | None:
    return (
        session.query(ReviewUnitEncounter)
        .filter_by(unit_id=unit_id, round_id=round_id)
        .filter(ReviewUnitEncounter.selected_rating.isnot(None))
        .order_by(ReviewUnitEncounter.created_at.desc(), ReviewUnitEncounter.sequence.desc())
        .first()
    )


def _same_day_attempt_source(
    session: Session, *, unit_id: str, round_id: str,
    identity: dict[str, Any], encounter_id: str,
) -> ReviewUnitEncounter | None:
    candidates = (
        session.query(ReviewUnitEncounter)
        .filter_by(unit_id=unit_id, round_id=round_id)
        .filter(ReviewUnitEncounter.selected_rating.isnot(None))
        .order_by(ReviewUnitEncounter.created_at.desc(), ReviewUnitEncounter.sequence.desc())
        .all()
    )
    for candidate in candidates:
        matches = candidate.id == encounter_id or (
            bool(identity)
            and attempt_identity_matches(
                json.loads(candidate.baseline_state_json).get("attempt_identity"),
                identity,
            )
        )
        if matches and _effective_rating_day(session, candidate) == local_day():
            return candidate
    return None


def _effective_rating_day(session: Session, encounter: ReviewUnitEncounter) -> date | None:
    op_id = str(encounter.effective_operation_id or "").strip()
    if not op_id:
        return None
    operation = session.get(ReviewUnitRatingOperation, op_id)
    if (
        operation is None
        or operation.undone_at is not None
        or operation.replaced_at is not None
        or operation.created_at is None
    ):
        return None
    return local_calendar_day_of(operation.created_at)



def _has_later_attempt(session: Session, encounter: ReviewUnitEncounter) -> bool:
    """Read-only constraint shared by session display and mutation validation."""
    later = (
        session.query(ReviewUnitEncounter)
        .filter(
            ReviewUnitEncounter.unit_id == encounter.unit_id,
            ReviewUnitEncounter.created_at > encounter.created_at,
            ReviewUnitEncounter.selected_rating.isnot(None),
        )
        .all()
    )
    own_identity = json.loads(encounter.baseline_state_json).get("attempt_identity")
    for candidate in later:
        if _effective_rating_day(session, candidate) is None:
            continue
        candidate_baseline = json.loads(candidate.baseline_state_json)
        same_attempt = (
            bool(own_identity)
            and candidate.round_id == encounter.round_id
            and candidate_baseline.get("attempt_identity") == own_identity
        ) or candidate_baseline.get("amend_source_id") == encounter.id
        if not same_attempt:
            return True
    return False


class LaterAttemptExistsError(ValueError):
    """一次评分想改写/撤销的尝试，后面已经有更新的真实练习。

    对客户端是终态：同样的 operation 再发多少次都不会成功。路由层把它翻成
    ``superseded_attempt`` 错误码，前端据此停止重试并提示去最近一次练习修改。
    """


def _rating_editable(session: Session, encounter: ReviewUnitEncounter) -> bool:
    """Can this glance's grade still be written?

    A glance opened to amend an earlier attempt carries that attempt as its
    ``amend_source_id``. The later practice may not be newer than *this* glance
    (an amend glance is minted seconds ago), so the source attempt has to be
    asked too or a locked card would look editable.
    """
    if _has_later_attempt(session, encounter):
        return False
    baseline = json.loads(encounter.baseline_state_json)
    source_id = str(baseline.get("amend_source_id") or "").strip()
    if not source_id:
        return True
    source = session.get(ReviewUnitEncounter, source_id)
    return source is None or not _has_later_attempt(session, source)


def rating_attempt_is_superseded(
    session: Session,
    *,
    round_id: str,
    unit_id: str,
    encounter_id: str = "",
    card_id: str = "",
    occurrence_id: str = "",
    retry_attempt: int = 0,
) -> bool:
    """True when this attempt can never be rated again (a later practice exists).

    The 未保存 outbox asks before offering a retry: replaying such an intent can
    only answer ``superseded_attempt``. The stored encounter id may be a glance
    the server never created (its start was refused), so the attempt identity the
    client sent is the fallback.
    """
    attempted = str(unit_id or "").strip()
    if not attempted:
        return False
    requested_id = str(encounter_id or "").strip()
    encounter = session.get(ReviewUnitEncounter, requested_id) if requested_id else None
    if encounter is not None and encounter.unit_id != attempted:
        encounter = None
    if encounter is None:
        encounter = _same_day_attempt_source(
            session,
            unit_id=attempted,
            round_id=str(round_id or "").strip(),
            identity=_attempt_identity(card_id, occurrence_id, retry_attempt),
            encounter_id=requested_id,
        )
    return encounter is not None and _has_later_attempt(session, encounter)


def _assert_no_later_attempt(session: Session, encounter: ReviewUnitEncounter) -> None:
    """An old correction must never roll back a subsequently practiced attempt."""
    if _has_later_attempt(session, encounter):
        raise LaterAttemptExistsError("已有后续真实练习，不能修改或撤销较早的评分；请修改最近一次练习的评分")


def _closed_rating_is_today(
    session: Session,
    encounter: ReviewUnitEncounter,
    operation: ReviewUnitRatingOperation,
) -> bool:
    if encounter.effective_operation_id != operation.id:
        return False
    if operation.undone_at is not None or operation.replaced_at is not None:
        return False
    if operation.created_at is None:
        return False
    return local_calendar_day_of(operation.created_at) == local_calendar_day_of(utc_now_naive())


def _rate_open_encounter(
    session: Session,
    *,
    study: StudySession,
    state: ReviewUnitState,
    item: ReviewSessionUnit,
    encounter: ReviewUnitEncounter,
    operation_id: str,
    rating: int,
    batch_id: str | None = None,
    baseline_from: ReviewUnitEncounter | None = None,
) -> dict[str, Any]:
    """Apply a rating without committing.

    Corrections reuse this attempt's frozen baseline. A distinct retry has a
    new baseline containing the previous demotion and failed-attempt counters.
    """
    baseline = json.loads(encounter.baseline_state_json)
    source = baseline_from or encounter
    if source is encounter and not encounter.effective_operation_id and baseline.get("amend_source_id"):
        amend_source = session.get(ReviewUnitEncounter, baseline["amend_source_id"])
        if amend_source is None:
            raise ValueError("rating correction source not found")
        source = amend_source
    _assert_no_later_attempt(session, source)
    own_previous_id = encounter.effective_operation_id
    own_previous = (
        session.get(ReviewUnitRatingOperation, own_previous_id) if own_previous_id else None
    )
    if own_previous is not None and own_previous.undone_at is None and own_previous.replaced_at is None and own_previous.rating == rating and not batch_id:
        return json.loads(own_previous.after_state_json)
    previous_id = source.effective_operation_id or encounter.effective_operation_id
    previous = session.get(ReviewUnitRatingOperation, previous_id) if previous_id else None
    before = json.loads(source.baseline_state_json)
    # Only a correction inside the same encounter rewinds the same-day ladder.
    # A retry (or a correction of an earlier encounter's rating) must start from
    # where the unit actually is now, or the wait it just served is forgotten.
    correcting_same_encounter = own_previous is not None and source is encounter
    live_intraday = None if correcting_same_encounter else _intraday_from_unit(state)
    result = _apply_rating_from_snapshot(
        session,
        state,
        item,
        before,
        rating,
        horizon=_sprint_horizon(session),
        exclude_operation_ids={previous.id} if previous is not None else None,
        intraday_baseline=live_intraday,
    )
    now = utc_now_naive()
    if previous is not None:
        previous.replaced_at = now
    encounter.effective_operation_id = operation_id
    encounter.selected_rating = rating
    encounter.passed = result.passed
    encounter.retry_after_cards = result.retry_after_cards
    after = {
        "operation_id": operation_id,
        "study_session_id": study.id,
        "encounter_id": encounter.id,
        "amended": previous is not None,
        "unit": unit_payload(state),
        "passed": result.passed,
        "retry_after_cards": result.retry_after_cards,
        "retry_after_minutes": result.retry_after_minutes,
        "intraday_kind": result.intraday_kind,
        "intraday_due_at": to_api_datetime(result.intraday_due_at),
        "intraday_exhausted": result.intraday_exhausted,
        "rating": rating,
        "rating_label": RATING_LABELS[rating],
        "session_status": item.status,
        "schedule_changed": result.schedule_changed,
        "encounter": _encounter_payload(
            encounter, horizon=_sprint_horizon(session), live_state=state
        ),
    }
    session.add(
        ReviewUnitRatingOperation(
            id=operation_id,
            encounter_id=encounter.id,
            study_session_id=study.id,
            unit_id=state.id,
            palace_id=state.palace_id,
            unit_revision=state.revision,
            rating=rating,
            passed=result.passed,
            retry_after_cards=result.retry_after_cards,
            before_state_json=json.dumps(before, ensure_ascii=False),
            after_state_json=json.dumps(after, ensure_ascii=False),
            replaces_operation_id=previous.id if previous is not None else None,
            batch_id=batch_id,
        )
    )
    return after


def _close_rated_encounter(
    session: Session,
    *,
    study: StudySession,
    encounter: ReviewUnitEncounter,
    close_operation_id: str,
) -> None:
    """Close a rated encounter without committing."""
    if encounter.status == ENCOUNTER_CLOSED:
        return
    if encounter.effective_operation_id is None or encounter.selected_rating is None:
        raise ValueError("rate the review unit before leaving it")
    closed_at = utc_now_naive()
    encounter.status = ENCOUNTER_CLOSED
    encounter.close_operation_id = close_operation_id
    encounter.closed_at = closed_at
    if encounter.passed and study.scene == FREESTYLE_UNIT_REVIEW_SCENE:
        _complete_unit_review_session(session, study)


def _create_one_unit_freestyle_session(
    session: Session,
    state: ReviewUnitState,
    *,
    allow_not_due: bool,
) -> tuple[StudySession, ReviewSessionUnit]:
    """Open a sibling freestyle session without releasing the current card."""
    if state.due_date > local_day() and not allow_not_due:
        raise ValueError("review unit is not due")
    palace = session.get(Palace, state.palace_id)
    now = utc_now_naive()
    study = StudySession(
        id=uuid.uuid4().hex,
        status=SESSION_ACTIVE,
        scene=FREESTYLE_UNIT_REVIEW_SCENE,
        target_type="palace",
        target_id=state.palace_id,
        palace_id=state.palace_id,
        title=str(palace.title or "") if palace is not None else "",
        started_at=now,
        summary_json="{}",
        progress_json="{}",
        events_json="[]",
    )
    session.add(study)
    item = ReviewSessionUnit(
        study_session_id=study.id,
        unit_id=state.id,
        unit_revision=state.revision,
        node_uids_json=state.node_uids_json,
        order_index=0,
        status=ITEM_PENDING,
    )
    session.add(item)
    session.flush()
    return study, item


def _create_open_encounter(
    session: Session,
    *,
    study: StudySession,
    state: ReviewUnitState,
    item: ReviewSessionUnit,
    encounter_id: str,
    round_id: str,
) -> ReviewUnitEncounter:
    encounter = ReviewUnitEncounter(
        id=encounter_id,
        study_session_id=study.id,
        unit_id=state.id,
        unit_revision=state.revision,
        round_id=round_id,
        sequence=0,
        baseline_state_json=json.dumps(_state_snapshot(state, item), ensure_ascii=False),
        status=ENCOUNTER_OPEN,
    )
    session.add(encounter)
    session.flush()
    return encounter


def _due_states_for_palace(session: Session, palace_id: int) -> list[ReviewUnitState]:
    # A unit waiting for its same-day step/retry is still due today, but a
    # palace batch must not rate it early: that would skip the spacing.
    moment = utc_now_naive()
    return (
        session.query(ReviewUnitState)
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= local_day(),
            or_(
                ReviewUnitState.intraday_due_at.is_(None),
                ReviewUnitState.intraday_due_at <= moment,
            ),
        )
        .order_by(ReviewUnitState.due_date.asc(), ReviewUnitState.id.asc())
        .all()
    )


def _round_rated_unit_ids(session: Session, palace_id: int, round_id: str) -> set[str]:
    rows = (
        session.query(ReviewUnitEncounter.unit_id)
        .join(ReviewUnitState, ReviewUnitState.id == ReviewUnitEncounter.unit_id)
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitEncounter.round_id == round_id,
            ReviewUnitEncounter.selected_rating.isnot(None),
        )
        .all()
    )
    return {str(unit_id) for (unit_id,) in rows}


def _remaining_due_count(session: Session, palace_id: int) -> int:
    # Everything still owed today, including a unit waiting for its same-day
    # re-check: it is due, just not servable this minute.
    return (
        session.query(func.count(ReviewUnitState.id))
        .filter(
            ReviewUnitState.palace_id == palace_id,
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= local_day(),
        )
        .scalar()
        or 0
    )


def _batch_result_from_operations(
    session: Session,
    operations: list[ReviewUnitRatingOperation],
    *,
    palace_id: int,
    batch_id: str,
) -> dict[str, Any]:
    items = [json.loads(operation.after_state_json) for operation in operations]
    return {
        "batch_id": batch_id,
        "palace_id": palace_id,
        "rating": operations[0].rating if operations else None,
        "items": items,
        "rated_unit_ids": [operation.unit_id for operation in operations],
        "remaining_due_count": _remaining_due_count(session, palace_id),
        "current": next((item for item in items if item.get("operation_id") == batch_id), None),
    }


def _payload_encounter_id(payload: dict[str, Any], unit_id: str) -> str:
    for item in payload.get("units") or []:
        if str(item.get("id") or "") != unit_id:
            continue
        encounter = item.get("encounter")
        if isinstance(encounter, dict):
            return str(encounter.get("id") or "")
    return ""


def _ensure_open_freestyle_rating_target(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    unit_revision: int,
    encounter_id: str,
    round_id: str | None,
    card_id: str = "",
    occurrence_id: str = "",
    retry_attempt: int = 0,
    adopt_live_revision: bool = False,
) -> tuple[StudySession, ReviewUnitState, ReviewSessionUnit, ReviewUnitEncounter]:
    """Return a live open glance, reopening the same round if the old session died.

    Reopening retains the attempt identity; a retry never inherits the original
    card's baseline merely because both belong to the same round.

    Freestyle adopts the live revision: a content or topology edit bumps it, and
    the reopen branch below opens a fresh encounter at the live revision. Only
    formal review keeps the strict stale-revision rejection.
    """
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active:
        raise ValueError("review unit not found")
    if not adopt_live_revision and int(unit_revision) != int(state.revision):
        raise ValueError("review unit changed; rebuild the queue")

    requested_session_id = str(study_session_id or "").strip()
    requested_encounter_id = str(encounter_id or "").strip()
    if not requested_encounter_id:
        raise ValueError("rating identity mismatch")
    study = session.get(StudySession, requested_session_id) if requested_session_id else None
    encounter = session.get(ReviewUnitEncounter, requested_encounter_id)
    if encounter is not None and str(encounter.unit_id or "") != str(state.id):
        raise ValueError("rating identity mismatch")
    requested_round_id = str(round_id or "").strip()
    if not requested_round_id and encounter is not None:
        requested_round_id = str(encounter.round_id or "").strip()

    live = (
        study is not None
        and study.status == SESSION_ACTIVE
        and state.palace_id == study.palace_id
        and encounter is not None
        and encounter.study_session_id == study.id
        and encounter.unit_id == state.id
        and encounter.status == ENCOUNTER_OPEN
        and (not requested_round_id or str(encounter.round_id or "") == requested_round_id)
        and encounter.unit_revision == state.revision
    )
    if live:
        assert study is not None and encounter is not None
        identity = _attempt_identity(card_id, occurrence_id, retry_attempt)
        snapshot = json.loads(encounter.baseline_state_json)
        stored_identity = snapshot.get("attempt_identity")
        if identity and stored_identity and not attempt_identity_matches(stored_identity, identity):
            raise ValueError("rating attempt identity mismatch")
        if identity and identity != stored_identity:
            # A revision bump is the same attempt; keep the stored identity in
            # step with the live card id so the next tap compares equal.
            snapshot["attempt_identity"] = identity
            encounter.baseline_state_json = json.dumps(snapshot, ensure_ascii=False)
        return study, state, _session_item(session, study.id, state.id), encounter

    can_reopen = bool(requested_round_id) and (
        study is None or study.scene == FREESTYLE_UNIT_REVIEW_SCENE
    )
    if not can_reopen:
        if study is None or study.status != SESSION_ACTIVE:
            raise ValueError("active unit review session required")
        raise ValueError("open review encounter required")

    started = start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=int(state.revision),
        encounter_id=requested_encounter_id or str(uuid.uuid4()),
        round_id=requested_round_id,
        allow_not_due=True,
        card_id=card_id,
        occurrence_id=occurrence_id,
        retry_attempt=retry_attempt,
    )
    session.refresh(state)
    study = session.get(StudySession, str(started.get("id") or ""))
    live_encounter_id = _payload_encounter_id(started, state.id)
    encounter = session.get(ReviewUnitEncounter, live_encounter_id) if live_encounter_id else None
    if (
        study is None
        or study.status != SESSION_ACTIVE
        or state.palace_id != study.palace_id
        or encounter is None
        or encounter.study_session_id != study.id
        or encounter.unit_id != state.id
        or encounter.status != ENCOUNTER_OPEN
    ):
        raise ValueError("open review encounter required")
    return study, state, _session_item(session, study.id, state.id), encounter


def rate_review_unit(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    unit_revision: int,
    encounter_id: str,
    operation_id: str,
    rating: int | str,
    round_id: str | None = None,
    commit: bool = True,
    card_id: str = "",
    occurrence_id: str = "",
    retry_attempt: int = 0,
    adopt_live_revision: bool = False,
) -> dict[str, Any]:
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")
    existing = session.get(ReviewUnitRatingOperation, op_id)
    if existing is not None:
        if existing.unit_id != unit_id:
            raise ValueError("operation_id belongs to another encounter")
        return json.loads(existing.after_state_json)
    study, state, item, encounter = _ensure_open_freestyle_rating_target(
        session,
        study_session_id=study_session_id,
        unit_id=unit_id,
        unit_revision=unit_revision,
        encounter_id=encounter_id,
        round_id=round_id,
        card_id=card_id,
        occurrence_id=occurrence_id,
        retry_attempt=retry_attempt,
        adopt_live_revision=adopt_live_revision,
    )
    after = _rate_open_encounter(
        session,
        study=study,
        state=state,
        item=item,
        encounter=encounter,
        operation_id=op_id,
        rating=normalize_rating(rating),
    )
    if commit:
        session.commit()
    return after


def _latest_effective_encounter(session: Session, unit_id: str) -> ReviewUnitEncounter | None:
    """The encounter whose live rating currently stands for this unit, if any."""
    candidates = (
        session.query(ReviewUnitEncounter)
        .filter(
            ReviewUnitEncounter.unit_id == unit_id,
            ReviewUnitEncounter.effective_operation_id.isnot(None),
        )
        .order_by(ReviewUnitEncounter.created_at.desc(), ReviewUnitEncounter.sequence.desc())
        .all()
    )
    for candidate in candidates:
        if _effective_rating_day(session, candidate) is not None:
            return candidate
    return None


def rerate_unit_rating(
    session: Session,
    *,
    unit_id: str,
    operation_id: str,
    rating: int | str,
    expected_revision: int,
    commit: bool = True,
) -> dict[str, Any]:
    """Change the one rating of a 复习单元, whenever it was given.

    Semantics (single source, shared by 正式复习 and 随心模式): a review unit has
    exactly one rating. The unit is a cut of the mind map by its permanent marks,
    and each rating in 随心模式 is a rating of one such unit. Re-rating replaces
    that rating and recomputes the unit's schedule from the frozen pre-rating
    baseline, as if the new rating had been given first. It does not stack a
    second promotion on top of the old one.
    """
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")
    existing = session.get(ReviewUnitRatingOperation, op_id)
    if existing is not None:
        if existing.unit_id != unit_id:
            raise ValueError("operation_id belongs to another review unit")
        return json.loads(existing.after_state_json)
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active:
        raise ValueError("review unit not found")
    if int(expected_revision) != state.revision:
        raise ValueError("review unit changed; reload before changing its rating")
    encounter = _latest_effective_encounter(session, unit_id)
    if encounter is None:
        raise ValueError("this review unit has no rating to change")
    study = session.get(StudySession, encounter.study_session_id)
    if study is None:
        raise ValueError("review session not found")
    item = _session_item(session, study.id, unit_id)
    after = _rate_open_encounter(
        session,
        study=study,
        state=state,
        item=item,
        encounter=encounter,
        operation_id=op_id,
        rating=normalize_rating(rating),
    )
    if commit:
        session.commit()
    return after


def rerate_unit_ratings(
    session: Session,
    *,
    palace_id: int,
    rating: int | str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Set one rating on several units of one palace, all or nothing.

    Used by the L1 cascade: a permanent mark's descendant marks are separate
    units, and each keeps the single-rating rule of `rerate_unit_rating`. A
    failing item rolls back every item, so the cascade never half-applies.
    """
    if not items:
        raise ValueError("no review units to change")
    results: list[dict[str, Any]] = []
    try:
        for item in items:
            unit_id = str(item.get("unit_id") or "")
            state = session.get(ReviewUnitState, unit_id)
            if state is None or state.palace_id != palace_id:
                raise ValueError("review unit does not belong to this palace")
            results.append(
                rerate_unit_rating(
                    session,
                    unit_id=unit_id,
                    operation_id=str(item.get("operation_id") or ""),
                    rating=rating,
                    expected_revision=int(item.get("expected_revision") or 0),
                    commit=False,
                )
            )
        session.commit()
    except ValueError:
        session.rollback()
        raise
    return {"items": results}


def list_latest_unit_ratings(session: Session, palace_id: int) -> dict[str, dict[str, Any]]:
    """Current live rating per active unit of one palace, for the rating view."""
    states = (
        session.query(ReviewUnitState)
        .filter_by(palace_id=palace_id, active=True)
        .all()
    )
    result: dict[str, dict[str, Any]] = {}
    for state in states:
        encounter = _latest_effective_encounter(session, state.id)
        if encounter is None or encounter.selected_rating is None:
            continue
        operation = session.get(ReviewUnitRatingOperation, encounter.effective_operation_id)
        if operation is None:
            continue
        result[state.id] = {
            "rating": encounter.selected_rating,
            "operation_id": operation.id,
            "revision": state.revision,
        }
    return result


def rate_palace_due_units(
    session: Session,
    *,
    palace_id: int,
    operation_id: str,
    rating: int | str,
    round_id: str,
    current: dict[str, Any] | None,
    exclude_unit_ids: list[str] | None = None,
    include_unit_ids: list[str] | None = None,
    commit: bool = True,
    adopt_live_revision: bool = False,
) -> dict[str, Any]:
    """Rate the open current card, plus mature still-due siblings.

    First-learning siblings are not batch-rated: they have never passed and
    must stay one-by-one. A later palace rating overwrites this round's
    include/exclude batch for units already in the target set. Sibling units
    get a 0-second encounter so only the card under the viewport bills time.
    """
    batch_id = str(operation_id or "").strip()
    requested_round_id = str(round_id or "").strip()
    if not batch_id:
        raise ValueError("operation_id is required")
    if not requested_round_id:
        raise ValueError("round_id is required")
    existing = (
        session.query(ReviewUnitRatingOperation)
        .filter(ReviewUnitRatingOperation.batch_id == batch_id)
        .order_by(ReviewUnitRatingOperation.created_at.asc())
        .all()
    )
    if existing:
        return _batch_result_from_operations(
            session, existing, palace_id=int(palace_id), batch_id=batch_id
        )
    if session.get(ReviewUnitRatingOperation, batch_id) is not None:
        raise ValueError("operation_id belongs to another encounter")

    # Heal hash lag before we freeze the due set.
    get_palace_unit_projection(session, int(palace_id), allow_reconcile=True)
    normalized = normalize_rating(rating)
    excluded = {str(unit_id).strip() for unit_id in (exclude_unit_ids or []) if str(unit_id).strip()}
    included = {str(unit_id).strip() for unit_id in (include_unit_ids or []) if str(unit_id).strip()}
    current_payload = current if isinstance(current, dict) else None
    current_unit_id = str((current_payload or {}).get("unit_id") or "").strip()
    current_encounter_id = str((current_payload or {}).get("encounter_id") or "").strip()
    current_session_id = str((current_payload or {}).get("study_session_id") or "").strip()
    if current_payload is None or not current_unit_id or not current_encounter_id or not current_session_id:
        raise ValueError("current open encounter is required")

    current_state = session.get(ReviewUnitState, current_unit_id)
    if current_state is None or not current_state.active or current_state.palace_id != int(palace_id):
        raise ValueError("review unit not found")
    current_revision = int(current_payload.get("unit_revision") or 0)
    current_study, current_state, current_item, current_encounter = _ensure_open_freestyle_rating_target(
        session,
        study_session_id=current_session_id,
        unit_id=current_unit_id,
        unit_revision=current_revision,
        encounter_id=current_encounter_id,
        round_id=requested_round_id,
        card_id=str(current_payload.get("card_id") or ""),
        occurrence_id=str(current_payload.get("occurrence_id") or ""),
        retry_attempt=int(current_payload.get("retry_attempt") or 0),
        adopt_live_revision=adopt_live_revision,
    )
    if current_study.palace_id != int(palace_id):
        raise ValueError("open review encounter required")

    targets: dict[str, ReviewUnitState] = {}
    for state in _due_states_for_palace(session, int(palace_id)):
        if state.id == current_state.id:
            targets[state.id] = state
            continue
        if state.id in excluded or not state.has_passed:
            continue
        targets[state.id] = state
    for unit_id in included:
        if unit_id in excluded or unit_id in targets:
            continue
        extra = session.get(ReviewUnitState, unit_id)
        if extra is None or not extra.active or extra.palace_id != int(palace_id):
            continue
        if extra.id != current_state.id and not extra.has_passed:
            continue
        targets[extra.id] = extra
    targets[current_state.id] = current_state

    operations: list[ReviewUnitRatingOperation] = []
    _rate_open_encounter(
        session,
        study=current_study,
        state=current_state,
        item=current_item,
        encounter=current_encounter,
        operation_id=batch_id,
        rating=normalized,
        batch_id=batch_id,
    )
    current_op = session.get(ReviewUnitRatingOperation, batch_id)
    if current_op is not None:
        operations.append(current_op)

    for unit_id, state in targets.items():
        if unit_id == current_state.id:
            continue
        sibling_op_id = f"{batch_id}:{state.id}"
        original = _latest_rated_round_encounter(
            session,
            unit_id=state.id,
            round_id=requested_round_id,
        )
        batch_identity = json.loads(current_encounter.baseline_state_json).get("attempt_identity", {})
        real_retry = bool(batch_identity.get("occurrence_id"))
        sibling_identity = (
            json.loads(original.baseline_state_json).get("attempt_identity", {})
            if original is not None else {}
        )
        if (
            original is not None
            and _effective_rating_day(session, original) == local_day()
            and (not real_retry or sibling_identity == batch_identity)
        ):
            study = session.get(StudySession, original.study_session_id)
            if study is None:
                raise ValueError("review encounter not found")
            item = _session_item(session, study.id, state.id)
            _rate_open_encounter(
                session,
                study=study,
                state=state,
                item=item,
                encounter=original,
                operation_id=sibling_op_id,
                rating=normalized,
                batch_id=batch_id,
                baseline_from=original,
            )
            sibling_op = session.get(ReviewUnitRatingOperation, sibling_op_id)
            if sibling_op is not None:
                operations.append(sibling_op)
            continue
        sibling_encounter_id = f"{batch_id}:enc:{state.id}"
        study, item = _create_one_unit_freestyle_session(
            session,
            state,
            allow_not_due=state.due_date > local_day(),
        )
        encounter = _create_open_encounter(
            session,
            study=study,
            state=state,
            item=item,
            encounter_id=sibling_encounter_id,
            round_id=requested_round_id,
        )
        sibling_baseline = json.loads(encounter.baseline_state_json)
        if batch_identity:
            sibling_baseline["attempt_identity"] = batch_identity
        if original is not None and _effective_rating_day(session, original) == local_day():
            previous_item = _session_item(session, original.study_session_id, state.id)
            for key in ("retry_count", "hard_count", "again_count"):
                sibling_baseline["item"][key] = getattr(previous_item, key)
        encounter.baseline_state_json = json.dumps(sibling_baseline, ensure_ascii=False)
        _rate_open_encounter(
            session,
            study=study,
            state=state,
            item=item,
            encounter=encounter,
            operation_id=sibling_op_id,
            rating=normalized,
            batch_id=batch_id,
        )
        _close_rated_encounter(
            session,
            study=study,
            encounter=encounter,
            close_operation_id=f"{sibling_op_id}:close",
        )
        if study.status == SESSION_ACTIVE:
            # Failed siblings must not linger as a second live freestyle session.
            study.status = SESSION_ABANDONED
            study.ended_at = utc_now_naive()
            study.completion_method = "palace_due_batch"
        sibling_op = session.get(ReviewUnitRatingOperation, sibling_op_id)
        if sibling_op is not None:
            operations.append(sibling_op)

    if commit:
        session.commit()
    return _batch_result_from_operations(
        session, operations, palace_id=int(palace_id), batch_id=batch_id
    )


def _undo_one_rating_operation(
    session: Session,
    operation: ReviewUnitRatingOperation,
    *,
    allow_closed: bool,
) -> dict[str, Any]:
    encounter = session.get(ReviewUnitEncounter, operation.encounter_id)
    if encounter is None:
        raise ValueError("only the current open encounter can be undone")
    if encounter.status != ENCOUNTER_OPEN and not allow_closed:
        raise ValueError("only the current open encounter can be undone")
    if encounter.status == ENCOUNTER_OPEN and encounter.effective_operation_id != operation.id:
        raise ValueError("only the effective rating can be undone")
    state = session.get(ReviewUnitState, operation.unit_id)
    if state is None:
        raise ValueError("review unit not found")
    item = _session_item(session, operation.study_session_id, operation.unit_id)
    _assert_no_later_attempt(session, encounter)
    snapshot = json.loads(operation.before_state_json)
    operation.undone_at = utc_now_naive()
    previous = (
        session.get(ReviewUnitRatingOperation, operation.replaces_operation_id)
        if operation.replaces_operation_id
        else None
    )
    if encounter.status == ENCOUNTER_OPEN and previous is not None and previous.undone_at is None:
        result = _apply_rating_from_snapshot(
            session,
            state,
            item,
            snapshot,
            previous.rating,
            horizon=_sprint_horizon(session),
            exclude_operation_ids={previous.id},
        )
        previous.replaced_at = None
        encounter.effective_operation_id = previous.id
        encounter.selected_rating = previous.rating
        encounter.passed = result.passed
        encounter.retry_after_cards = result.retry_after_cards
    else:
        snapshot_has_fsrs = isinstance(snapshot.get("state", {}).get("fsrs"), dict)
        _restore_snapshot(state, item, snapshot)
        if not snapshot_has_fsrs:
            # Pre-switch snapshot: rebuild the FSRS card from the operations
            # that are still effective after this undo.
            _apply_fsrs_state(state, _replay_fsrs_state(session, state))
        if encounter.status == ENCOUNTER_OPEN or allow_closed:
            encounter.effective_operation_id = None
            encounter.selected_rating = None
            encounter.passed = None
            encounter.retry_after_cards = 0
        study = session.get(StudySession, operation.study_session_id)
        if (
            study is not None
            and study.scene == FREESTYLE_UNIT_REVIEW_SCENE
            and study.status == SESSION_COMPLETED
            and allow_closed
        ):
            study.status = SESSION_ABANDONED
            study.completion_method = "palace_rating_undone"
    return {
        "operation_id": operation.id,
        "unit": unit_payload(state),
        "session_status": item.status,
        "encounter": _encounter_payload(
            encounter, horizon=_sprint_horizon(session), live_state=state
        ),
    }


def _undo_rating_batch(
    session: Session,
    batch_id: str,
    round_id: str | None = None,
) -> dict[str, Any]:
    operations = (
        session.query(ReviewUnitRatingOperation)
        .filter(
            ReviewUnitRatingOperation.batch_id == batch_id,
            ReviewUnitRatingOperation.undone_at.is_(None),
        )
        .order_by(ReviewUnitRatingOperation.created_at.desc())
        .all()
    )
    if not operations:
        raise ValueError("active unit rating operation not found")
    current = next((item for item in operations if item.id == batch_id), None)
    if current is None:
        raise ValueError("active unit rating operation not found")
    current_encounter = session.get(ReviewUnitEncounter, current.encounter_id)
    closed_today = (
        current_encounter is not None
        and current_encounter.status != ENCOUNTER_OPEN
        and _closed_rating_is_today(session, current_encounter, current)
    )
    if current_encounter is None or (current_encounter.status != ENCOUNTER_OPEN and not closed_today):
        raise ValueError("only the current open encounter can be undone")
    if round_id and current_encounter.round_id != str(round_id).strip():
        raise ValueError("round_id does not match the active encounter")
    current_result: dict[str, Any] | None = None
    for operation in operations:
        result = _undo_one_rating_operation(
            session,
            operation,
            allow_closed=operation.id != batch_id or closed_today,
        )
        if operation.id == batch_id:
            current_result = result
    session.commit()
    if current_result is None:
        raise ValueError("active unit rating operation not found")
    current_result["batch_id"] = batch_id
    current_result["undone_unit_ids"] = [operation.unit_id for operation in operations]
    return current_result


def undo_unit_rating(session: Session, operation_id: str, round_id: str | None = None) -> dict[str, Any]:
    operation = session.get(ReviewUnitRatingOperation, operation_id)
    if operation is None or operation.undone_at is not None:
        raise ValueError("active unit rating operation not found")
    if operation.batch_id:
        return _undo_rating_batch(session, operation.batch_id, round_id)
    encounter = session.get(ReviewUnitEncounter, operation.encounter_id)
    closed_today = (
        encounter is not None
        and encounter.status != ENCOUNTER_OPEN
        and _closed_rating_is_today(session, encounter, operation)
    )
    if encounter is None or (encounter.status != ENCOUNTER_OPEN and not closed_today):
        raise ValueError("only the current open encounter can be undone")
    if round_id and encounter.round_id != str(round_id).strip():
        raise ValueError("round_id does not match the active encounter")
    result = _undo_one_rating_operation(session, operation, allow_closed=closed_today)
    session.commit()
    return result


def close_unit_review_encounter(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    encounter_id: str,
    operation_id: str,
    round_id: str | None = None,
) -> dict[str, Any]:
    close_operation_id = str(operation_id or "").strip()
    if not close_operation_id:
        raise ValueError("operation_id is required")
    study = session.get(StudySession, study_session_id)
    encounter = session.get(ReviewUnitEncounter, encounter_id)
    if (
        study is None
        or encounter is None
        or encounter.study_session_id != study.id
        or encounter.unit_id != unit_id
    ):
        raise ValueError("review encounter not found")
    if round_id and encounter.round_id != str(round_id).strip():
        raise ValueError("round_id does not match the active encounter")
    if encounter.status == ENCOUNTER_CLOSED:
        completion = (
            json.loads(study.summary_json or "{}")
            if study.status == SESSION_COMPLETED
            else None
        )
        return {
            "operation_id": encounter.close_operation_id or close_operation_id,
            "encounter": _encounter_payload(encounter, horizon=_sprint_horizon(session)),
            "passed": bool(encounter.passed),
            "retry_after_cards": encounter.retry_after_cards,
            "session_status": study.status,
            "completion": completion,
        }
    if encounter.effective_operation_id is None or encounter.selected_rating is None:
        raise ValueError("rate the review unit before leaving it")
    closed_at = utc_now_naive()
    encounter.status = ENCOUNTER_CLOSED
    encounter.close_operation_id = close_operation_id
    encounter.closed_at = closed_at
    completion = None
    if encounter.passed and study.scene == FREESTYLE_UNIT_REVIEW_SCENE:
        completion = _complete_unit_review_session(session, study)
    session.commit()
    return {
        "operation_id": close_operation_id,
        "encounter": _encounter_payload(encounter, horizon=_sprint_horizon(session)),
        "passed": bool(encounter.passed),
        "retry_after_cards": encounter.retry_after_cards,
        "session_status": study.status,
        "completion": completion,
    }


def _complete_unit_review_session(session: Session, study: StudySession) -> dict[str, Any]:
    if study.status != SESSION_ACTIVE:
        raise ValueError("active unit review session not found")
    # Callers have already staged the encounter close. A bare query would
    # autoflush that write and hold SQLite's only writer across the rest of
    # this function. Measured: close waited on the lock, then held it ~15s,
    # and the next card's session start timed out in the learner's hands.
    # These reads are about committed unit rows, not the close being staged.
    with session.no_autoflush:
        items = (
            session.query(ReviewSessionUnit)
            .filter(ReviewSessionUnit.study_session_id == study.id)
            .all()
        )
        if not items or any(item.status != ITEM_PASSED for item in items):
            raise ValueError("all review units must pass before completion")
        now = utc_now_naive()
        counted_ids = {
            row.id
            for row in session.query(ReviewUnitEncounter.id)
            .filter(
                ReviewUnitEncounter.study_session_id == study.id,
                ReviewUnitEncounter.status == ENCOUNTER_CLOSED,
            )
            .all()
        }
        first_billable_at = _first_billable_encounter_started_at(session, study.id)
        next_due = (
            session.query(ReviewUnitState)
            .filter(
                ReviewUnitState.palace_id == study.palace_id,
                ReviewUnitState.active.is_(True),
            )
            .order_by(ReviewUnitState.due_date.asc())
            .first()
        )
    for staged in list(session.new) + list(session.dirty):
        if (
            isinstance(staged, ReviewUnitEncounter)
            and staged.study_session_id == study.id
            and staged.status == ENCOUNTER_CLOSED
            and staged.id not in counted_ids
            and staged.selected_rating is not None
        ):
            if first_billable_at is None or (
                staged.created_at is not None and staged.created_at < first_billable_at
            ):
                first_billable_at = staged.created_at
    if first_billable_at is not None:
        # Align list "开始时间" with first real attempt, not a prior unrated glance
        # that may have been cancelled — or an earlier scroll-past on another unit
        # that shared a clock second in the inflated historical rows.
        study.started_at = first_billable_at
    study.status = SESSION_COMPLETED
    study.ended_at = now
    study.completion_method = "all_units_passed"
    # Merge completion receipt into existing summary so client_source stamped at
    # start (desktop/pwa freestyle or formal review) is not wiped to 未知端.
    prior = _load_study_summary(study)
    summary = {
        **prior,
        "study_session_id": study.id,
        "palace_id": study.palace_id,
        "completed_unit_count": len(items),
        "hard_retry_count": sum(item.hard_count for item in items),
        "again_retry_count": sum(item.again_count for item in items),
        "next_review_date": next_due.due_date.isoformat() if next_due else None,
        "completed_at": to_api_datetime(now),
    }
    prior_source = _normalize_unit_review_client_source(prior.get("client_source"))
    if prior_source is not None:
        summary["client_source"] = prior_source
    elif "client_source" in summary:
        # Drop invalid leftover values so summarize stays clean.
        summary.pop("client_source", None)
    study.summary_json = json.dumps(summary, ensure_ascii=False)
    return summary


def complete_unit_review_session(session: Session, study_session_id: str) -> dict[str, Any]:
    study = session.get(StudySession, study_session_id)
    if study is None:
        raise ValueError("active unit review session not found")
    summary = _complete_unit_review_session(session, study)
    session.commit()
    return summary


def get_unit_review_completion(session: Session, study_session_id: str) -> dict[str, Any]:
    study = session.get(StudySession, study_session_id)
    if study is None or study.status != SESSION_COMPLETED:
        raise ValueError("completed unit review session not found")
    return json.loads(study.summary_json or "{}")


__all__ = [
    "adjust_unit_schedule",
    "remove_unit_permanently",
    "cancel_unrated_unit_review_encounter",
    "complete_unit_review_session",
    "close_unit_review_encounter",
    "get_palace_unit_projection",
    "get_unit_review_completion",
    "get_unit_review_session",
    "list_due_units",
    "open_unit_review_encounter",
    "rate_palace_due_units",
    "rate_review_unit",
    "reconcile_palace_units",
    "resolve_unit_definitions",
    "start_unit_review_session",
    "start_freestyle_unit_review_session",
    "undo_content_schedule_batch",
    "undo_unit_rating",
]
