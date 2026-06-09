from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import EnglishCourse, EnglishGenerationTask
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log,
    list_external_ai_call_logs,
)

from .paths import course_log_path, task_log_path


def append_generation_log_event(
    *,
    task_id: str,
    stage: str,
    kind: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = {
        "id": uuid.uuid4().hex,
        "timestamp": utc_now_naive().isoformat(),
        "stage": stage,
        "kind": kind,
        "message": message,
        "data": data or {},
    }
    path = task_log_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False))
        handle.write("\n")
    return event


def move_generation_log_to_course(*, task_id: str, course_id: int) -> None:
    source = task_log_path(task_id)
    if not source.exists():
        return
    target = course_log_path(course_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def read_generation_log_events(
    *,
    task: EnglishGenerationTask | None = None,
    course: EnglishCourse | None = None,
) -> list[dict[str, Any]]:
    candidate_paths: list[Path] = []
    if task is not None:
        candidate_paths.append(task_log_path(task.id))
        if task.course_id:
            candidate_paths.append(course_log_path(task.course_id))
    if course is not None:
        candidate_paths.append(course_log_path(course.id))
    path = next((item for item in candidate_paths if item.exists()), None)
    if path is None:
        return []
    events: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            event = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def load_ai_logs_for_task(session: Session, task_id: str | None) -> list[dict[str, Any]]:
    if not task_id:
        return []
    summaries = list_external_ai_call_logs(session, job_id=task_id, limit=200)
    detailed: list[dict[str, Any]] = []
    for item in summaries:
        log_id = str(item.get("id") or "")
        if not log_id:
            continue
        detail = get_external_ai_call_log(session, log_id)
        if detail:
            detailed.append(detail)
    return detailed
