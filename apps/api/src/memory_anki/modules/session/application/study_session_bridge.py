from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitEncounter

from .serialization import _int_or_none, _parse_datetime

# Timed-session leave/autosave used to write scene=review rows while formal
# review kept persistCompletionRecord=false. Those ghosts show up as "正式复习"
# time records but never carry completion_receipt mastery points.
GHOST_FORMAL_REVIEW_COMPLETION_METHODS = frozenset({"saved", "left_page"})


def _normalize_client_source(value: Any) -> str | None:
    normalized = str(value or "").strip()
    if normalized == "desktop":
        return "desktop"
    if normalized in {"pwa", "mobile"}:
        return "pwa"
    return None


def _is_ghost_formal_review_time_payload(payload: dict[str, Any]) -> bool:
    kind = str(payload.get("kind") or "practice")
    if kind != "review":
        return False
    method = str(
        payload.get("completionMethod") or payload.get("completion_method") or ""
    )
    return method in GHOST_FORMAL_REVIEW_COMPLETION_METHODS


def create_completed_study_session_from_time_payload(
    session: Session,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any] | None:
    from .study_session_service import create_study_session

    effective_seconds = max(0, int(payload.get("effectiveSeconds", payload.get("effective_seconds", 0)) or 0))
    started_at = _parse_datetime(payload.get("startedAt") or payload.get("started_at"))
    ended_at = _parse_datetime(payload.get("endedAt") or payload.get("ended_at"))
    if started_at is None or ended_at is None:
        raise ValueError("开始时间和结束时间不能为空。")
    source_kind = payload.get("sourceKind") or payload.get("source_kind")
    kind = str(payload.get("kind") or "practice")
    reclassified_from_review_timer = False
    if _is_ghost_formal_review_time_payload(payload):
        # Keep the duration in practice stats; never mint a formal-review row
        # without a /review/session submit receipt.
        kind = "practice"
        reclassified_from_review_timer = True
    scene = _scene_from_legacy_kind(kind, source_kind)
    target_type = "none"
    target_id = None
    palace_id = _int_or_none(payload.get("palaceId") or payload.get("palace_id"))
    palace_segment_id = _int_or_none(payload.get("palaceSegmentId") or payload.get("palace_segment_id"))
    english_course_id = _int_or_none(payload.get("englishCourseId") or payload.get("english_course_id"))
    if english_course_id is not None:
        target_type, target_id = "english_course", english_course_id
    elif palace_segment_id is not None:
        target_type, target_id = "palace_segment", palace_segment_id
    elif palace_id is not None:
        target_type, target_id = "palace", palace_id
    raw_summary = payload.get("summary")
    summary_payload = raw_summary if isinstance(raw_summary, dict) else {}
    summary_payload = {
        **summary_payload,
        "scene_segments": payload.get("sceneSegments") or payload.get("scene_segments") or [],
        "duration_edited": bool(payload.get("durationEdited", payload.get("duration_edited", False))),
    }
    activity_tag = _normalize_activity_tag(
        payload.get("activityTag")
        if "activityTag" in payload
        else payload.get("activity_tag")
        if "activity_tag" in payload
        else summary_payload.get("activity_tag")
    )
    activity_tag_label = _normalize_activity_tag_label(
        payload.get("activityTagLabel")
        if "activityTagLabel" in payload
        else payload.get("activity_tag_label")
        if "activity_tag_label" in payload
        else summary_payload.get("activity_tag_label")
    )
    if activity_tag:
        summary_payload["activity_tag"] = activity_tag
        if activity_tag_label:
            summary_payload["activity_tag_label"] = activity_tag_label
        elif activity_tag in {"review", "practice", "quiz", "palace_edit"}:
            summary_payload["activity_tag_label"] = {
                "review": "正式复习",
                "practice": "练习",
                "quiz": "做题",
                "palace_edit": "宫殿编辑",
            }.get(activity_tag, activity_tag)
    if reclassified_from_review_timer:
        summary_payload["reclassified_from"] = "review_timer_ghost"
        summary_payload["original_kind"] = "review"
    client_source = _normalize_client_source(payload.get("clientSource") or payload.get("client_source"))
    if client_source is not None:
        summary_payload["client_source"] = client_source
    completion_method = str(
        payload.get("completionMethod") or payload.get("completion_method") or "manual_complete"
    )
    # Background autosave is a crash checkpoint, not a finished study record.
    # Writing status=completed made "保存结束" ghosts appear in the time-record list
    # whenever the client remounted with a new id before a real leave/complete.
    status = "active" if completion_method == "saved" else "completed"
    item = create_study_session(
        session,
        {
            "id": str(payload.get("id") or uuid4()),
            "status": status,
            "scene": scene,
            "target_type": target_type,
            "target_id": target_id,
            "palace_id": palace_id,
            "palace_segment_id": palace_segment_id,
            "english_course_id": english_course_id,
            "title": payload.get("title") or "",
            "started_at": started_at.isoformat(),
            "ended_at": ended_at.isoformat() if status == "completed" else None,
            "effective_seconds": effective_seconds,
            "pause_count": max(0, int(payload.get("pauseCount", payload.get("pause_count", 0)) or 0)),
            "completion_method": completion_method,
            "events": payload.get("events") or [],
            "summary": summary_payload,
        },
        commit=commit,
    )
    return item


