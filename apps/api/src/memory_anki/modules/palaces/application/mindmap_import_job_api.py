from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import IMPORT_JOBS_DIR
from memory_anki.infrastructure.db._tables.misc import MindMapImportJob
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_scenario_runtime,
)

from .mindmap_import import (
    MAX_IMAGE_BYTES,
    MindMapImportError,
    job_artifacts,
    job_creation,
    job_repository,
    llm_gateway,
)
from .mindmap_import_job_runtime import MODE_MINDMAP, _serialize_runtime_payload


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
    runtime = resolve_scenario_runtime(
        session,
        "vision_image_mindmap" if mode == MODE_MINDMAP else "vision_image_text",
        ai_options=ai_options,
    )
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
    runtime = resolve_scenario_runtime(session, "vision_batch_mindmap", ai_options=ai_options)
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


__all__ = [
    "complete_job_from_preview",
    "create_batch_import_job",
    "create_image_import_job",
    "delete_job",
    "get_job",
    "get_job_artifact_dir",
    "list_jobs",
    "request_pause_job",
    "serialize_job",
    "wait_for_job_completion",
]
