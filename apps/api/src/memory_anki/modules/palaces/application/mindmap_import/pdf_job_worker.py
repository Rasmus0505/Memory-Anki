from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import MindMapImportJob
from memory_anki.modules.settings.application.ai_prompts import (
    build_import_pdf_structure_prompt,
)

from . import (
    PDF_DIRECT_OCR_FALLBACK_WARNING,
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    PDF_OCR_FALLBACK_WARNING,
    SINGLE_PAGE_PDF_WARNING,
    MindMapImportError,
    pdf_model_workflows,
    step_protocol,
)
from .job_artifacts import ensure_rendered_pdf_pages, read_json, read_text, write_json, write_text
from .job_progress import consume_stream_result, set_progress_step
from .job_repository import pause_if_requested, set_job_result, set_job_stage, update_job_usage
from .job_state import (
    JOB_STAGE_COMPLETED,
    JOB_STAGE_MERGE,
    JOB_STAGE_OCR,
    JOB_STAGE_STRUCTURE,
    JOB_STAGE_TEXT,
    MODE_TEXT,
)
from .workflow import (
    build_pdf_import_result_payload,
    build_text_result_payload,
    normalize_pdf_import_mode,
    order_pdf_image_items,
    prepare_pdf_ocr_grounding,
    resolve_pdf_structure_page,
    split_rendered_pdf_pages,
)


def _build_pdf_artifact_refs(
    artifact_dir: Path,
    rendered_pages: list[tuple[int, bytes, str]],
    *,
    labels: dict[int, str] | None = None,
) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for page_number, _, filename in rendered_pages:
        refs.append(
            {
                "name": filename,
                "label": labels.get(page_number, f"PDF 第 {page_number} 页") if labels else f"PDF 第 {page_number} 页",
                "mime_type": mimetypes.guess_type(filename)[0] or "image/png",
                "source_kind": "import_job",
                "source_path": str(artifact_dir / filename),
            }
        )
    return refs


@dataclass(frozen=True)
class PdfJobDependencies:
    import_jobs_dir: Path
    pdf_options_cls: Any
    get_subject_document_by_id_fn: Any
    render_selected_pdf_pages_fn: Any
    ensure_rendered_page_size_fn: Any
    stream_call_dashscope_json: Any
    stream_call_dashscope_text: Any
    stream_call_dashscope_batch_json: Any
    stream_call_dashscope_pdf_json: Any
    source_meta_to_pdf_options_fn: Any


def run_subject_pdf_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    *,
    deps: PdfJobDependencies,
) -> None:
    page_selection = [int(page) for page in source_meta.get("page_selection") or []]
    pdf_mode = normalize_pdf_import_mode(source_meta.get("pdf_mode"))
    range_prompt = str(source_meta.get("range_prompt") or "")
    fallback_title = str(source_meta.get("fallback_title") or "未命名宫殿")
    import_options = deps.source_meta_to_pdf_options_fn(source_meta, deps.pdf_options_cls)
    total_steps = (
        step_protocol.PDF_TEXT_TOTAL_STEPS
        if job.mode == MODE_TEXT
        else step_protocol.PDF_IMPORT_TOTAL_STEPS
    )

    set_progress_step(
        session,
        job_id=job.id,
        import_jobs_dir=deps.import_jobs_dir,
        step=step_protocol.render_pdf_pages_step(total_steps=total_steps),
    )
    rendered_pages = ensure_rendered_pdf_pages(
        session,
        artifact_dir=artifact_dir,
        source_meta=source_meta,
        get_subject_document_by_id_fn=deps.get_subject_document_by_id_fn,
        render_selected_pdf_pages_fn=deps.render_selected_pdf_pages_fn,
        ensure_rendered_page_size_fn=deps.ensure_rendered_page_size_fn,
        import_error_cls=MindMapImportError,
    )
    artifact_refs = _build_pdf_artifact_refs(artifact_dir, rendered_pages)
    if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
        return

    if job.mode == MODE_TEXT:
        _run_pdf_text_job(
            session,
            job=job,
            artifact_dir=artifact_dir,
            page_selection=page_selection,
            range_prompt=range_prompt,
            rendered_pages=rendered_pages,
            artifact_refs=artifact_refs,
            deps=deps,
        )
        return

    if pdf_mode == PDF_IMPORT_MODE_DIRECT_GENERATION:
        _run_pdf_direct_generation_job(
            session,
            job=job,
            artifact_dir=artifact_dir,
            page_selection=page_selection,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            rendered_pages=rendered_pages,
            artifact_refs=artifact_refs,
            deps=deps,
        )
        return

    _run_pdf_structured_merge_job(
        session,
        job=job,
        source_meta=source_meta,
        artifact_dir=artifact_dir,
        page_selection=page_selection,
        range_prompt=range_prompt,
        fallback_title=fallback_title,
        import_options=import_options,
        rendered_pages=rendered_pages,
        deps=deps,
    )


