from __future__ import annotations

from memory_anki.core.config import IMPORT_JOBS_DIR as DEFAULT_IMPORT_JOBS_DIR

from .mindmap_import import (
    MindMapImportError,
    job_creation,
    job_state,
)
from . import mindmap_import_job_api as _job_api
from . import mindmap_import_job_execution as _job_execution
from . import mindmap_import_job_runtime as _job_runtime
from .mindmap_import_job_api import (
    serialize_job as serialize_job,
)
from .mindmap_import_job_execution import (
    _RUNNING_JOB_LOCK as _RUNNING_JOB_LOCK,
    _RUNNING_JOB_THREADS as _RUNNING_JOB_THREADS,
    _UNSET as _UNSET,
    _build_structured_error as _build_structured_error,
    _find_first_input_file as _find_first_input_file,
    _job_lifecycle_dependencies as _job_lifecycle_dependencies,
    _json_load as _json_load,
    _load_batch_image_items as _load_batch_image_items,
    _mark_job_completed as _mark_job_completed,
    _mark_job_failed as _mark_job_failed,
    _pause_if_requested as _pause_if_requested,
    _run_image_batch_job as _run_image_batch_job,
    _run_image_single_job as _run_image_single_job,
    _run_job_worker as _run_job_worker,
    _set_job_progress as _set_job_progress,
    _set_job_result as _set_job_result,
    _set_job_stage as _set_job_stage,
    _sync_job_progress_artifact as _sync_job_progress_artifact,
    _update_job_usage as _update_job_usage,
    run_job_async as run_job_async,
)
from .mindmap_import_job_runtime import (
    MODE_MINDMAP as MODE_MINDMAP,
    MODE_TEXT as MODE_TEXT,
    SOURCE_KIND_IMAGE_BATCH as SOURCE_KIND_IMAGE_BATCH,
    _dashscope_runtime as _dashscope_runtime,
    _prepare_batch_image_items as _prepare_batch_image_items,
    _resolve_provider_api_key_for_runtime as _resolve_provider_api_key_for_runtime,
    _serialize_runtime_payload as _serialize_runtime_payload,
    _stream_call_dashscope_batch_json as _stream_call_dashscope_batch_json,
    _stream_call_dashscope_json as _stream_call_dashscope_json,
    _stream_call_dashscope_text as _stream_call_dashscope_text,
)
from memory_anki.modules.settings.application.ai_model_registry import resolve_scenario_runtime

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
    _job_execution._stream_call_dashscope_json = _stream_call_dashscope_json
    _job_execution._stream_call_dashscope_text = _stream_call_dashscope_text
    _job_execution._stream_call_dashscope_batch_json = _stream_call_dashscope_batch_json
    _job_runtime._prepare_batch_image_items = _prepare_batch_image_items


def create_image_import_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.create_image_import_job(*args, **kwargs)


def create_batch_import_job(*args, **kwargs):
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
    runtime = resolve_scenario_runtime(session, "vision_batch_mindmap", ai_options=ai_options)
    normalized_items, resolved_structure_index = _prepare_batch_image_items(
        image_items=kwargs["image_items"],
        structure_image_index=kwargs["structure_image_index"],
    )
    return job_creation.create_batch_job(
        session,
        entity_key=kwargs["entity_key"],
        normalized_items=normalized_items,
        resolved_structure_index=resolved_structure_index,
        fallback_title=kwargs["fallback_title"],
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
    )


def get_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.get_job(*args, **kwargs)


def list_jobs(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.list_jobs(*args, **kwargs)


def delete_job(*args, **kwargs):
    _sync_facade_dependencies()
    return _job_api.delete_job(*args, **kwargs)


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
    "_resolve_provider_api_key_for_runtime",
    "_run_image_batch_job",
    "_run_image_single_job",
    "_run_job_worker",
    "_serialize_runtime_payload",
    "_set_job_progress",
    "_set_job_result",
    "_set_job_stage",
    "_stream_call_dashscope_batch_json",
    "_stream_call_dashscope_json",
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
    "run_job_async",
    "serialize_job",
    "wait_for_job_completion",
]