def _normalize_activity_tag(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:64]


def _normalize_activity_tag_label(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:40]


def _scene_from_legacy_kind(kind: str, source_kind: Any) -> str:
    if source_kind == "english":
        return "english"
    if source_kind == "english_reading":
        return "english_reading"
    if kind == "palace_edit":
        return "palace_edit"
    if kind == "quiz":
        return "quiz"
    if kind == "review":
        return "review"
    if kind == "practice":
        return "practice"
    if kind == "custom":
        return "custom"
    return kind


def create_review_study_session(
    session: Session,
    *,
    session_id: str,
    scene: str,
    target_type: str,
    target_id: int | None,
    title: str,
    palace_id: int | None,
    palace_segment_id: int | None = None,
    mini_palace_id: int | None = None,
    ended_at: datetime | None = None,
    duration_seconds: int,
    completion_method: str = "auto_complete",
    summary: dict[str, Any] | None = None,
    commit: bool = True,
) -> dict[str, Any] | None:
    from .study_session_service import create_study_session

    effective_seconds = max(0, int(duration_seconds))
    resolved_ended_at = ended_at or utc_now_naive()
    started_at = resolved_ended_at - timedelta(seconds=effective_seconds)
    return create_study_session(
        session,
        {
            "id": session_id,
            "status": "completed",
            "scene": scene,
            "target_type": target_type,
            "target_id": target_id,
            "palace_id": palace_id,
            "palace_segment_id": palace_segment_id,
            "mini_palace_id": mini_palace_id,
            "title": title,
            "started_at": started_at.isoformat(),
            "ended_at": resolved_ended_at.isoformat(),
            "effective_seconds": effective_seconds,
            "completion_method": completion_method,
            "events": [
                {"type": "review_submit", "at": resolved_ended_at.isoformat(), "meta": summary or {}}
            ],
            "summary": summary or {},
        },
        commit=commit,
    )


def ensure_review_log_study_sessions(session: Session) -> int:
    del session
    return 0


def reclassify_ghost_formal_review_time_sessions(session: Session) -> int:
    """Rewrite leave/autosave ghost formal-review rows to practice.

    Real formal completions use completion_method manual_complete/auto_complete
    and store completion_receipt. Ghost timer rows used saved/left_page only.
    """
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.completion_method.in_(tuple(GHOST_FORMAL_REVIEW_COMPLETION_METHODS)),
        )
        .all()
    )
    fixed = 0
    for row in rows:
        try:
            summary = json.loads(row.summary_json or "{}")
        except (TypeError, json.JSONDecodeError):
            summary = {}
        if not isinstance(summary, dict):
            summary = {}
        if isinstance(summary.get("completion_receipt"), dict):
            continue
        row.scene = "practice"
        if row.target_type in {"", "none"} and row.palace_id is not None:
            row.target_type = "palace"
            row.target_id = row.palace_id
        summary = {
            **summary,
            "reclassified_from": "review_timer_ghost",
            "original_kind": "review",
        }
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed


