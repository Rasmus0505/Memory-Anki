from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import MindMapImportJob

from .job_artifacts import (
    get_job_artifact_dir,
    json_dump,
    json_load,
    write_json,
    write_text,
)
from .job_errors import build_structured_error
from .job_state import (
    JOB_STAGE_COMPLETED,
    JOB_STAGE_PREPARED,
    JOB_STATUS_COMPLETED,
    JOB_STATUS_DRAFT,
    JOB_STATUS_FAILED,
    JOB_STATUS_INTERRUPTED,
    JOB_STATUS_PAUSED,
    UNSET,
    empty_progress,
    empty_usage,
)


def get_job(
    session: Session,
    job_id: str,
) -> MindMapImportJob | None:
    return (
        session.query(MindMapImportJob)
        .filter(
            MindMapImportJob.id == job_id,
            MindMapImportJob.deleted_at.is_(None),
        )
        .first()
    )


def list_jobs(
    session: Session,
    *,
    entity_key: str,
) -> list[MindMapImportJob]:
    return (
        session.query(MindMapImportJob)
        .filter(
            MindMapImportJob.entity_key == entity_key,
            MindMapImportJob.deleted_at.is_(None),
        )
        .order_by(MindMapImportJob.created_at.desc(), MindMapImportJob.id.desc())
        .all()
    )


def delete_job(
    session: Session,
    *,
    job_id: str,
) -> MindMapImportJob | None:
    job = get_job(session, job_id)
    if not job:
        return None
    job.deleted_at = utc_now_naive()
    job.updated_at = utc_now_naive()
    session.commit()
    session.refresh(job)
    return job