def _run_pdf_text_job(
    session: Session,
    *,
    job: MindMapImportJob,
    artifact_dir: Path,
    page_selection: list[int],
    range_prompt: str,
    rendered_pages: list[tuple[int, bytes, str]],
    artifact_refs: list[dict[str, Any]],
    deps: PdfJobDependencies,
) -> None:
    text_path = artifact_dir / "extracted_text.txt"
    if not text_path.exists():
        set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=deps.import_jobs_dir,
            step=step_protocol.extract_pdf_text_step(
                total_steps=step_protocol.PDF_TEXT_TOTAL_STEPS
            ),
            preview_text="",
        )
        extracted_text = consume_stream_result(
            session,
            job_id=job.id,
            artifact_dir=artifact_dir,
            generator=pdf_model_workflows.stream_pdf_text_extraction(
                rendered_pages=rendered_pages,
                page_numbers=page_selection,
                range_prompt=range_prompt,
                total_steps=step_protocol.PDF_TEXT_TOTAL_STEPS,
                stream_call_dashscope_text_fn=deps.stream_call_dashscope_text,
                external_log_context={
                    "feature": "学科 PDF 转文字",
                    "operation": "pdf_text_extraction",
                    "job_id": job.id,
                    "artifact_refs": artifact_refs,
                },
            ),
            allow_preview_text=True,
            import_jobs_dir=deps.import_jobs_dir,
        )
        write_text(text_path, extracted_text)
        update_job_usage(session, job.id, stage_key="text", increment=1)
        set_job_stage(session, job.id, stage=JOB_STAGE_TEXT)
        if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
            return
    set_progress_step(
        session,
        job_id=job.id,
        import_jobs_dir=deps.import_jobs_dir,
        step=step_protocol.normalize_text_step(total_steps=step_protocol.PDF_TEXT_TOTAL_STEPS),
    )
    result = build_text_result_payload(
        extracted_text=read_text(text_path),
        selected_pages=page_selection,
    )
    write_json(artifact_dir / "result.json", result)
    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)