def demote_autosave_checkpoint_time_records(session: Session) -> int:
    """Hide historical autosave checkpoints from completed time-record lists.

    Older clients wrote completion_method=saved as status=completed. Those rows
    look like real study ends ("保存结束") but are only intermediate ticks.
    """
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.completion_method == "saved",
            StudySession.deleted_at.is_(None),
        )
        .all()
    )
    fixed = 0
    for row in rows:
        try:
            summary = json.loads(row.summary_json or "{}")
        except (TypeError, json.JSONDecodeError):
            summary = {}
        if not isinstance(summary, dict):
            summary = {}
        # Keep real manual edits / quick-adds that used "saved" only if duration was edited.
        if summary.get("duration_edited"):
            continue
        row.status = "abandoned"
        summary = {
            **summary,
            "demoted_from": "autosave_checkpoint",
            "demoted_reason": "saved_completion_not_final",
        }
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed


def restore_nested_freestyle_review_time_durations(session: Session) -> int:
    """Undo a mistaken zeroing of freestyle unit-scoped review durations.

    Durations belong on the study session; only the clock display was wrong
    (midnight hour shown as 24 instead of 0). Restore from summary backup.
    """
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
        )
        .all()
    )
    fixed = 0
    for row in rows:
        try:
            summary = json.loads(row.summary_json or "{}")
        except (TypeError, json.JSONDecodeError):
            summary = {}
        if not isinstance(summary, dict):
            continue
        original = summary.get("original_effective_seconds")
        if original is None:
            continue
        if not summary.get("nested_under_freestyle_timer") and not summary.get("explicit_scope"):
            continue
        try:
            restored = max(0, int(original))
        except (TypeError, ValueError):
            continue
        row.effective_seconds = restored
        summary = {k: v for k, v in summary.items() if k not in {
            "nested_under_freestyle_timer",
            "original_effective_seconds",
        }}
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed


# Align with migration 0031 trustworthy cap: multi-hour hang-ups from PWA
# background freezes are not credible continuous study without duration_edited.
MAX_TRUSTWORTHY_STUDY_SECONDS = 4 * 60 * 60
LONG_FREESTYLE_ENCOUNTER_AUDIT_SECONDS = 60 * 60
STALE_ACTIVE_AGE = timedelta(hours=24)


def _load_summary(row: StudySession) -> dict[str, Any]:
    try:
        summary = json.loads(row.summary_json or "{}")
    except (TypeError, json.JSONDecodeError):
        summary = {}
    return summary if isinstance(summary, dict) else {}


def _scene_segments_sum_seconds(summary: dict[str, Any]) -> int | None:
    segments = summary.get("scene_segments")
    if not isinstance(segments, list) or not segments:
        return None
    total = 0
    any_valid = False
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        raw = segment.get("effectiveSeconds", segment.get("effective_seconds"))
        if raw is None:
            continue
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value < 0:
            continue
        any_valid = True
        total += value
    if not any_valid:
        return None
    return max(0, total)


