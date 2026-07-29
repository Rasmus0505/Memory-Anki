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
ITEM_PENDING = "pending"
ITEM_RETRY = "retry"
ITEM_PASSED = "passed"
ENCOUNTER_OPEN = "open"
ENCOUNTER_CLOSED = "closed"

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


def start_unit_review_session(
    session: Session,
    palace_id: int,
    *,
    scene: str = "formal_unit_review",
    unit_ids: list[str] | None = None,
    client_source: str | None = None,
) -> dict[str, Any]:
    projection = get_palace_unit_projection(session, palace_id)
    if projection["mark_required"]:
        raise ValueError("permanent marks are required before review")
    definitions = {item["id"]: item for item in projection["units"]}
    selected = [item for item in projection["units"] if item["due"]]
    if unit_ids is not None:
        requested = {str(item) for item in unit_ids}
        selected = [
            definitions[item]
            for item in requested
            if item in definitions and definitions[item]["due"]
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


def _rating_effects(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    state_data = snapshot["state"]
    item_data = snapshot["item"]
    stage_index = int(state_data["stage_index"])
    has_passed = bool(state_data["has_passed"])
    had_prior_failure = int(item_data["retry_count"]) > 0
    effects: list[dict[str, Any]] = []
    for rating, label in RATING_LABELS.items():
        result = rate_unit(
            stage_index=stage_index,
            has_passed=has_passed,
            rating=rating,
            had_failure_in_encounter=had_prior_failure,
        )
        target_interval = INTERVAL_DAYS[result.stage_index]
        if rating == 1:
            stage_action = "reset"
        elif result.stage_index < stage_index:
            stage_action = "lower"
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
        "closed_at": to_api_datetime(encounter.closed_at),
        "rating_effects": _rating_effects(snapshot),
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
) -> dict[str, Any]:
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active:
        raise ValueError("review unit not found")
    if int(unit_revision) != int(state.revision):
        raise ValueError("review unit changed; rebuild the queue")

    study = (
        session.query(StudySession)
        .join(ReviewSessionUnit, ReviewSessionUnit.study_session_id == StudySession.id)
        .filter(
            StudySession.scene == "freestyle_unit_review",
            StudySession.status == SESSION_ACTIVE,
            ReviewSessionUnit.unit_id == state.id,
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if study is None:
        if state.due_date > date.today():
            raise ValueError("review unit is not due")
        created = start_unit_review_session(
            session,
            state.palace_id,
            scene="freestyle_unit_review",
            unit_ids=[state.id],
            client_source=client_source,
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

    return open_unit_review_encounter(
        session,
        study_session_id=study.id,
        unit_id=state.id,
        unit_revision=unit_revision,
        encounter_id=encounter_id,
        round_id=round_id,
    )


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


def undo_unit_rating(session: Session, operation_id: str) -> dict[str, Any]:
    operation = session.get(ReviewUnitRatingOperation, operation_id)
    if operation is None or operation.undone_at is not None:
        raise ValueError("active unit rating operation not found")
    encounter = session.get(ReviewUnitEncounter, operation.encounter_id)
    if encounter is None or encounter.status != ENCOUNTER_OPEN:
        raise ValueError("only the current open encounter can be undone")
    if encounter.effective_operation_id != operation.id:
        raise ValueError("only the effective rating can be undone")
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
    encounter.status = ENCOUNTER_CLOSED
    encounter.close_operation_id = close_operation_id
    encounter.closed_at = utc_now_naive()
    completion = None
    if encounter.passed and study.scene == "freestyle_unit_review":
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
    study.status = SESSION_COMPLETED
    study.ended_at = now
    study.completion_method = "all_units_passed"
    duration = max(0, int((now - study.started_at).total_seconds()))
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
    summary = {
        **prior,
        "study_session_id": study.id,
        "palace_id": study.palace_id,
        "completed_unit_count": len(items),
        "duration_seconds": duration,
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
