from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

import fitz
from sqlalchemy.orm import Session

from memory_anki.core.config import IMPORT_JOBS_DIR
from memory_anki.infrastructure.db._tables.misc import MindMapImportJob
from memory_anki.modules.pdf_library.api import (
    PDF_LIBRARY_DIR,
    get_pdf_document,
    resolve_pdf_path,
)
from memory_anki.platform.application import AiRuntimeOptions, AiRuntimeProvider

from .mindmap_import import (
    MAX_IMAGE_BYTES,
    MindMapImportError,
    job_artifacts,
    job_creation,
    job_repository,
    job_state,
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
    ai_runtime: AiRuntimeProvider,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    runtime = ai_runtime.resolve(
        "vision_image_mindmap" if mode == MODE_MINDMAP else "vision_image_text",
        options=ai_options,
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
    mode: str = MODE_MINDMAP,
    ai_runtime: AiRuntimeProvider,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    runtime = ai_runtime.resolve(
        "vision_batch_mindmap" if mode == MODE_MINDMAP else "vision_image_text",
        options=ai_options,
    )
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
        mode=mode,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
    )


def parse_pdf_page_selection(value: str, page_count: int) -> list[int]:
    pages: list[int] = []
    for raw_part in value.replace("，", ",").split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            try:
                start, end = int(start_text), int(end_text)
            except ValueError as exc:
                raise MindMapImportError("页码范围格式不正确。") from exc
            if start > end:
                raise MindMapImportError("页码范围起始页不能大于结束页。")
            pages.extend(range(start, end + 1))
        else:
            try:
                pages.append(int(part))
            except ValueError as exc:
                raise MindMapImportError("页码范围格式不正确。") from exc
    normalized = list(dict.fromkeys(pages))
    if not normalized:
        raise MindMapImportError("请至少选择一页 PDF。")
    if min(normalized) < 1 or max(normalized) > page_count:
        raise MindMapImportError(f"页码必须位于 1-{page_count} 页之间。")
    return normalized


def create_pdf_import_job(
    session: Session,
    *,
    entity_key: str,
    document_id: str,
    page_selection: str,
    mode: str,
    fallback_title: str,
    ai_runtime: AiRuntimeProvider,
    ai_options: AiRuntimeOptions | None = None,
) -> MindMapImportJob:
    document = get_pdf_document(session, document_id)
    if document is None:
        raise MindMapImportError("PDF 资料不存在。")
    source_path = resolve_pdf_path(document, PDF_LIBRARY_DIR)
    if not source_path.exists():
        raise MindMapImportError("PDF 文件缺失，请重新上传。")
    pages = parse_pdf_page_selection(page_selection, document.page_count)
    rendered_items: list[tuple[bytes, str | None]] = []
    with fitz.open(source_path) as pdf:
        for page_number in pages:
            pixmap = pdf.load_page(page_number - 1).get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            rendered_items.append((pixmap.tobytes("png"), f"page-{page_number}.png"))

    runtime = ai_runtime.resolve(
        "vision_batch_mindmap" if mode == MODE_MINDMAP else "vision_image_text",
        options=ai_options,
    )
    normalized_items, _ = llm_gateway.prepare_batch_items(
        runtime=llm_gateway.build_runtime(
            api_key=runtime.api_key,
            base_url=runtime.base_url,
            model=runtime.model,
            provider=runtime.provider,
            extra_payload=runtime.extra_payload,
        ),
        image_items=rendered_items,
        structure_image_index=None,
    )
    job = job_creation.create_batch_job(
        session,
        entity_key=entity_key,
        normalized_items=normalized_items,
        resolved_structure_index=None,
        fallback_title=fallback_title or document.original_name,
        mode=mode,
        ai_runtime=_serialize_runtime_payload(runtime),
        import_jobs_dir=IMPORT_JOBS_DIR,
        import_error_cls=MindMapImportError,
        source_kind=job_state.SOURCE_KIND_PDF_DOCUMENT,
        source_meta_extra={
            "source_kind": job_state.SOURCE_KIND_PDF_DOCUMENT,
            "pdf_document_id": document.id,
            "document_original_name": document.original_name,
            "page_selection": pages,
        },
    )
    artifact_dir = job_artifacts.get_job_artifact_dir(IMPORT_JOBS_DIR, job.id)
    pdf_snapshot = artifact_dir / "source.pdf"
    if not pdf_snapshot.exists():
        pdf_snapshot.write_bytes(source_path.read_bytes())
    return job


def get_job(session: Session, job_id: str) -> MindMapImportJob | None:
    return job_repository.get_job(session, job_id)


def list_jobs(session: Session, *, entity_key: str) -> list[MindMapImportJob]:
    return job_repository.list_jobs(session, entity_key=entity_key)


def delete_job(session: Session, *, job_id: str) -> MindMapImportJob | None:
    return job_repository.delete_job(session, job_id=job_id)


def rerun_job(session: Session, *, job_id: str) -> MindMapImportJob:
    source = job_repository.get_job(session, job_id)
    if source is None:
        raise MindMapImportError("导入任务不存在。")
    source_meta = job_artifacts.json_load(source.source_meta_json, {})
    operation_id = uuid.uuid4().hex
    source_meta["owner_id"] = source.entity_key
    source_meta["operation_id"] = operation_id
    source_meta["rerun_of"] = source.id
    job = MindMapImportJob(
        id=operation_id,
        entity_key=source.entity_key,
        source_kind=source.source_kind,
        mode=source.mode,
        status=job_state.JOB_STATUS_DRAFT,
        stage=job_state.JOB_STAGE_PREPARED,
        fingerprint=f"rerun:{source.fingerprint}:{operation_id}",
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
    source_dir = job_artifacts.get_job_artifact_dir(IMPORT_JOBS_DIR, source.id)
    target_dir = job_artifacts.get_job_artifact_dir(IMPORT_JOBS_DIR, job.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    for path in source_dir.iterdir() if source_dir.exists() else []:
        if path.is_file() and (path.name.startswith("input") or path.name in {"source.pdf", "source_meta.json"}):
            shutil.copy2(path, target_dir / path.name)
    job_artifacts.write_json(target_dir / "source_meta.json", source_meta)
    return job


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
    "create_pdf_import_job",
    "delete_job",
    "get_job",
    "get_job_artifact_dir",
    "list_jobs",
    "request_pause_job",
    "rerun_job",
    "serialize_job",
    "wait_for_job_completion",
]
