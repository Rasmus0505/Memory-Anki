from __future__ import annotations

from sqlalchemy.orm import Session

from .task_service import cleanup_incomplete_generation_tasks


def prepare_english_runtime(session: Session) -> dict[str, int]:
    return cleanup_incomplete_generation_tasks(session)
