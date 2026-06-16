from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import IMPORT_JOBS_DIR
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import MindMapImportJob, engine
from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
    render_selected_pdf_pages,
)

from .mindmap_import import (
    ERROR_SNIPPET_LIMIT,
    MindMapImportError,
    PdfImportOptions,
    job_artifacts,
    job_creation_support,
    job_errors,
    job_lifecycle,
    job_repository,
    job_state,
    job_worker,
)
from .mindmap_import import ensure_rendered_page_size as _ensure_rendered_page_size
from .mindmap_import import summarize_model_output as _summarize_model_output
from .mindmap_import_job_runtime import (
    _stream_call_dashscope_batch_json,
    _stream_call_dashscope_json,
    _stream_call_dashscope_pdf_json,
    _stream_call_dashscope_text,
)

JOB_STATUS_RUNNING = job_state.JOB_STATUS_RUNNING
JOB_STATUS_PAUSED = job_state.JOB_STATUS_PAUSED
JOB_STATUS_COMPLETED = job_state.JOB_STATUS_COMPLETED
SOURCE_KIND_IMAGE_SINGLE = job_state.SOURCE_KIND_IMAGE_SINGLE
SOURCE_KIND_IMAGE_BATCH = job_state.SOURCE_KIND_IMAGE_BATCH
SOURCE_KIND_SUBJECT_PDF = job_state.SOURCE_KIND_SUBJECT_PDF
_UNSET = job_state.UNSET

_RUNNING_JOB_THREADS: dict[str, threading.Thread] = {}
_RUNNING_JOB_LOCK = threading.Lock()


def _job_lifecycle_dependencies() -> job_lifecycle.JobLifecycleDependencies:
    return job_lifecycle.JobLifecycleDependencies(
        session_factory=lambda: Session(engine),
        get_job_fn=job_repository.get_job,
        load_source_meta_fn=lambda job: _json_load(job.source_meta_json, {}),
        get_job_artifact_dir_fn=lambda job_id: job_artifacts.get_job_artifact_dir(IMPORT_JOBS_DIR, job_id),
        run_image_single_job_fn=_run_image_single_job,
        run_image_batch_job_fn=_run_image_batch_job,
        run_subject_pdf_job_fn=_run_subject_pdf_job,
        mark_job_completed_fn=_mark_job_completed,
        mark_job_failed_fn=_mark_job_failed,
        utc_now_fn=utc_now_naive,
        running_status=JOB_STATUS_RUNNING,
        paused_status=JOB_STATUS_PAUSED,
        completed_status=JOB_STATUS_COMPLETED,
        source_kind_image_single=SOURCE_KIND_IMAGE_SINGLE,
        source_kind_image_batch=SOURCE_KIND_IMAGE_BATCH,
        source_kind_subject_pdf=SOURCE_KIND_SUBJECT_PDF,
        import_error_cls=MindMapImportError,
    )


def run_job_async(job_id: str) -> None:
    job_lifecycle.run_job_async(
        job_id,
        running_threads=_RUNNING_JOB_THREADS,
        running_lock=_RUNNING_JOB_LOCK,
        run_job_worker_fn=_run_job_worker,
    )


def _set_job_progress(
    session: Session,
    job_id: str,
    *,
    phase: str | None | object = _UNSET,
    message: str | None | object = _UNSET,
    step: int | None | object = _UNSET,
    total_steps: int | None | object = _UNSET,
    preview_text: str | None | object = _UNSET,
) -> dict[str, Any]:
    return job_repository.set_job_progress(
        session,
        job_id,
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
        phase=phase,
        message=message,
        step=step,
        total_steps=total_steps,
        preview_text=preview_text,
    )


def _sync_job_progress_artifact(artifact_dir: Path, preview_text: str) -> None:
    job_artifacts.sync_job_progress_artifact(artifact_dir, preview_text)


def _pause_if_requested(session: Session, job_id: str) -> bool:
    return job_repository.pause_if_requested(
        session,
        job_id,
        import_jobs_dir=IMPORT_JOBS_DIR,
    )


def _run_job_worker(job_id: str) -> None:
    job_lifecycle.run_job_worker(
        job_id,
        deps=_job_lifecycle_dependencies(),
        running_threads=_RUNNING_JOB_THREADS,
        running_lock=_RUNNING_JOB_LOCK,
    )


