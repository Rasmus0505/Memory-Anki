from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from . import MindMapImportError, step_protocol
from .job_artifacts import sync_job_progress_artifact
from .job_repository import set_job_progress

_PREVIEW_TEXT_UNSET = object()


def set_progress_step(
    session: Session,
    *,
    job_id: str,
    import_jobs_dir: Path,
    step: step_protocol.ImportStep,
    preview_text: str | None | object = _PREVIEW_TEXT_UNSET,
) -> None:
    progress_kwargs: dict[str, Any] = step.as_payload()
    if preview_text is not _PREVIEW_TEXT_UNSET:
        progress_kwargs["preview_text"] = preview_text
    set_job_progress(
        session,
        job_id,
        import_jobs_dir=import_jobs_dir,
        import_error_cls=MindMapImportError,
        **progress_kwargs,
    )


def apply_stream_progress_event(
    session: Session,
    *,
    job_id: str,
    artifact_dir: Path,
    event: dict[str, Any],
    allow_preview_text: bool,
    import_jobs_dir: Path,
) -> None:
    if event.get("event") == "status":
        data = dict(event.get("data") or {})
        set_job_progress(
            session,
            job_id,
            import_jobs_dir=import_jobs_dir,
            import_error_cls=MindMapImportError,
            phase=str(data.get("phase") or ""),
            message=str(data.get("message") or ""),
            step=data.get("step"),
            total_steps=data.get("total_steps"),
        )
        return

    if event.get("event") != "delta":
        return

    data = dict(event.get("data") or {})
    channel = str(data.get("channel") or "")
    if not allow_preview_text and channel != "raw_model":
        return
    preview_text = str(data.get("accumulated_text") or "")
    sync_job_progress_artifact(artifact_dir, preview_text)
    set_job_progress(
        session,
        job_id,
        import_jobs_dir=import_jobs_dir,
        import_error_cls=MindMapImportError,
        preview_text=preview_text,
    )


def consume_stream_result(
    session: Session,
    *,
    job_id: str,
    artifact_dir: Path,
    generator: Any,
    allow_preview_text: bool,
    import_jobs_dir: Path,
) -> Any:
    while True:
        try:
            event = next(generator)
        except StopIteration as exc:
            return exc.value
        apply_stream_progress_event(
            session,
            job_id=job_id,
            artifact_dir=artifact_dir,
            event=event,
            allow_preview_text=allow_preview_text,
            import_jobs_dir=import_jobs_dir,
        )