def _run_pdf_direct_generation_job(
    session: Session,
    *,
    job: MindMapImportJob,
    artifact_dir: Path,
    page_selection: list[int],
    range_prompt: str,
    fallback_title: str,
    import_options: Any,
    rendered_pages: list[tuple[int, bytes, str]],
    artifact_refs: list[dict[str, Any]],
    deps: PdfJobDependencies,
) -> None:
    result_path = artifact_dir / "result.json"
    if not result_path.exists():
        warnings: list[str] = []
        text_path = artifact_dir / "extracted_text.txt"
        trimmed_text: str | None = None
        ocr_text_chars = 0
        if text_path.exists():
            cached_text = read_text(text_path)
            trimmed_text = cached_text if cached_text.strip() else None
            ocr_text_chars = len(trimmed_text or "")
        else:
            try:
                set_progress_step(
                    session,
                    job_id=job.id,
                    import_jobs_dir=deps.import_jobs_dir,
                    step=step_protocol.extract_selected_pdf_ocr_step(),
                    preview_text="",
                )
                trimmed_text, ocr_text_chars = consume_stream_result(
                    session,
                    job_id=job.id,
                    artifact_dir=artifact_dir,
                    generator=pdf_model_workflows.stream_selected_pdf_ocr(
                        rendered_pages=rendered_pages,
                        page_numbers=page_selection,
                        range_prompt=range_prompt,
                        prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding,
                        stream_call_dashscope_text_fn=deps.stream_call_dashscope_text,
                        external_log_context={
                            "feature": "学科 PDF 转脑图",
                            "operation": "pdf_selected_pages_ocr",
                            "job_id": job.id,
                            "artifact_refs": artifact_refs,
                        },
                    ),
                    allow_preview_text=False,
                    import_jobs_dir=deps.import_jobs_dir,
                )
                write_text(text_path, trimmed_text or "")
                update_job_usage(session, job.id, stage_key="ocr", increment=1)
                set_job_stage(session, job.id, stage=JOB_STAGE_OCR)
                if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
                    return
            except MindMapImportError:
                warnings.append(PDF_DIRECT_OCR_FALLBACK_WARNING)
        set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=deps.import_jobs_dir,
            step=step_protocol.generate_pdf_mindmap_direct_step(),
            preview_text="",
        )
        set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)
        final_tree = consume_stream_result(
            session,
            job_id=job.id,
            artifact_dir=artifact_dir,
            generator=pdf_model_workflows.stream_pdf_direct_generation(
                rendered_pages=rendered_pages,
                page_numbers=page_selection,
                range_prompt=range_prompt,
                import_options=import_options,
                extracted_text=trimmed_text,
                stream_call_dashscope_pdf_json_fn=deps.stream_call_dashscope_pdf_json,
                external_log_context={
                    "feature": "学科 PDF 转脑图",
                    "operation": "pdf_direct_generation",
                    "job_id": job.id,
                    "artifact_refs": artifact_refs,
                },
            ),
            allow_preview_text=True,
            import_jobs_dir=deps.import_jobs_dir,
        )
        update_job_usage(session, job.id, stage_key="merge", increment=1)
        if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
            return
        set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=deps.import_jobs_dir,
            step=step_protocol.build_preview_step(total_steps=step_protocol.PDF_IMPORT_TOTAL_STEPS),
        )
        result = build_pdf_import_result_payload(
            source_tree=final_tree,
            fallback_title=fallback_title,
            selected_pages=page_selection,
            structure_page=None,
            import_options=import_options,
            warnings=warnings,
            match_mode=PDF_IMPORT_MODE_DIRECT_GENERATION,
            ocr_grounding_used=bool(trimmed_text),
            ocr_text_chars=ocr_text_chars or None,
        )
        write_json(artifact_dir / "final_tree.json", final_tree)
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)


