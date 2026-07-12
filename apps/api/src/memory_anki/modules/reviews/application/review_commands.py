from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.reviews.application.review_execution_service import (
    submit_review,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_next_due_review,
    spread_overdue,
)
from memory_anki.modules.sessions.api import (
    clear_review_progress,
)
from memory_anki.platform.application import UnitOfWork

ResponseCallback = Callable[[dict[str, Any]], None]


def spread_overdue_command(
    session: Session,
    *,
    days: int,
    dry_run: bool,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    result = spread_overdue(session, days, dry_run=dry_run, commit=False)
    response = {"ok": True, "spread": result["count"], "moves": result["moves"]}
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def submit_review_command(
    session: Session,
    schedule_id: int,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any] | None:
    log, extra = submit_review(
        session,
        schedule_id,
        int(payload.get("duration_seconds", 0)),
        str(payload.get("completion_mode", "manual_complete")),
        target_review_number=payload.get("target_review_number"),
        needs_practice=bool(payload.get("needs_practice", False)),
        commit=False,
    )
    if log is None:
        return None

    note = str(payload.get("note") or "").strip()
    if note:
        log.note = note[:2000]

    clear_review_progress(session, schedule_id, commit=False)
    chapter_id = payload.get("chapter_id")
    next_schedule = get_next_due_review(
        session,
        exclude_schedule_id=schedule_id,
        chapter_id=int(chapter_id) if chapter_id is not None else None,
    )
    response = {
        "ok": True,
        "completion_mode": payload.get("completion_mode"),
        "score": log.score,
        "next_id": next_schedule.id if next_schedule else None,
        "mastered": extra.get("mastered", False),
    }
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def _commit_response(
    response: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None,
) -> None:
    if before_commit is not None:
        before_commit(response)
    uow.commit()
