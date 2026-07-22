from __future__ import annotations

from memory_anki.core.config import IMPORT_JOBS_DIR as DEFAULT_IMPORT_JOBS_DIR
from memory_anki.platform.application import AiRuntimeProvider

from . import mindmap_import_job_api as _job_api
from . import mindmap_import_job_execution as _job_execution
from . import mindmap_import_job_runtime as _job_runtime
from .mindmap_import import (
    MindMapImportError,
    job_creation,
    job_state,
)
from .mindmap_import_job_api import (
    serialize_job as serialize_job,
)
from .mindmap_import_job_execution import (
    _RUNNING_JOB_LOCK as _RUNNING_JOB_LOCK,
)
from .mindmap_import_job_execution import (
    _RUNNING_JOB_THREADS as _RUNNING_JOB_THREADS,
)
from .mindmap_import_job_execution import (
    _UNSET as _UNSET,
)
from .mindmap_import_job_execution import (
    _build_structured_error as _build_structured_error,
)
from .mindmap_import_job_execution import (
    _find_first_input_file as _find_first_input_file,
)
from .mindmap_import_job_execution import (
    _job_lifecycle_dependencies as _job_lifecycle_dependencies,
)
from .mindmap_import_job_execution import (
    _json_load as _json_load,
)
from .mindmap_import_job_execution import (
    _load_batch_image_items as _load_batch_image_items,
)
from .mindmap_import_job_execution import (
    _mark_job_completed as _mark_job_completed,
)
from .mindmap_import_job_execution import (
    _mark_job_failed as _mark_job_failed,
)
from .mindmap_import_job_execution import (
    _pause_if_requested as _pause_if_requested,
)
from .mindmap_import_job_execution import (
    _run_image_batch_job as _run_image_batch_job,
)
from .mindmap_import_job_execution import (
    _run_image_single_job as _run_image_single_job,
)
from .mindmap_import_job_execution import (
    _set_job_progress as _set_job_progress,
)
from .mindmap_import_job_execution import (
    _set_job_result as _set_job_result,
)
from .mindmap_import_job_execution import (
    _set_job_stage as _set_job_stage,
)
from .mindmap_import_job_execution import (
    _sync_job_progress_artifact as _sync_job_progress_artifact,
)
from .mindmap_import_job_execution import (
    _update_job_usage as _update_job_usage,
)
from .mindmap_import_job_runtime import (
    MODE_MINDMAP as MODE_MINDMAP,
)
from .mindmap_import_job_runtime import (
    MODE_TEXT as MODE_TEXT,
)
from .mindmap_import_job_runtime import (
    SOURCE_KIND_IMAGE_BATCH as SOURCE_KIND_IMAGE_BATCH,
)
from .mindmap_import_job_runtime import (
    _dashscope_runtime as _dashscope_runtime,
)
from .mindmap_import_job_runtime import (
    _prepare_batch_image_items as _prepare_batch_image_items,
)
from .mindmap_import_job_runtime import (
    _serialize_runtime_payload as _serialize_runtime_payload,
)
from .mindmap_import_job_runtime import (
    _stream_call_dashscope_text as _stream_call_dashscope_text,
)
from .mindmap_import_job_runtime import (
    _stream_call_formatter_json as _stream_call_formatter_json,
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
IMPORT_JOBS_DIR = DEFAULT_IMPORT_JOBS_DIR


def _sync_facade_dependencies() -> None:
    _job_api.IMPORT_JOBS_DIR = IMPORT_JOBS_DIR
    _job_execution.IMPORT_JOBS_DIR = IMPORT_JOBS_DIR
    _job_execution._stream_call_dashscope_text = _stream_call_dashscope_text
    _job_execution._stream_call_formatter_json = _stream_call_formatter_json
    _job_runtime._prepare_batch_image_items = _prepare_batch_image_items


def create_image_import_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.create_image_import_job(*args, **kwargs)


def create_batch_import_job(*args, **kwargs):
    """Facade keeps prepare_batch mockable for tests."""
    _sync_facade_dependencies()
    if args:
        session = args[0]
        remaining_args = args[1:]
    else:
        session = kwargs.pop("session")
        remaining_args = ()
    if remaining_args:
        raise TypeError("create_batch_import_job accepts only session as a positional argument")
    ai_options = kwargs.pop("ai_options", None)
    vision_ai_options = kwargs.pop("vision_ai_options", None)
    formatter_ai_options = kwargs.pop("formatter_ai_options", None)
    # Ignore legacy structure_image_index if callers still pass it.
    kwargs.pop("structure_image_index", None)
    ai_runtime: AiRuntimeProvider = kwargs.pop("ai_runtime")
    mode = kwargs.get("mode", MODE_MINDMAP)
    source_kind = kwargs.pop("source_kind", job_state.SOURCE_KIND_IMAGE_BATCH)
    scenario_key = "vision_batch_mindmap" if mode == MODE_MINDMAP else "vision_image_text"
    runtime = ai_runtime.resolve(scenario_key, options=vision_ai_options or ai_options)
    formatter_runtime = (
        ai_runtime.resolve("mindmap_ocr_formatter", options=formatter_ai_options)
        if mode == MODE_MINDMAP
        else None
    )
    normalized_items = _prepare_batch_image_items(
        ai_runtime=ai_runtime,
        image_items=kwargs["image_items"],
    )
    return job_creation.create_batch_job(
        session,
        entity_key=kwargs["entity_key"],
        normalized_items=normalized_items,
        fallback_title=kwargs["fallback_title"],
        mode=mode,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
        source_kind=source_kind,
        source_meta_extra={
            "vision_ai_runtime": _serialize_runtime_payload(runtime),
            "formatter_ai_runtime": (
                _serialize_runtime_payload(formatter_runtime) if formatter_runtime else {}
            ),
        },
    )


def create_pdf_import_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.create_pdf_import_job(*args, **kwargs)


def _is_job_thread_alive(job_id: str) -> bool:
    with _RUNNING_JOB_LOCK:
        thread = _RUNNING_JOB_THREADS.get(job_id)
    return bool(thread and thread.is_alive())


def reconcile_stale_running_jobs(session, *, entity_key: str | None = None) -> int:
    from .mindmap_import.job_repository import reconcile_stale_running_jobs as _reconcile

    return _reconcile(
        session,
        is_thread_alive_fn=_is_job_thread_alive,
        entity_key=entity_key,
    )


def get_job(*args, **kwargs):
    _sync_facade_dependencies()
    session = args[0] if args else kwargs.get("session")
    if session is not None:
        reconcile_stale_running_jobs(session)
    return _job_api.get_job(*args, **kwargs)


def list_jobs(*args, **kwargs):
    _sync_facade_dependencies()
    session = args[0] if args else kwargs.get("session")
    if session is not None:
        reconcile_stale_running_jobs(session, entity_key=kwargs.get("entity_key"))
    return _job_api.list_jobs(*args, **kwargs)


def delete_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.delete_job(*args, **kwargs)


def rerun_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.rerun_job(*args, **kwargs)


def request_pause_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.request_pause_job(*args, **kwargs)


def wait_for_job_completion(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.wait_for_job_completion(*args, **kwargs)


def complete_job_from_preview(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.complete_job_from_preview(*args, **kwargs)


def get_job_artifact_dir(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.get_job_artifact_dir(*args, **kwargs)


def run_job_async(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_execution.run_job_async(*args, **kwargs)


def _run_job_worker(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_execution._run_job_worker(*args, **kwargs)

__all__ = [
    "JOB_STAGE_COMPLETED",
    "JOB_STAGE_MERGE",
    "JOB_STAGE_OCR",
    "JOB_STAGE_PREPARED",
    "JOB_STAGE_STRUCTURE",
    "JOB_STAGE_TEXT",
    "JOB_STATUS_COMPLETED",
    "JOB_STATUS_DRAFT",
    "JOB_STATUS_FAILED",
    "JOB_STATUS_INTERRUPTED",
    "JOB_STATUS_PAUSED",
    "JOB_STATUS_RUNNING",
    "MODE_MINDMAP",
    "MODE_TEXT",
    "SOURCE_KIND_IMAGE_BATCH",
    "SOURCE_KIND_IMAGE_SINGLE",
    "_RUNNING_JOB_LOCK",
    "_RUNNING_JOB_THREADS",
    "_UNSET",
    "_build_structured_error",
    "_dashscope_runtime",
    "_find_first_input_file",
    "_job_lifecycle_dependencies",
    "_json_load",
    "_load_batch_image_items",
    "_mark_job_completed",
    "_mark_job_failed",
    "_pause_if_requested",
    "_prepare_batch_image_items",
    "_run_image_batch_job",
    "_run_image_single_job",
    "_run_job_worker",
    "_serialize_runtime_payload",
    "_set_job_progress",
    "_set_job_result",
    "_set_job_stage",
    "_stream_call_dashscope_text",
    "_sync_job_progress_artifact",
    "_update_job_usage",
    "complete_job_from_preview",
    "create_batch_import_job",
    "create_image_import_job",
    "delete_job",
    "get_job",
    "get_job_artifact_dir",
    "list_jobs",
    "request_pause_job",
    "reconcile_stale_running_jobs",
    "run_job_async",
    "serialize_job",
    "wait_for_job_completion",
]
