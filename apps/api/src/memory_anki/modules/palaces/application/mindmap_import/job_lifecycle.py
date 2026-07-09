from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import MindMapImportJob


@dataclass(frozen=True)
class JobLifecycleDependencies:
    session_factory: Callable[[], Session]
    get_job_fn: Callable[[Session, str], MindMapImportJob | None]
    load_source_meta_fn: Callable[[MindMapImportJob], dict[str, Any]]
    get_job_artifact_dir_fn: Callable[[str], Path]
    run_image_single_job_fn: Callable[[Session, MindMapImportJob, dict[str, Any], Path], None]
    run_image_batch_job_fn: Callable[[Session, MindMapImportJob, dict[str, Any], Path], None]
    mark_job_completed_fn: Callable[[Session, str], None]
    mark_job_failed_fn: Callable[[Session, str, Exception], None]
    utc_now_fn: Callable[[], Any]
    running_status: str
    paused_status: str
    completed_status: str
    source_kind_image_single: str
    source_kind_image_batch: str
    import_error_cls: type[Exception]


def run_job_async(
    job_id: str,
    *,
    running_threads: dict[str, threading.Thread],
    running_lock: threading.Lock,
    run_job_worker_fn: Callable[[str], None],
) -> None:
    with running_lock:
        thread = running_threads.get(job_id)
        if thread and thread.is_alive():
            return
        next_thread = threading.Thread(
            target=run_job_worker_fn,
            args=(job_id,),
            daemon=True,
            name=f"mindmap-import-job-{job_id[:8]}",
        )
        running_threads[job_id] = next_thread
        next_thread.start()


def run_job_worker(
    job_id: str,
    *,
    deps: JobLifecycleDependencies,
    running_threads: dict[str, threading.Thread],
    running_lock: threading.Lock,
) -> None:
    session = deps.session_factory()
    try:
        job = deps.get_job_fn(session, job_id)
        if not job or job.status == deps.completed_status:
            return

        job.status = deps.running_status
        job.pause_requested = False
        job.started_at = job.started_at or deps.utc_now_fn()
        job.updated_at = deps.utc_now_fn()
        job.error_json = "{}"
        session.commit()
        session.refresh(job)

        source_meta = deps.load_source_meta_fn(job)
        artifact_dir = deps.get_job_artifact_dir_fn(job.id)
        artifact_dir.mkdir(parents=True, exist_ok=True)

        if job.source_kind == deps.source_kind_image_single:
            deps.run_image_single_job_fn(session, job, source_meta, artifact_dir)
        elif job.source_kind == deps.source_kind_image_batch:
            deps.run_image_batch_job_fn(session, job, source_meta, artifact_dir)
        else:
            raise deps.import_error_cls("Unknown import job source kind.")

        session.refresh(job)
        if job.status == deps.paused_status:
            return
        deps.mark_job_completed_fn(session, job.id)
    except Exception as exc:  # noqa: BLE001
        deps.mark_job_failed_fn(session, job_id, exc)
    finally:
        session.close()
        with running_lock:
            running_threads.pop(job_id, None)