def _wall_seconds(row: StudySession) -> int | None:
    if row.started_at is None or row.ended_at is None:
        return None
    try:
        return max(0, int((row.ended_at - row.started_at).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return None


def _encounter_wall_seconds(encounter: ReviewUnitEncounter) -> int | None:
    if encounter.created_at is None or encounter.closed_at is None:
        return None
    try:
        return max(0, int((encounter.closed_at - encounter.created_at).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return None


def audit_inflated_study_sessions(
    session: Session,
    *,
    max_trustworthy_seconds: int = MAX_TRUSTWORTHY_STUDY_SECONDS,
    limit: int = 50,
) -> dict[str, Any]:
    """Read-only inventory of hang-up / inflated / ghost time-record candidates."""
    max_trust = max(60, int(max_trustworthy_seconds))
    completed = (
        session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.effective_seconds > max_trust,
        )
        .order_by(StudySession.effective_seconds.desc())
        .limit(limit)
        .all()
    )
    inflated_samples: list[dict[str, Any]] = []
    for row in completed:
        summary = _load_summary(row)
        inflated_samples.append(
            {
                "id": row.id,
                "scene": row.scene,
                "title": row.title,
                "completion_method": row.completion_method,
                "effective_seconds": int(row.effective_seconds or 0),
                "wall_seconds": _wall_seconds(row),
                "started_at": row.started_at.isoformat(sep=" ") if row.started_at else None,
                "ended_at": row.ended_at.isoformat(sep=" ") if row.ended_at else None,
                "client_source": summary.get("client_source"),
                "duration_edited": bool(summary.get("duration_edited")),
            }
        )

    autosave_completed = (
        session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.completion_method == "saved",
            StudySession.deleted_at.is_(None),
        )
        .count()
    )
    ghost_review = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.completion_method.in_(tuple(GHOST_FORMAL_REVIEW_COMPLETION_METHODS)),
        )
        .count()
    )
    cutoff = utc_now_naive() - STALE_ACTIVE_AGE
    stale_active = (
        session.query(StudySession)
        .filter(
            StudySession.status.in_(("active", "paused", "recovered")),
            StudySession.deleted_at.is_(None),
            StudySession.updated_at < cutoff,
        )
        .count()
    )
    long_freestyle_query = (
        session.query(ReviewUnitEncounter, StudySession)
        .join(StudySession, StudySession.id == ReviewUnitEncounter.study_session_id)
        .filter(
            StudySession.scene == "freestyle_unit_review",
            StudySession.deleted_at.is_(None),
            ReviewUnitEncounter.status == "closed",
            ReviewUnitEncounter.effective_seconds > LONG_FREESTYLE_ENCOUNTER_AUDIT_SECONDS,
        )
        .order_by(ReviewUnitEncounter.effective_seconds.desc())
    )
    long_freestyle_count = long_freestyle_query.count()
    long_freestyle_encounters = []
    for encounter, row in long_freestyle_query.limit(limit).all():
        summary = _load_summary(row)
        long_freestyle_encounters.append(
            {
                "encounter_id": encounter.id,
                "study_session_id": row.id,
                "unit_id": encounter.unit_id,
                "title": row.title,
                "effective_seconds": int(encounter.effective_seconds or 0),
                "wall_seconds": _encounter_wall_seconds(encounter),
                "created_at": encounter.created_at.isoformat(sep=" ")
                if encounter.created_at
                else None,
                "closed_at": encounter.closed_at.isoformat(sep=" ")
                if encounter.closed_at
                else None,
                "client_source": summary.get("client_source"),
            }
        )
    return {
        "max_trustworthy_seconds": max_trust,
        "inflated_completed_count": len(inflated_samples)
        if len(inflated_samples) < limit
        else session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.effective_seconds > max_trust,
        )
        .count(),
        "inflated_samples": inflated_samples,
        "autosave_completed_count": int(autosave_completed),
        "ghost_review_count": int(ghost_review),
        "stale_active_count": int(stale_active),
        "long_freestyle_encounter_threshold_seconds": LONG_FREESTYLE_ENCOUNTER_AUDIT_SECONDS,
        "long_freestyle_encounter_count": int(long_freestyle_count),
        "long_freestyle_encounters": long_freestyle_encounters,
    }