def _run_image_single_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
) -> None:
    job_worker.run_image_single_job(
        session,
        job,
        source_meta,
        artifact_dir,
        import_jobs_dir=IMPORT_JOBS_DIR,
        find_first_input_file_fn=_find_first_input_file,
        stream_call_dashscope_json=lambda **kwargs: _stream_call_dashscope_json(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_text=lambda **kwargs: _stream_call_dashscope_text(
            source_meta=source_meta,
            **kwargs,
        ),
    )


def _run_image_batch_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
) -> None:
    job_worker.run_image_batch_job(
        session,
        job,
        source_meta,
        artifact_dir,
        import_jobs_dir=IMPORT_JOBS_DIR,
        stream_call_dashscope_json=lambda **kwargs: _stream_call_dashscope_json(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_batch_json=lambda **kwargs: _stream_call_dashscope_batch_json(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_pdf_json=lambda **kwargs: _stream_call_dashscope_pdf_json(
            source_meta=source_meta,
            **kwargs,
        ),
    )


def _run_subject_pdf_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
) -> None:
    job_worker.run_subject_pdf_job(
        session,
        job,
        source_meta,
        artifact_dir,
        import_jobs_dir=IMPORT_JOBS_DIR,
        pdf_options_cls=PdfImportOptions,
        get_subject_document_by_id_fn=get_subject_document_by_id,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=_ensure_rendered_page_size,
        stream_call_dashscope_json=lambda **kwargs: _stream_call_dashscope_json(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_text=lambda **kwargs: _stream_call_dashscope_text(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_batch_json=lambda **kwargs: _stream_call_dashscope_batch_json(
            source_meta=source_meta,
            **kwargs,
        ),
        stream_call_dashscope_pdf_json=lambda **kwargs: _stream_call_dashscope_pdf_json(
            source_meta=source_meta,
            **kwargs,
        ),
        source_meta_to_pdf_options_fn=job_creation_support.source_meta_to_pdf_options,
    )


def _mark_job_completed(session: Session, job_id: str) -> None:
    job_repository.mark_job_completed(
        session,
        job_id,
        import_jobs_dir=IMPORT_JOBS_DIR,
    )


def _mark_job_failed(session: Session, job_id: str, exc: Exception) -> None:
    job_repository.mark_job_failed(
        session,
        job_id,
        exc,
        import_jobs_dir=IMPORT_JOBS_DIR,
        summarize_model_output_fn=_summarize_model_output,
        error_snippet_limit=ERROR_SNIPPET_LIMIT,
    )


def _set_job_stage(session: Session, job_id: str, *, stage: str) -> None:
    job_repository.set_job_stage(session, job_id, stage=stage)


def _set_job_result(
    session: Session,
    job_id: str,
    *,
    result: dict[str, Any],
    stage: str,
) -> None:
    job_repository.set_job_result(
        session,
        job_id,
        result=result,
        stage=stage,
    )


def _update_job_usage(
    session: Session,
    job_id: str,
    *,
    stage_key: str,
    increment: int,
) -> None:
    job_repository.update_job_usage(
        session,
        job_id,
        stage_key=stage_key,
        increment=increment,
    )


def _build_structured_error(
    exc: Exception,
    *,
    stage: str,
    job: MindMapImportJob | None = None,
) -> dict[str, Any]:
    return job_errors.build_structured_error(
        exc,
        stage=stage,
        job=job,
        summarize_model_output_fn=_summarize_model_output,
        error_snippet_limit=ERROR_SNIPPET_LIMIT,
    )


def _source_meta_to_pdf_options(source_meta: dict[str, Any]) -> PdfImportOptions:
    return job_creation_support.source_meta_to_pdf_options(source_meta, PdfImportOptions)


def _ensure_rendered_pdf_pages(
    session: Session,
    *,
    artifact_dir: Path,
    source_meta: dict[str, Any],
) -> list[tuple[int, bytes, str]]:
    return job_artifacts.ensure_rendered_pdf_pages(
        session,
        artifact_dir=artifact_dir,
        source_meta=source_meta,
        get_subject_document_by_id_fn=get_subject_document_by_id,
        render_selected_pdf_pages_fn=render_selected_pdf_pages,
        ensure_rendered_page_size_fn=_ensure_rendered_page_size,
        import_error_cls=MindMapImportError,
    )


def _load_batch_image_items(
    artifact_dir: Path,
    source_meta: dict[str, Any],
) -> list[tuple[bytes, str | None]]:
    return job_artifacts.load_batch_image_items(
        artifact_dir,
        source_meta,
        import_error_cls=MindMapImportError,
    )


def _load_rendered_pdf_pages(artifact_dir: Path) -> list[tuple[int, bytes, str]]:
    return job_artifacts.load_rendered_pdf_pages(
        artifact_dir,
        import_error_cls=MindMapImportError,
    )


def _find_first_input_file(artifact_dir: Path) -> Path | None:
    return job_artifacts.find_first_input_file(artifact_dir)


def _json_load(value: str | None, default: Any) -> Any:
    return job_artifacts.json_load(value, default)


__all__ = [
    "_RUNNING_JOB_LOCK",
    "_RUNNING_JOB_THREADS",
    "_UNSET",
    "_build_structured_error",
    "_ensure_rendered_pdf_pages",
    "_find_first_input_file",
    "_job_lifecycle_dependencies",
    "_json_load",
    "_load_batch_image_items",
    "_load_rendered_pdf_pages",
    "_mark_job_completed",
    "_mark_job_failed",
    "_pause_if_requested",
    "_run_image_batch_job",
    "_run_image_single_job",
    "_run_job_worker",
    "_run_subject_pdf_job",
    "_set_job_progress",
    "_set_job_result",
    "_set_job_stage",
    "_source_meta_to_pdf_options",
    "_sync_job_progress_artifact",
    "_update_job_usage",
    "run_job_async",
]
