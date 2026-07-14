from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.reviews.application.review_execution_service import (
    _migrate_orphan_review_progress,
    _migrate_orphan_review_study_sessions,
    _recover_review_progress_from_practice,
    _sync_review_progress_to_study_sessions,
    detect_review_stage_progress_issues,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_all_pending_review_schedules,
)
from memory_anki.platform.application import UnitOfWork


def _run_review_stage_progress_repair(session: Session) -> dict:
    result = rebuild_all_pending_review_schedules(session)
    orphan_progress_count = _migrate_orphan_review_progress(session)
    orphan_study_session_count = _migrate_orphan_review_study_sessions(session)
    practice_recovery_count = _recover_review_progress_from_practice(session)
    study_session_count = _sync_review_progress_to_study_sessions(session)
    return {
        **result,
        "orphan_progress_count": orphan_progress_count,
        "orphan_study_session_count": orphan_study_session_count,
        "practice_recovery_count": practice_recovery_count,
        "study_session_count": study_session_count,
    }


def preview_review_stage_progress_repair(session: Session) -> dict:
    before = detect_review_stage_progress_issues(session)
    savepoint = session.begin_nested()
    try:
        proposed = _run_review_stage_progress_repair(session)
        after = detect_review_stage_progress_issues(session)
    finally:
        savepoint.rollback()
        session.expire_all()
    return {"dry_run": True, "before": before, "after": after, **proposed}


def repair_review_stage_progress(
    session: Session,
    *,
    uow: UnitOfWork,
) -> dict:
    result = _run_review_stage_progress_repair(session)
    uow.commit()
    return {"dry_run": False, **result}