def request_pause_job(
    session: Session,
    *,
    job_id: str,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    job = get_job(session, job_id)
    if not job:
        raise import_error_cls("导入任务不存在。")
    if job.status == JOB_STATUS_COMPLETED:
        raise import_error_cls("导入任务已完成，无法暂停。")

    progress = json_load(job.progress_json, empty_progress())
    progress["message"] = "正在等待当前步骤收尾后暂停…"
    job.progress_json = json_dump(progress)
    job.pause_requested = True
    if job.status == JOB_STATUS_DRAFT:
        job.status = JOB_STATUS_PAUSED
        job.pause_requested = False
        progress["message"] = "识别已暂停，可继续识别。"
        job.progress_json = json_dump(progress)
    job.updated_at = utc_now_naive()
    session.commit()
    session.refresh(job)
    return job


def wait_for_job_completion(
    session_factory: Any,
    *,
    job_id: str,
    timeout_seconds: float = 120.0,
    poll_interval_seconds: float = 0.2,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        session = session_factory()
        try:
            job = get_job(session, job_id)
            if not job:
                raise import_error_cls("导入任务不存在。")
            if job.status in {
                JOB_STATUS_COMPLETED,
                JOB_STATUS_FAILED,
                JOB_STATUS_INTERRUPTED,
                JOB_STATUS_PAUSED,
            }:
                return job
        finally:
            session.close()
        time.sleep(poll_interval_seconds)
    raise import_error_cls("导入任务执行超时，请稍后继续恢复。")


def serialize_job(job: MindMapImportJob) -> dict[str, Any]:
    source_meta = json_load(job.source_meta_json, {})
    result = json_load(job.result_json, {})
    error = json_load(job.error_json, {})
    usage = json_load(job.usage_json, empty_usage())
    progress = json_load(job.progress_json, empty_progress())
    return {
        "id": job.id,
        "entity_key": job.entity_key,
        "status": job.status,
        "stage": job.stage,
        "resumable": job.status
        in {JOB_STATUS_DRAFT, JOB_STATUS_PAUSED, JOB_STATUS_FAILED, JOB_STATUS_INTERRUPTED},
        "pause_requested": bool(job.pause_requested),
        "source_kind": job.source_kind,
        "mode": job.mode,
        "source_meta": source_meta,
        "result": result or None,
        "error": error or None,
        "usage": usage,
        "progress": progress,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


def complete_job_from_preview(
    session: Session,
    *,
    job_id: str,
    result: dict[str, Any],
    usage: dict[str, Any] | None,
    import_jobs_dir: Path,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    job = get_job(session, job_id)
    if not job:
        raise import_error_cls("导入任务不存在。")
    artifact_dir = get_job_artifact_dir(import_jobs_dir, job.id)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    normalized_usage = empty_usage()
    if usage:
        for key in normalized_usage:
            if key == "total":
                continue
            normalized_usage[key] = max(0, int(usage.get(key) or 0))
    normalized_usage["total"] = sum(
        int(normalized_usage.get(key) or 0)
        for key in ("structure", "ocr", "merge", "text")
    )

    if result.get("source_tree") is not None:
        write_json(artifact_dir / "final_tree.json", result["source_tree"])
    if result.get("editor_doc") is not None:
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
    if result.get("extracted_text") is not None:
        write_text(
            artifact_dir / "extracted_text.txt",
            str(result.get("extracted_text") or ""),
        )
    write_json(artifact_dir / "result.json", result)

    job.result_json = json_dump(result)
    job.error_json = "{}"
    job.usage_json = json_dump(normalized_usage)
    job.status = JOB_STATUS_COMPLETED
    job.stage = JOB_STAGE_COMPLETED
    job.pause_requested = False
    job.progress_json = json_dump(
        {
            **json_load(job.progress_json, empty_progress()),
            "phase": JOB_STAGE_COMPLETED,
            "message": "识别完成，可继续预览或应用。",
            "step": normalized_usage["total"] if normalized_usage["total"] > 0 else None,
            "total_steps": normalized_usage["total"] if normalized_usage["total"] > 0 else None,
        }
    )
    job.started_at = job.started_at or utc_now_naive()
    job.completed_at = utc_now_naive()
    job.updated_at = utc_now_naive()
    session.commit()
    session.refresh(job)
    return job


def set_job_progress(
    session: Session,
    job_id: str,
    *,
    import_jobs_dir: Path,
    import_error_cls: type[Exception],
    phase: str | None | object = UNSET,
    message: str | None | object = UNSET,
    step: int | None | object = UNSET,
    total_steps: int | None | object = UNSET,
    preview_text: str | None | object = UNSET,
) -> dict[str, Any]:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        raise import_error_cls("导入任务不存在。")
    progress = json_load(job.progress_json, empty_progress())
    if phase is not UNSET:
        progress["phase"] = phase
    if message is not UNSET:
        progress["message"] = message
    if step is not UNSET:
        progress["step"] = step
    if total_steps is not UNSET:
        progress["total_steps"] = total_steps
    if preview_text is not UNSET:
        progress["preview_text"] = preview_text
    job.progress_json = json_dump(progress)
    job.updated_at = utc_now_naive()
    session.commit()

    artifact_dir = get_job_artifact_dir(import_jobs_dir, job_id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    write_json(artifact_dir / "progress.json", progress)
    if preview_text is not UNSET:
        write_text(artifact_dir / "preview_text.txt", progress["preview_text"])
    return progress


def pause_if_requested(
    session: Session,
    job_id: str,
    *,
    import_jobs_dir: Path,
) -> bool:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job or not job.pause_requested:
        return False
    progress = json_load(job.progress_json, empty_progress())
    progress["message"] = "识别已暂停，可继续识别。"
    job.progress_json = json_dump(progress)
    job.status = JOB_STATUS_PAUSED
    job.pause_requested = False
    job.updated_at = utc_now_naive()
    session.commit()
    artifact_dir = get_job_artifact_dir(import_jobs_dir, job_id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    write_json(artifact_dir / "progress.json", progress)
    return True


def mark_job_completed(
    session: Session,
    job_id: str,
    *,
    import_jobs_dir: Path,
) -> None:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        return
    progress = json_load(job.progress_json, empty_progress())
    progress["phase"] = JOB_STAGE_COMPLETED
    progress["message"] = "识别完成，可继续预览或应用。"
    job.status = JOB_STATUS_COMPLETED
    job.stage = JOB_STAGE_COMPLETED
    job.pause_requested = False
    job.progress_json = json_dump(progress)
    job.completed_at = utc_now_naive()
    job.updated_at = utc_now_naive()
    session.commit()
    write_json(get_job_artifact_dir(import_jobs_dir, job_id) / "progress.json", progress)


def mark_job_failed(
    session: Session,
    job_id: str,
    exc: Exception,
    *,
    import_jobs_dir: Path,
    summarize_model_output_fn,
    error_snippet_limit: int,
) -> None:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        return
    stage = job.stage or JOB_STAGE_PREPARED
    error = build_structured_error(
        exc,
        stage=stage,
        job=job,
        summarize_model_output_fn=summarize_model_output_fn,
        error_snippet_limit=error_snippet_limit,
    )
    write_json(get_job_artifact_dir(import_jobs_dir, job_id) / "error.json", error)
    progress = json_load(job.progress_json, empty_progress())
    progress["message"] = error["message"]
    job.status = JOB_STATUS_FAILED
    job.pause_requested = False
    job.updated_at = utc_now_naive()
    job.error_json = json_dump(error)
    job.progress_json = json_dump(progress)
    session.commit()
    write_json(get_job_artifact_dir(import_jobs_dir, job_id) / "progress.json", progress)


def set_job_stage(session: Session, job_id: str, *, stage: str) -> None:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        return
    job.stage = stage
    job.updated_at = utc_now_naive()
    session.commit()


def set_job_result(
    session: Session,
    job_id: str,
    *,
    result: dict[str, Any],
    stage: str,
) -> None:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        return
    job.result_json = json_dump(result)
    job.error_json = "{}"
    job.stage = stage
    job.pause_requested = False
    job.updated_at = utc_now_naive()
    session.commit()


def update_job_usage(
    session: Session,
    job_id: str,
    *,
    stage_key: str,
    increment: int,
) -> None:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        return
    usage = json_load(job.usage_json, empty_usage())
    usage[stage_key] = int(usage.get(stage_key) or 0) + increment
    usage["total"] = sum(
        int(usage.get(key) or 0) for key in ("structure", "ocr", "merge", "text")
    )
    job.usage_json = json_dump(usage)
    job.updated_at = utc_now_naive()
    session.commit()


def touch_job(
    session: Session,
    job_id: str,
    *,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    job = session.query(MindMapImportJob).filter_by(id=job_id).first()
    if not job:
        raise import_error_cls("导入任务不存在。")
    job.updated_at = utc_now_naive()
    session.commit()
    session.refresh(job)
    return job


def find_existing_job(
    session: Session,
    *,
    entity_key: str,
    fingerprint: str,
) -> MindMapImportJob | None:
    return (
        session.query(MindMapImportJob)
        .filter(
            MindMapImportJob.entity_key == entity_key,
            MindMapImportJob.fingerprint == fingerprint,
            MindMapImportJob.deleted_at.is_(None),
        )
        .order_by(MindMapImportJob.created_at.desc(), MindMapImportJob.id.desc())
        .first()
    )
