from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_VISION_MODEL,
    IMPORT_JOBS_DIR,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import MindMapImportJob, SubjectDocument, engine
from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
    render_selected_pdf_pages,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_provider_setting,
    resolve_scenario_runtime,
)

from .mindmap_import import (
    ERROR_SNIPPET_LIMIT,
    MAX_IMAGE_BYTES,
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_IMPORT_MODE_STRUCTURED_MERGE,
    PROMPT,
    MindMapImportError,
    PdfImportOptions,
    job_artifacts,
    job_creation,
    job_creation_support,
    job_errors,
    job_lifecycle,
    job_repository,
    job_state,
    job_worker,
    llm_gateway,
)
from .mindmap_import import (
    ensure_rendered_page_size as _ensure_rendered_page_size,
)
from .mindmap_import import (
    normalize_page_selection as _normalize_page_selection,
)
from .mindmap_import import (
    summarize_model_output as _summarize_model_output,
)
from .mindmap_import.runtime import DashscopeImportRuntime
from .mindmap_import.workflow import (
    normalize_pdf_import_mode as _normalize_pdf_import_mode,
)
from .mindmap_import.workflow import (
    resolve_pdf_structure_page as _resolve_pdf_structure_page,
)

JOB_STATUS_DRAFT = job_state.JOB_STATUS_DRAFT
JOB_STATUS_RUNNING = job_state.JOB_STATUS_RUNNING
JOB_STATUS_PAUSED = job_state.JOB_STATUS_PAUSED
JOB_STATUS_COMPLETED = job_state.JOB_STATUS_COMPLETED
JOB_STATUS_FAILED = job_state.JOB_STATUS_FAILED
JOB_STATUS_INTERRUPTED = job_state.JOB_STATUS_INTERRUPTED

JOB_STAGE_PREPARED = job_state.JOB_STAGE_PREPARED
JOB_STAGE_STRUCTURE = job_state.JOB_STAGE_STRUCTURE
JOB_STAGE_OCR = job_state.JOB_STAGE_OCR
JOB_STAGE_MERGE = job_state.JOB_STAGE_MERGE
JOB_STAGE_TEXT = job_state.JOB_STAGE_TEXT
JOB_STAGE_COMPLETED = job_state.JOB_STAGE_COMPLETED

SOURCE_KIND_IMAGE_SINGLE = job_state.SOURCE_KIND_IMAGE_SINGLE
SOURCE_KIND_IMAGE_BATCH = job_state.SOURCE_KIND_IMAGE_BATCH
SOURCE_KIND_SUBJECT_PDF = job_state.SOURCE_KIND_SUBJECT_PDF

MODE_MINDMAP = job_state.MODE_MINDMAP
MODE_TEXT = job_state.MODE_TEXT

_RUNNING_JOB_THREADS: dict[str, threading.Thread] = {}
_RUNNING_JOB_LOCK = threading.Lock()
_UNSET = job_state.UNSET


def _serialize_runtime_payload(runtime) -> dict[str, Any]:
    return {
        "model": runtime.model,
        "provider": runtime.provider,
        "base_url": runtime.base_url,
        "thinking_enabled": runtime.thinking_enabled,
        "supports_thinking": runtime.supports_thinking,
        "extra_payload": runtime.extra_payload,
    }


def _dashscope_runtime(source_meta: dict[str, Any] | None = None) -> DashscopeImportRuntime:
    runtime_meta = source_meta.get("ai_runtime") if isinstance(source_meta, dict) else None
    if isinstance(runtime_meta, dict):
        return llm_gateway.build_runtime(
            api_key=str(_resolve_provider_api_key_for_runtime(runtime_meta) or ""),
            base_url=str(runtime_meta.get("base_url") or DASHSCOPE_BASE_URL),
            model=str(runtime_meta.get("model") or DASHSCOPE_VISION_MODEL),
            provider=str(runtime_meta.get("provider") or "dashscope"),
            extra_payload=(
                dict(runtime_meta.get("extra_payload"))
                if isinstance(runtime_meta.get("extra_payload"), dict)
                else None
            ),
        )
    runtime = resolve_scenario_runtime(None, "vision", ai_options=AiRuntimeOptions())
    return llm_gateway.build_runtime(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        provider=runtime.provider,
        extra_payload=runtime.extra_payload,
    )


