"""Permanent-mark review unit lifecycle, scheduling, sessions, and ratings."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewSessionUnit,
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.mindmap_document.api import deserialize_editor_payload

from .unit_review_projection import (
    adjust_unit_schedule,
    get_palace_unit_projection,
    json_load_list,
    list_due_units,
    reconcile_palace_units,
    resolve_unit_definitions,
    undo_content_schedule_batch,
    unit_payload,
)
from .unit_scheduler import INTERVAL_DAYS, RATING_LABELS, normalize_rating, rate_unit

SESSION_ACTIVE = "active"
SESSION_COMPLETED = "completed"
SESSION_ABANDONED = "abandoned"
ITEM_PENDING = "pending"
ITEM_RETRY = "retry"
ITEM_PASSED = "passed"
ENCOUNTER_OPEN = "open"
ENCOUNTER_CLOSED = "closed"
# Freestyle used to keep one StudySession.started_at from the first card glance
# until eventual pass, so scrolling past three cards in 7s then finishing later
# minted three overlapping wall-clock rows. Rated closed encounters are the only
# billable intervals; unrated glances are cancelled on leave.
FREESTYLE_UNIT_REVIEW_SCENE = "freestyle_unit_review"


def _normalize_unit_review_client_source(value: Any) -> str | None:
    """Align with study-session time-record client_source buckets."""
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


def _encounter_billable_seconds(encounter: ReviewUnitEncounter) -> int:
    """Client-observed foreground seconds for a rated, closed card encounter."""
    if encounter.status != ENCOUNTER_CLOSED or encounter.selected_rating is None:
        return 0
    if encounter.effective_seconds is None:
        return 0
    return max(0, int(encounter.effective_seconds))


def _sum_billable_encounter_seconds(session: Session, study_session_id: str) -> int:
    rows = (
        session.query(ReviewUnitEncounter)
        .filter(
            ReviewUnitEncounter.study_session_id == study_session_id,
            ReviewUnitEncounter.status == ENCOUNTER_CLOSED,
        )
        .all()
    )
    return sum(_encounter_billable_seconds(row) for row in rows)


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
    study.effective_seconds = _sum_billable_encounter_seconds(session, study.id)
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
    released = 0
    for study in rows:
        if keep_study_id is not None and study.id == keep_study_id:
            continue
        unit_ids = {
            unit_id
            for (unit_id,) in session.query(ReviewSessionUnit.unit_id)
            .filter(ReviewSessionUnit.study_session_id == study.id)
            .all()
        }
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
) -> dict[str, Any]:
    projection = get_palace_unit_projection(session, palace_id)
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


def get_unit_review_session(session: Session, study_session_id: str) -> dict[str, Any]:
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
    palace = session.get(Palace, study.palace_id) if study.palace_id is not None else None
    if study.palace_id is None:
        raise ValueError("unit review session has no palace")
    _, definitions = resolve_unit_definitions(session, study.palace_id)
    definition_by_anchor = {item.anchor_uid: item for item in definitions}
    units = []
    for item, state in rows:
        payload = unit_payload(state, definition_by_anchor.get(state.anchor_uid))
        encounter = (
            session.query(ReviewUnitEncounter)
            .filter_by(study_session_id=study.id, unit_id=state.id)
            .order_by(
                (ReviewUnitEncounter.status == ENCOUNTER_OPEN).desc(),
                ReviewUnitEncounter.sequence.desc(),
            )
            .first()
        )
        payload.update(
            {
                "node_uids": json_load_list(item.node_uids_json),
                "session_status": item.status,
                "retry_count": item.retry_count,
                "hard_count": item.hard_count,
                "again_count": item.again_count,
                "final_rating": item.final_rating,
                "encounter": _encounter_payload(encounter) if encounter is not None else None,
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


def _state_snapshot(state: ReviewUnitState, item: ReviewSessionUnit) -> dict[str, Any]:
    return {
        "state": {
            "stage_index": state.stage_index,
            "has_passed": state.has_passed,
            "due_date": state.due_date.isoformat(),
            "last_passed_at": to_api_datetime(state.last_passed_at),
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


def _rating_effects(
    snapshot: dict[str, Any],
    *,
    fuzz_key: str | None = None,
) -> list[dict[str, Any]]:
    state_data = snapshot["state"]
    item_data = snapshot["item"]
    stage_index = int(state_data["stage_index"])
    has_passed = bool(state_data["has_passed"])
    had_prior_failure = int(item_data["retry_count"]) > 0
    # Pin "today" once so every button in one preview shares a reference day and
    # the reported gap cannot drift across a midnight boundary mid-render.
    today = date.today()
    effects: list[dict[str, Any]] = []
    for rating, label in RATING_LABELS.items():
        result = rate_unit(
            stage_index=stage_index,
            has_passed=has_passed,
            rating=rating,
            had_failure_in_encounter=had_prior_failure,
            today=today,
            fuzz_key=fuzz_key,
        )
        # Nominal ladder interval names the landing stage ("14天级"); the actual
        # gap carries day-level fuzz and is what a passing rating really books.
        target_interval = INTERVAL_DAYS[result.stage_index]
        actual_interval = max(0, (result.due_date - today).days)
        if result.stage_index < stage_index:
            # "reset" only when a unit truly falls back to first-learning; a
            # partial lapse from stage 9 to 4 is a drop, not a reset.
            stage_action = (
                "reset" if result.stage_index == 0 and not result.passed else "lower"
            )
        elif result.stage_index == stage_index:
            stage_action = "keep"
        else:
            stage_action = "advance"
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
                "stage_action": stage_action,
            }
        )
    return effects


def _encounter_payload(encounter: ReviewUnitEncounter) -> dict[str, Any]:
    snapshot = json.loads(encounter.baseline_state_json)
    return {
        "id": encounter.id,
        "round_id": encounter.round_id,
        "sequence": encounter.sequence,
        "status": encounter.status,
        "selected_rating": encounter.selected_rating,
        "passed": encounter.passed,
        "retry_after_cards": encounter.retry_after_cards,
        "effective_operation_id": encounter.effective_operation_id,
        "effective_seconds": encounter.effective_seconds,
        "closed_at": to_api_datetime(encounter.closed_at),
        # Same fuzz key as the commit path (unit id), so the previewed due date is
        # the one actually booked instead of an unfuzzed approximation.
        "rating_effects": _rating_effects(snapshot, fuzz_key=encounter.unit_id),
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
            baseline_state_json=json.dumps(_state_snapshot(state, item), ensure_ascii=False),
            status=ENCOUNTER_OPEN,
        )
    )
    session.commit()
    return get_unit_review_session(session, study.id)


def start_freestyle_unit_review_session(
    session: Session,
    *,
    unit_id: str,
    unit_revision: int,
    encounter_id: str,
    round_id: str,
    client_source: str | None = None,
    allow_not_due: bool = False,
) -> dict[str, Any]:
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active:
        raise ValueError("review unit not found")

    # Queue projection may reconcile a stale editor document inside its request
    # and return the new revision before that request is committed. Re-project
    # here so the queue card and the session start observe the same unit state.
    get_palace_unit_projection(session, state.palace_id)
    session.refresh(state)
    if not state.active:
        raise ValueError("review unit not found")
    if int(unit_revision) != int(state.revision):
        raise ValueError("review unit changed; rebuild the queue")

    # Drop competing freestyle sessions from other units / clients before opening
    # this card. Prevents multi-palace wall-clock rows that all share one start.
    _release_competing_freestyle_unit_sessions(session, keep_unit_id=state.id)

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
    if study is None:
        if state.due_date > date.today() and not allow_not_due:
            raise ValueError("review unit is not due")
        created = start_unit_review_session(
            session,
            state.palace_id,
            scene=FREESTYLE_UNIT_REVIEW_SCENE,
            unit_ids=[state.id],
            client_source=client_source,
            allow_not_due=allow_not_due,
        )
        study = session.get(StudySession, str(created["id"]))
        if study is None:
            raise ValueError("failed to create unit review session")
    else:
        # Resume path: stamp source if the active session still lacks one.
        normalized_source = _normalize_unit_review_client_source(client_source)
        if normalized_source is not None:
            summary = _load_study_summary(study)
            if summary.get("client_source") not in {"desktop", "pwa"}:
                summary["client_source"] = normalized_source
                study.summary_json = json.dumps(summary, ensure_ascii=False)
                session.commit()
        # Keep any still-open encounter. Deleting it here raced with an in-flight
        # rate that still held the old encounter_id ("open review encounter required").
        # Unrated leave is cancelled explicitly via cancel_unrated_unit_review_encounter;
        # competing sessions are released above / on other-unit start.

    return open_unit_review_encounter(
        session,
        study_session_id=study.id,
        unit_id=state.id,
        unit_revision=unit_revision,
        encounter_id=encounter_id,
        round_id=round_id,
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
    state: ReviewUnitState,
    item: ReviewSessionUnit,
    snapshot: dict[str, Any],
    rating: int,
) -> Any:
    _restore_snapshot(state, item, snapshot)
    result = rate_unit(
        stage_index=state.stage_index,
        has_passed=state.has_passed,
        rating=rating,
        had_failure_in_encounter=item.retry_count > 0,
        # Same key the preview used, so the committed due date is the one the
        # button promised. Keyed on the unit so a same-day cohort still scatters.
        fuzz_key=state.id,
    )
    now = utc_now_naive()
    state.stage_index = result.stage_index
    state.due_date = result.due_date
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
) -> dict[str, Any]:
    op_id = str(operation_id or "").strip()
    if not op_id:
        raise ValueError("operation_id is required")
    existing = session.get(ReviewUnitRatingOperation, op_id)
    if existing is not None:
        if existing.encounter_id != encounter_id:
            raise ValueError("operation_id belongs to another encounter")
        return json.loads(existing.after_state_json)
    study = session.get(StudySession, study_session_id)
    if study is None or study.status != SESSION_ACTIVE:
        raise ValueError("active unit review session required")
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active or state.palace_id != study.palace_id:
        raise ValueError("review unit not found")
    if int(unit_revision) != int(state.revision):
        raise ValueError("review unit changed; rebuild the queue")
    item = _session_item(session, study.id, state.id)
    encounter = session.get(ReviewUnitEncounter, encounter_id)
    if (
        encounter is None
        or encounter.study_session_id != study.id
        or encounter.unit_id != state.id
        or encounter.status != ENCOUNTER_OPEN
    ):
        raise ValueError("open review encounter required")
    if round_id and encounter.round_id != str(round_id).strip():
        raise ValueError("round_id does not match the active encounter")
    if encounter.unit_revision != state.revision:
        raise ValueError("review unit changed; rebuild the queue")

    normalized = normalize_rating(rating)
    previous = (
        session.get(ReviewUnitRatingOperation, encounter.effective_operation_id)
        if encounter.effective_operation_id
        else None
    )
    if previous is not None and previous.rating == normalized:
        return json.loads(previous.after_state_json)
    before = json.loads(encounter.baseline_state_json)
    result = _apply_rating_from_snapshot(state, item, before, normalized)
    now = utc_now_naive()
    if previous is not None:
        previous.replaced_at = now
    encounter.effective_operation_id = op_id
    encounter.selected_rating = normalized
    encounter.passed = result.passed
    encounter.retry_after_cards = result.retry_after_cards
    after = {
        "operation_id": op_id,
        "study_session_id": study.id,
        "encounter_id": encounter.id,
        "amended": previous is not None,
        "unit": unit_payload(state),
        "passed": result.passed,
        "retry_after_cards": result.retry_after_cards,
        "rating": normalized,
        "rating_label": RATING_LABELS[normalized],
        "session_status": item.status,
        "encounter": _encounter_payload(encounter),
    }
    session.add(
        ReviewUnitRatingOperation(
            id=op_id,
            encounter_id=encounter.id,
            study_session_id=study.id,
            unit_id=state.id,
            palace_id=state.palace_id,
            unit_revision=state.revision,
            rating=normalized,
            passed=result.passed,
            retry_after_cards=result.retry_after_cards,
            before_state_json=json.dumps(before, ensure_ascii=False),
            after_state_json=json.dumps(after, ensure_ascii=False),
            replaces_operation_id=previous.id if previous is not None else None,
        )
    )
    session.commit()
    return after


def undo_unit_rating(session: Session, operation_id: str, round_id: str | None = None) -> dict[str, Any]:
    operation = session.get(ReviewUnitRatingOperation, operation_id)
    if operation is None or operation.undone_at is not None:
        raise ValueError("active unit rating operation not found")
    encounter = session.get(ReviewUnitEncounter, operation.encounter_id)
    if encounter is None or encounter.status != ENCOUNTER_OPEN:
        raise ValueError("only the current open encounter can be undone")
    if encounter.effective_operation_id != operation.id:
        raise ValueError("only the effective rating can be undone")
    if round_id and encounter.round_id != str(round_id).strip():
        raise ValueError("round_id does not match the active encounter")
    state = session.get(ReviewUnitState, operation.unit_id)
    if state is None:
        raise ValueError("review unit not found")
    item = _session_item(session, operation.study_session_id, operation.unit_id)
    snapshot = json.loads(encounter.baseline_state_json)
    operation.undone_at = utc_now_naive()
    previous = (
        session.get(ReviewUnitRatingOperation, operation.replaces_operation_id)
        if operation.replaces_operation_id
        else None
    )
    if previous is not None and previous.undone_at is None:
        result = _apply_rating_from_snapshot(state, item, snapshot, previous.rating)
        previous.replaced_at = None
        encounter.effective_operation_id = previous.id
        encounter.selected_rating = previous.rating
        encounter.passed = result.passed
        encounter.retry_after_cards = result.retry_after_cards
    else:
        _restore_snapshot(state, item, snapshot)
        encounter.effective_operation_id = None
        encounter.selected_rating = None
        encounter.passed = None
        encounter.retry_after_cards = 0
    session.commit()
    return {
        "operation_id": operation_id,
        "unit": unit_payload(state),
        "session_status": item.status,
        "encounter": _encounter_payload(encounter),
    }


def close_unit_review_encounter(
    session: Session,
    *,
    study_session_id: str,
    unit_id: str,
    encounter_id: str,
    operation_id: str,
    effective_seconds: int | None = None,
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
            "encounter": _encounter_payload(encounter),
            "passed": bool(encounter.passed),
            "retry_after_cards": encounter.retry_after_cards,
            "session_status": study.status,
            "completion": completion,
        }
    if encounter.effective_operation_id is None or encounter.selected_rating is None:
        raise ValueError("rate the review unit before leaving it")
    normalized_seconds = 0 if effective_seconds is None else int(effective_seconds)
    if normalized_seconds < 0:
        raise ValueError("effective_seconds must be non-negative")
    closed_at = utc_now_naive()
    if encounter.created_at is not None:
        wall_seconds = max(0, int((closed_at - encounter.created_at).total_seconds()))
        if normalized_seconds > wall_seconds:
            raise ValueError(
                "effective_seconds cannot exceed the encounter wall-clock span"
            )
    encounter.status = ENCOUNTER_CLOSED
    encounter.close_operation_id = close_operation_id
    encounter.effective_seconds = normalized_seconds
    encounter.closed_at = closed_at
    completion = None
    if encounter.passed and study.scene == FREESTYLE_UNIT_REVIEW_SCENE:
        completion = _complete_unit_review_session(session, study)
    session.commit()
    return {
        "operation_id": close_operation_id,
        "encounter": _encounter_payload(encounter),
        "passed": bool(encounter.passed),
        "retry_after_cards": encounter.retry_after_cards,
        "session_status": study.status,
        "completion": completion,
    }


def _complete_unit_review_session(session: Session, study: StudySession) -> dict[str, Any]:
    if study.status != SESSION_ACTIVE:
        raise ValueError("active unit review session not found")
    items = (
        session.query(ReviewSessionUnit)
        .filter(ReviewSessionUnit.study_session_id == study.id)
        .all()
    )
    if not items or any(item.status != ITEM_PASSED for item in items):
        raise ValueError("all review units must pass before completion")
    now = utc_now_naive()
    # Bill only rated closed encounters (card-visible intervals). Never use
    # bare (now - started_at): freestyle leaves sessions open across other cards.
    duration = _sum_billable_encounter_seconds(session, study.id)
    first_billable_at = _first_billable_encounter_started_at(session, study.id)
    if first_billable_at is not None:
        # Align list "开始时间" with first real attempt, not a prior unrated glance
        # that may have been cancelled — or an earlier scroll-past on another unit
        # that shared a clock second in the inflated historical rows.
        study.started_at = first_billable_at
    study.status = SESSION_COMPLETED
    study.ended_at = now
    study.completion_method = "all_units_passed"
    next_due = (
        session.query(ReviewUnitState)
        .filter(
            ReviewUnitState.palace_id == study.palace_id,
            ReviewUnitState.active.is_(True),
        )
        .order_by(ReviewUnitState.due_date.asc())
        .first()
    )
    # Merge completion receipt into existing summary so client_source stamped at
    # start (desktop/pwa freestyle or formal review) is not wiped to 未知端.
    prior = _load_study_summary(study)
    wall_span = max(0, int((now - study.started_at).total_seconds())) if study.started_at else duration
    summary = {
        **prior,
        "study_session_id": study.id,
        "palace_id": study.palace_id,
        "completed_unit_count": len(items),
        "duration_seconds": duration,
        "wall_span_seconds": wall_span,
        "duration_basis": "rated_closed_encounters",
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
    study.effective_seconds = duration
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
    "cancel_unrated_unit_review_encounter",
    "complete_unit_review_session",
    "close_unit_review_encounter",
    "get_palace_unit_projection",
    "get_unit_review_completion",
    "get_unit_review_session",
    "list_due_units",
    "open_unit_review_encounter",
    "rate_review_unit",
    "reconcile_palace_units",
    "resolve_unit_definitions",
    "start_unit_review_session",
    "start_freestyle_unit_review_session",
    "undo_content_schedule_batch",
    "undo_unit_rating",
]