def demote_inflated_hang_study_sessions(
    session: Session,
    *,
    max_trustworthy_seconds: int = MAX_TRUSTWORTHY_STUDY_SECONDS,
) -> dict[str, int]:
    """Demote or cap completed sessions inflated by PWA background hang-up.

    Strategy (safe, auditable):
    1. Skip duration_edited rows (user-owned duration).
    2. If scene_segments sum is positive and <= cap, set effective to that sum.
    3. Else if same-day wall span is 1..cap, cap effective to wall.
    4. Else demote status to abandoned with duration_repair audit trail.
    """
    max_trust = max(60, int(max_trustworthy_seconds))
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.effective_seconds > max_trust,
        )
        .all()
    )
    capped = 0
    demoted = 0
    skipped = 0
    for row in rows:
        summary = _load_summary(row)
        if summary.get("duration_edited"):
            skipped += 1
            continue
        if isinstance(summary.get("duration_repair"), dict):
            skipped += 1
            continue

        original = max(0, int(row.effective_seconds or 0))
        segments_sum = _scene_segments_sum_seconds(summary)
        wall = _wall_seconds(row)
        same_day = bool(
            row.started_at
            and row.ended_at
            and row.started_at.date() == row.ended_at.date()
        )

        repair: dict[str, Any] = {
            "version": 1,
            "reason": "overnight_or_background_hang",
            "original_effective_seconds": original,
            "max_trustworthy_seconds": max_trust,
        }

        if segments_sum is not None and 0 < segments_sum <= max_trust and segments_sum < original:
            row.effective_seconds = segments_sum
            repair["action"] = "cap_to_scene_segments"
            repair["repaired_effective_seconds"] = segments_sum
            summary["duration_repair"] = repair
            row.summary_json = json.dumps(summary, ensure_ascii=False)
            row.updated_at = utc_now_naive()
            capped += 1
            continue

        if (
            same_day
            and wall is not None
            and 0 < wall <= max_trust
            and wall < original
        ):
            row.effective_seconds = wall
            repair["action"] = "cap_to_wall_seconds"
            repair["repaired_effective_seconds"] = wall
            repair["wall_seconds"] = wall
            summary["duration_repair"] = repair
            row.summary_json = json.dumps(summary, ensure_ascii=False)
            row.updated_at = utc_now_naive()
            capped += 1
            continue

        row.status = "abandoned"
        repair["action"] = "demote_abandoned"
        summary["duration_repair"] = repair
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        demoted += 1

    if capped or demoted:
        session.flush()
    return {"capped": capped, "demoted": demoted, "skipped": skipped}


def backfill_missing_client_source_on_study_sessions(
    session: Session,
    *,
    default_source: str = "desktop",
    only_unit_review: bool = False,
) -> int:
    """Fill missing summary.client_source for completed sessions that lack it.

    Default is conservative desktop: this private product is primarily used on
    the two Windows machines; freestyle unit review / formal review server paths
    never stamped source historically. Timer rows with migrated_from time_records
    also lack the field.

    Set only_unit_review=True to limit to freestyle/formal unit review receipts.
    """
    normalized = _normalize_client_source(default_source)
    if normalized is None:
        raise ValueError("default_source must be desktop or pwa")

    rows = (
        session.query(StudySession)
        .filter(
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
        )
        .all()
    )
    fixed = 0
    for row in rows:
        if only_unit_review and row.scene not in {
            "freestyle_unit_review",
            "formal_unit_review",
        }:
            continue
        summary = _load_summary(row)
        existing = _normalize_client_source(summary.get("client_source"))
        if existing is not None:
            continue
        summary = {
            **summary,
            "client_source": normalized,
            "client_source_backfill": {
                "version": 1,
                "source": normalized,
                "reason": "missing_client_source",
                "only_unit_review": only_unit_review,
            },
        }
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed


def abandon_stale_active_study_sessions(
    session: Session,
    *,
    older_than: timedelta = STALE_ACTIVE_AGE,
) -> int:
    """Mark long-idle active/paused/recovered checkpoints as abandoned."""
    cutoff = utc_now_naive() - older_than
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.status.in_(("active", "paused", "recovered")),
            StudySession.deleted_at.is_(None),
            StudySession.updated_at < cutoff,
        )
        .all()
    )
    fixed = 0
    for row in rows:
        summary = _load_summary(row)
        previous_status = row.status
        row.status = "abandoned"
        if row.ended_at is None:
            row.ended_at = row.updated_at or utc_now_naive()
        summary = {
            **summary,
            "abandoned_from": previous_status,
            "abandoned_reason": "stale_active_checkpoint",
        }
        row.summary_json = json.dumps(summary, ensure_ascii=False)
        row.updated_at = utc_now_naive()
        fixed += 1
    if fixed:
        session.flush()
    return fixed