def _run_pdf_structured_merge_job(
    session: Session,
    *,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    page_selection: list[int],
    range_prompt: str,
    fallback_title: str,
    import_options: Any,
    rendered_pages: list[tuple[int, bytes, str]],
    deps: PdfJobDependencies,
) -> None:
    resolved_structure_page = resolve_pdf_structure_page(
        page_selection,
        source_meta.get("structure_page"),
    )
    structure_payload, body_payloads = split_rendered_pdf_pages(
        rendered_pages,
        structure_page=resolved_structure_page,
    )
    structure_artifact_refs = _build_pdf_artifact_refs(
        artifact_dir,
        [structure_payload],
        labels={resolved_structure_page: f"结构页 {resolved_structure_page}"},
    )
    body_artifact_refs = _build_pdf_artifact_refs(
        artifact_dir,
        body_payloads,
    )
    ordered_merge_artifact_refs = _build_pdf_artifact_refs(
        artifact_dir,
        [structure_payload, *body_payloads],
        labels={resolved_structure_page: f"结构页 {resolved_structure_page}"},
    )
    structure_path = artifact_dir / "structure_tree.json"
    if not structure_path.exists():
        set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=deps.import_jobs_dir,
            step=step_protocol.recognize_pdf_structure_step(
                structure_page=resolved_structure_page
            ),
            preview_text="",
        )
        structure_tree = consume_stream_result(
            session,
            job_id=job.id,
            artifact_dir=artifact_dir,
            generator=pdf_model_workflows.stream_pdf_structure_recognition(
                structure_payload=structure_payload,
                structure_page=resolved_structure_page,
                range_prompt=range_prompt,
                preserve_emphasis_marks=import_options.preserve_emphasis_marks,
                build_pdf_structure_prompt_fn=build_import_pdf_structure_prompt,
                stream_call_dashscope_json_fn=deps.stream_call_dashscope_json,
                external_log_context={
                    "feature": "学科 PDF 转脑图",
                    "operation": "pdf_structure_recognition",
                    "job_id": job.id,
                    "artifact_refs": structure_artifact_refs,
                },
            ),
            allow_preview_text=True,
            import_jobs_dir=deps.import_jobs_dir,
        )
        write_json(structure_path, structure_tree)
        update_job_usage(session, job.id, stage_key="structure", increment=1)
        set_job_stage(session, job.id, stage=JOB_STAGE_STRUCTURE)
        if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
            return
    else:
        structure_tree = read_json(structure_path)

    result_path = artifact_dir / "result.json"
    if not result_path.exists():
        warnings: list[str] = []
        final_tree = structure_tree
        if body_payloads:
            text_path = artifact_dir / "extracted_text.txt"
            trimmed_text: str | None = None
            if text_path.exists():
                cached_text = read_text(text_path)
                trimmed_text = cached_text if cached_text.strip() else None
            else:
                try:
                    set_progress_step(
                        session,
                        job_id=job.id,
                        import_jobs_dir=deps.import_jobs_dir,
                        step=step_protocol.extract_pdf_body_ocr_step(),
                    )
                    trimmed_text = consume_stream_result(
                        session,
                        job_id=job.id,
                        artifact_dir=artifact_dir,
                        generator=pdf_model_workflows.stream_pdf_body_ocr(
                            body_payloads=body_payloads,
                            range_prompt=range_prompt,
                            structure_title=str(
                                structure_tree.get("title") or fallback_title or ""
                            ),
                            prepare_pdf_ocr_grounding_fn=prepare_pdf_ocr_grounding,
                            stream_call_dashscope_text_fn=deps.stream_call_dashscope_text,
                            external_log_context={
                                "feature": "学科 PDF 转脑图",
                                "operation": "pdf_body_ocr",
                                "job_id": job.id,
                                "artifact_refs": body_artifact_refs,
                            },
                        ),
                        allow_preview_text=False,
                        import_jobs_dir=deps.import_jobs_dir,
                    )
                    write_text(text_path, trimmed_text or "")
                    update_job_usage(session, job.id, stage_key="ocr", increment=1)
                    set_job_stage(session, job.id, stage=JOB_STAGE_OCR)
                    if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
                        return
                except MindMapImportError:
                    warnings.append(PDF_OCR_FALLBACK_WARNING)
            set_progress_step(
                session,
                job_id=job.id,
                import_jobs_dir=deps.import_jobs_dir,
                step=step_protocol.merge_pdf_body_step(),
                preview_text="",
            )
            set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)
            final_tree = consume_stream_result(
                session,
                job_id=job.id,
                artifact_dir=artifact_dir,
                generator=pdf_model_workflows.stream_pdf_body_merge(
                    structure_payload=structure_payload,
                    body_payloads=body_payloads,
                    structure_tree=structure_tree,
                    page_numbers=page_selection,
                    range_prompt=range_prompt,
                    import_options=import_options,
                    extracted_text=trimmed_text,
                    order_pdf_image_items_fn=order_pdf_image_items,
                    stream_call_dashscope_batch_json_fn=deps.stream_call_dashscope_batch_json,
                    external_log_context={
                        "feature": "学科 PDF 转脑图",
                        "operation": "pdf_body_merge",
                        "job_id": job.id,
                        "artifact_refs": ordered_merge_artifact_refs,
                    },
                ),
                allow_preview_text=True,
                import_jobs_dir=deps.import_jobs_dir,
            )
            update_job_usage(session, job.id, stage_key="merge", increment=1)
        else:
            warnings.append(SINGLE_PAGE_PDF_WARNING)
            consume_stream_result(
                session,
                job_id=job.id,
                artifact_dir=artifact_dir,
                generator=pdf_model_workflows.stream_skip_pdf_body_steps(),
                allow_preview_text=False,
                import_jobs_dir=deps.import_jobs_dir,
            )
        if pause_if_requested(session, job.id, import_jobs_dir=deps.import_jobs_dir):
            return
        result = build_pdf_import_result_payload(
            source_tree=final_tree,
            fallback_title=fallback_title,
            selected_pages=page_selection,
            structure_page=resolved_structure_page,
            import_options=import_options,
            warnings=warnings,
            match_mode="strict_match",
        )
        write_json(artifact_dir / "final_tree.json", final_tree)
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)
