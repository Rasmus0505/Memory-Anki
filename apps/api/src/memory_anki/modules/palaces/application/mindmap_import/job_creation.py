from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import MindMapImportJob

from . import job_artifacts, job_creation_support, job_repository, job_state


def create_image_job(
    session: Session,
    *,
    entity_key: str,
    mode: str,
    image_bytes: bytes,
    filename: str | None,
    fallback_title: str,
    ai_runtime: dict[str, object] | None,
    import_jobs_dir: Path,
    max_image_bytes: int,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    job_creation_support.validate_entity_key(entity_key, import_error_cls=import_error_cls)
    job_creation_support.validate_mode(mode, import_error_cls=import_error_cls)
    job_creation_support.ensure_image_bytes(
        image_bytes,
        max_image_bytes=max_image_bytes,
        import_error_cls=import_error_cls,
    )

    source_meta = {
        "fallback_title": str(fallback_title or "未命名宫殿"),
        "filename": filename or "image.png",
        "image_sha256": job_creation_support.hash_bytes(image_bytes),
        "ai_runtime": dict(ai_runtime or {}),
    }
    job, created = _create_draft_job_record(
        session,
        entity_key=entity_key,
        source_kind=job_state.SOURCE_KIND_IMAGE_SINGLE,
        mode=mode,
        source_meta=source_meta,
    )
    if not created:
        return job

    artifact_dir = job_artifacts.get_job_artifact_dir(import_jobs_dir, job.id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(filename or "").suffix or job_creation_support.guess_extension_from_filename(filename)
    job_artifacts.write_bytes(artifact_dir / f"input{extension}", image_bytes)
    job_artifacts.write_json(artifact_dir / "source_meta.json", source_meta)
    return _touch_created_job(session, job.id, import_error_cls=import_error_cls)


def create_batch_job(
    session: Session,
    *,
    entity_key: str,
    normalized_items: list[tuple[bytes, str | None]],
    resolved_structure_index: int | None,
    fallback_title: str,
    ai_runtime: dict[str, object] | None,
    import_jobs_dir: Path,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    job_creation_support.validate_entity_key(entity_key, import_error_cls=import_error_cls)
    source_meta = {
        "fallback_title": str(fallback_title or "未命名宫殿"),
        "structure_image_index": resolved_structure_index,
        "ai_runtime": dict(ai_runtime or {}),
        "images": [
            {
                "filename": filename or f"image-{index + 1}.png",
                "image_sha256": job_creation_support.hash_bytes(image_bytes),
            }
            for index, (image_bytes, filename) in enumerate(normalized_items)
        ],
    }
    job, created = _create_draft_job_record(
        session,
        entity_key=entity_key,
        source_kind=job_state.SOURCE_KIND_IMAGE_BATCH,
        mode=job_state.MODE_MINDMAP,
        source_meta=source_meta,
    )
    if not created:
        return job

    artifact_dir = job_artifacts.get_job_artifact_dir(import_jobs_dir, job.id)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    for index, (image_bytes, filename) in enumerate(normalized_items):
        extension = Path(filename or "").suffix or job_creation_support.guess_extension_from_filename(filename)
        job_artifacts.write_bytes(artifact_dir / f"input-{index}{extension}", image_bytes)
    job_artifacts.write_json(artifact_dir / "source_meta.json", source_meta)
    return _touch_created_job(session, job.id, import_error_cls=import_error_cls)


def _create_draft_job_record(
    session: Session,
    *,
    entity_key: str,
    source_kind: str,
    mode: str,
    source_meta: dict[str, object],
) -> tuple[MindMapImportJob, bool]:
    fingerprint = job_creation_support.build_fingerprint(
        entity_key=entity_key,
        source_kind=source_kind,
        mode=mode,
        source_meta=source_meta,
    )
    existing = job_repository.find_existing_job(
        session,
        entity_key=entity_key,
        fingerprint=fingerprint,
    )
    if existing:
        return existing, False

    job = MindMapImportJob(
        id=uuid.uuid4().hex,
        entity_key=entity_key,
        source_kind=source_kind,
        mode=mode,
        status=job_state.JOB_STATUS_DRAFT,
        stage=job_state.JOB_STAGE_PREPARED,
        fingerprint=fingerprint,
        source_meta_json=job_artifacts.json_dump(source_meta),
        result_json="{}",
        error_json="{}",
        usage_json=job_artifacts.json_dump(job_state.empty_usage()),
        progress_json=job_artifacts.json_dump(job_state.empty_progress()),
        pause_requested=False,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job, True


def _touch_created_job(
    session: Session,
    job_id: str,
    *,
    import_error_cls: type[Exception],
) -> MindMapImportJob:
    return job_repository.touch_job(session, job_id, import_error_cls=import_error_cls)