def _resolve_provider_api_key_for_runtime(runtime_meta: dict[str, Any]) -> str:
    provider = str(runtime_meta.get("provider") or "dashscope").strip().lower()
    if provider == "zhipu":
        return resolve_provider_setting(None, "zhipu", kind="api_key")
    return resolve_provider_setting(None, "dashscope", kind="api_key")


def _prepare_batch_image_items(
    *,
    image_items: list[tuple[bytes, str | None]],
    structure_image_index: int | None,
) -> tuple[list[tuple[bytes, str | None]], int | None]:
    return llm_gateway.prepare_batch_items(
        runtime=_dashscope_runtime(),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )


def _stream_call_dashscope_json(
    *,
    source_meta: dict[str, Any] | None = None,
    image_bytes: bytes,
    filename: str | None,
    channel: str,
    prompt: str = PROMPT,
    disable_rebalance: bool = False,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_json(
            runtime=_dashscope_runtime(source_meta),
            image_bytes=image_bytes,
            filename=filename,
            channel=channel,
            prompt=prompt,
            disable_rebalance=disable_rebalance,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_text(
    *,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    page_numbers: list[int] | None,
    range_prompt: str,
    channel: str,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_text(
            runtime=_dashscope_runtime(source_meta),
            image_items=image_items,
            page_numbers=page_numbers,
            range_prompt=range_prompt,
            channel=channel,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_batch_json(
    *,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    structure_tree: dict[str, Any],
    channel: str,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_batch_json(
            runtime=_dashscope_runtime(source_meta),
            image_items=image_items,
            structure_tree=structure_tree,
            channel=channel,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=disable_rebalance,
            import_options=import_options,
            extracted_text=extracted_text,
            external_log_context=external_log_context,
        )
    )


def _stream_call_dashscope_pdf_json(
    *,
    source_meta: dict[str, Any] | None = None,
    image_items: list[tuple[bytes, str | None]],
    channel: str,
    range_prompt: str = "",
    page_numbers: list[int] | None = None,
    disable_rebalance: bool = False,
    import_options: PdfImportOptions | None = None,
    extracted_text: str | None = None,
    external_log_context: dict[str, Any] | None = None,
):
    return (
        yield from llm_gateway.stream_pdf_json(
            runtime=_dashscope_runtime(source_meta),
            image_items=image_items,
            channel=channel,
            range_prompt=range_prompt,
            page_numbers=page_numbers,
            disable_rebalance=disable_rebalance,
            import_options=import_options,
            extracted_text=extracted_text,
            external_log_context=external_log_context,
        )
    )

def ensure_mindmap_import_job_schema() -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS mindmap_import_jobs (
                id VARCHAR(64) PRIMARY KEY,
                entity_key VARCHAR(200) NOT NULL,
                source_kind VARCHAR(40) NOT NULL,
                mode VARCHAR(20) NOT NULL DEFAULT 'mindmap',
                status VARCHAR(20) NOT NULL DEFAULT 'draft',
                stage VARCHAR(20) NOT NULL DEFAULT 'prepared',
                fingerprint VARCHAR(128) NOT NULL,
                source_meta_json TEXT DEFAULT '{}',
                result_json TEXT DEFAULT '{}',
                error_json TEXT DEFAULT '{}',
                usage_json TEXT DEFAULT '{}',
                progress_json TEXT DEFAULT '{}',
                pause_requested BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME,
                completed_at DATETIME,
                deleted_at DATETIME
            )
            """
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_mindmap_import_jobs_entity_fingerprint "
            "ON mindmap_import_jobs (entity_key, fingerprint)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_mindmap_import_jobs_entity_created "
            "ON mindmap_import_jobs (entity_key, created_at)"
        )
        existing_columns = {
            str(row[1])
            for row in conn.exec_driver_sql("PRAGMA table_info(mindmap_import_jobs)").fetchall()
        }
        if "progress_json" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE mindmap_import_jobs ADD COLUMN progress_json TEXT DEFAULT '{}'"
            )
        if "pause_requested" not in existing_columns:
            conn.exec_driver_sql(
                "ALTER TABLE mindmap_import_jobs ADD COLUMN pause_requested BOOLEAN NOT NULL DEFAULT 0"
            )
        conn.exec_driver_sql(
            "UPDATE mindmap_import_jobs "
            "SET status = 'interrupted', pause_requested = 0, updated_at = CURRENT_TIMESTAMP "
            "WHERE status = 'running' AND deleted_at IS NULL"
        )


def create_image_import_job(
    session: Session,
    *,
    entity_key: str,
    mode: str,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    runtime = resolve_scenario_runtime(session, "vision", ai_options=ai_options)
    return job_creation.create_image_job(
        session,
        entity_key=entity_key,
        mode=mode,
        image_bytes=image_bytes,
        filename=filename,
        fallback_title=fallback_title,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        max_image_bytes=MAX_IMAGE_BYTES,
        import_error_cls=MindMapImportError,
    )


def create_batch_import_job(
    session: Session,
    *,
    entity_key: str,
    image_items: list[tuple[bytes, str | None]],
    fallback_title: str,
    structure_image_index: int | None,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    runtime = resolve_scenario_runtime(session, "vision", ai_options=ai_options)
    normalized_items, resolved_structure_index = llm_gateway.prepare_batch_items(
        runtime=llm_gateway.build_runtime(
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            model=runtime.model,
            provider=runtime.provider,
            extra_payload=runtime.extra_payload,
        ),
        image_items=image_items,
        structure_image_index=structure_image_index,
    )
    return job_creation.create_batch_job(
        session,
        entity_key=entity_key,
        normalized_items=normalized_items,
        resolved_structure_index=resolved_structure_index,
        fallback_title=fallback_title,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
    )


def create_pdf_import_job(
    session: Session,
    *,
    entity_key: str,
    document: SubjectDocument,
    mode: str,
    page_selection: list[int],
    structure_page: int | None,
    pdf_mode: str = PDF_IMPORT_MODE_DIRECT_GENERATION,
    range_prompt: str,
    fallback_title: str,
    import_options: PdfImportOptions | None,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    runtime = resolve_scenario_runtime(session, "vision", ai_options=ai_options)
    normalized_pages = _normalize_page_selection(page_selection, document.page_count)
    resolved_pdf_mode = _normalize_pdf_import_mode(pdf_mode)
    resolved_structure_page = (
        _resolve_pdf_structure_page(normalized_pages, structure_page)
        if resolved_pdf_mode == PDF_IMPORT_MODE_STRUCTURED_MERGE
        else None
    )
    resolved_options = import_options or PdfImportOptions()
    return job_creation.create_pdf_job(
        session,
        entity_key=entity_key,
        document=document,
        mode=mode,
        normalized_pages=normalized_pages,
        resolved_pdf_mode=resolved_pdf_mode,
        resolved_structure_page=resolved_structure_page,
        range_prompt=range_prompt,
        fallback_title=fallback_title,
        resolved_options=resolved_options,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
    )


def get_job(session: Session, job_id: str) -> MindMapImportJob | None:
    return job_repository.get_job(session, job_id)


def list_jobs(session: Session, *, entity_key: str) -> list[MindMapImportJob]:
    return job_repository.list_jobs(session, entity_key=entity_key)


def delete_job(session: Session, *, job_id: str) -> MindMapImportJob | None:
    return job_repository.delete_job(session, job_id=job_id)


def request_pause_job(session: Session, *, job_id: str) -> MindMapImportJob:
    return job_repository.request_pause_job(
        session,
        job_id=job_id,
        import_error_cls=MindMapImportError,
    )


def _job_lifecycle_dependencies() -> job_lifecycle.JobLifecycleDependencies:
    return job_lifecycle.JobLifecycleDependencies(
        session_factory=lambda: Session(engine),
        get_job_fn=get_job,
        load_source_meta_fn=lambda job: _json_load(job.source_meta_json, {}),
        get_job_artifact_dir_fn=get_job_artifact_dir,
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


def wait_for_job_completion(
    session_factory: Any,
    *,
    job_id: str,
    timeout_seconds: float = 120.0,
    poll_interval_seconds: float = 0.2,
) -> MindMapImportJob:
    return job_repository.wait_for_job_completion(
        session_factory,
        job_id=job_id,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        import_error_cls=MindMapImportError,
    )


def serialize_job(job: MindMapImportJob) -> dict[str, Any]:
    return job_repository.serialize_job(job)


def complete_job_from_preview(
    session: Session,
    *,
    job_id: str,
    result: dict[str, Any],
    usage: dict[str, Any] | None,
) -> MindMapImportJob:
    return job_repository.complete_job_from_preview(
        session,
        job_id=job_id,
        result=result,
        usage=usage,
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
    )


def get_job_artifact_dir(job_id: str) -> Path:
    return job_artifacts.get_job_artifact_dir(IMPORT_JOBS_DIR, job_id)


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
