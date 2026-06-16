from __future__ import annotations

from .mindmap_import import job_state
from .mindmap_import_job_api import (
    complete_job_from_preview as complete_job_from_preview,
    create_batch_import_job as create_batch_import_job,
    create_image_import_job as create_image_import_job,
    create_pdf_import_job as create_pdf_import_job,
    delete_job as delete_job,
    get_job as get_job,
    get_job_artifact_dir as get_job_artifact_dir,
    list_jobs as list_jobs,
    request_pause_job as request_pause_job,
    serialize_job as serialize_job,
    wait_for_job_completion as wait_for_job_completion,
)
from .mindmap_import_job_execution import (
    _RUNNING_JOB_LOCK as _RUNNING_JOB_LOCK,
    _RUNNING_JOB_THREADS as _RUNNING_JOB_THREADS,
    _UNSET as _UNSET,
    _build_structured_error as _build_structured_error,
    _ensure_rendered_pdf_pages as _ensure_rendered_pdf_pages,
    _find_first_input_file as _find_first_input_file,
    _job_lifecycle_dependencies as _job_lifecycle_dependencies,
    _json_load as _json_load,
    _load_batch_image_items as _load_batch_image_items,
    _load_rendered_pdf_pages as _load_rendered_pdf_pages,
    _mark_job_completed as _mark_job_completed,
    _mark_job_failed as _mark_job_failed,
    _pause_if_requested as _pause_if_requested,
    _run_image_batch_job as _run_image_batch_job,
    _run_image_single_job as _run_image_single_job,
    _run_job_worker as _run_job_worker,
    _run_subject_pdf_job as _run_subject_pdf_job,
    _set_job_progress as _set_job_progress,
    _set_job_result as _set_job_result,
    _set_job_stage as _set_job_stage,
    _source_meta_to_pdf_options as _source_meta_to_pdf_options,
    _sync_job_progress_artifact as _sync_job_progress_artifact,
    _update_job_usage as _update_job_usage,
    run_job_async as run_job_async,
)
from .mindmap_import_job_runtime import (
    MODE_MINDMAP as MODE_MINDMAP,
    MODE_TEXT as MODE_TEXT,
    SOURCE_KIND_IMAGE_BATCH as SOURCE_KIND_IMAGE_BATCH,
    SOURCE_KIND_SUBJECT_PDF as SOURCE_KIND_SUBJECT_PDF,
    _dashscope_runtime as _dashscope_runtime,
    _prepare_batch_image_items as _prepare_batch_image_items,
    _resolve_provider_api_key_for_runtime as _resolve_provider_api_key_for_runtime,
    _serialize_runtime_payload as _serialize_runtime_payload,
    _stream_call_dashscope_batch_json as _stream_call_dashscope_batch_json,
    _stream_call_dashscope_json as _stream_call_dashscope_json,
    _stream_call_dashscope_pdf_json as _stream_call_dashscope_pdf_json,
    _stream_call_dashscope_text as _stream_call_dashscope_text,
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
    "SOURCE_KIND_SUBJECT_PDF",
    "_RUNNING_JOB_LOCK",
    "_RUNNING_JOB_THREADS",
    "_UNSET",
    "_build_structured_error",
    "_dashscope_runtime",
    "_ensure_rendered_pdf_pages",
    "_find_first_input_file",
    "_job_lifecycle_dependencies",
    "_json_load",
    "_load_batch_image_items",
    "_load_rendered_pdf_pages",
    "_mark_job_completed",
    "_mark_job_failed",
    "_pause_if_requested",
    "_prepare_batch_image_items",
    "_resolve_provider_api_key_for_runtime",
    "_run_image_batch_job",
    "_run_image_single_job",
    "_run_job_worker",
    "_run_subject_pdf_job",
    "_serialize_runtime_payload",
    "_set_job_progress",
    "_set_job_result",
    "_set_job_stage",
    "_source_meta_to_pdf_options",
    "_stream_call_dashscope_batch_json",
    "_stream_call_dashscope_json",
    "_stream_call_dashscope_pdf_json",
    "_stream_call_dashscope_text",
    "_sync_job_progress_artifact",
    "_update_job_usage",
    "complete_job_from_preview",
    "create_batch_import_job",
    "create_image_import_job",
    "create_pdf_import_job",
    "delete_job",
    "get_job",
    "get_job_artifact_dir",
    "list_jobs",
    "request_pause_job",
    "run_job_async",
    "serialize_job",
    "wait_for_job_completion",
]
