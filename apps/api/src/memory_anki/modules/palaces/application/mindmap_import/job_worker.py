from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import MindMapImportJob

from . import (
    MindMapImportError,
    step_protocol,
)
from .job_artifacts import load_batch_image_items, read_json, read_text, write_json, write_text
from .job_progress import consume_stream_result
from .job_progress import set_progress_step as _set_progress_step
from .job_repository import pause_if_requested, set_job_result, set_job_stage, update_job_usage
from .job_state import (
    JOB_STAGE_COMPLETED,
    JOB_STAGE_MERGE,
    JOB_STAGE_STRUCTURE,
    JOB_STAGE_TEXT,
    MODE_TEXT,
)
from .workflow import (
    build_batch_import_result_payload,
    build_image_import_result_payload,
    build_text_result_payload,
)


def _build_input_artifact_refs(paths: list[Path], *, labels: list[str] | None = None) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for index, path in enumerate(paths, start=1):
        refs.append(
            {
                "name": path.name,
                "label": labels[index - 1] if labels and index - 1 < len(labels) else f"第 {index} 张图片",
                "mime_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                "source_kind": "import_job",
                "source_path": str(path),
            }
        )
    return refs


def run_image_single_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    *,
    import_jobs_dir: Path,
    find_first_input_file_fn,
    stream_call_dashscope_json,
    stream_call_dashscope_text,
) -> None:
    input_path = find_first_input_file_fn(artifact_dir)
    if input_path is None:
        raise MindMapImportError("导入图片工件不存在，请重新创建任务。")
    image_bytes = input_path.read_bytes()
    filename = str(source_meta.get("filename") or input_path.name)
    fallback_title = str(source_meta.get("fallback_title") or "未命名宫殿")
    artifact_refs = _build_input_artifact_refs([input_path], labels=["原始图片"])

    if job.mode == MODE_TEXT:
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.validate_single_image_step(
                total_steps=step_protocol.IMAGE_TEXT_TOTAL_STEPS
            ),
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
        if not (artifact_dir / "extracted_text.txt").exists():
            _set_progress_step(
                session,
                job_id=job.id,
                import_jobs_dir=import_jobs_dir,
                step=step_protocol.extract_single_image_text_step(
                    total_steps=step_protocol.IMAGE_TEXT_TOTAL_STEPS
                ),
                preview_text="",
            )
            extracted_text = consume_stream_result(
                session,
                job_id=job.id,
                artifact_dir=artifact_dir,
                generator=stream_call_dashscope_text(
                    image_items=[(image_bytes, filename)],
                    page_numbers=None,
                    range_prompt="",
                    channel="text",
                    external_log_context={
                        "feature": "图片转文字",
                        "operation": "single_image_text",
                        "job_id": job.id,
                        "artifact_refs": artifact_refs,
                    },
                ),
                allow_preview_text=True,
                import_jobs_dir=import_jobs_dir,
            )
            write_text(artifact_dir / "extracted_text.txt", extracted_text)
            update_job_usage(session, job.id, stage_key="text", increment=1)
            set_job_stage(session, job.id, stage=JOB_STAGE_TEXT)
            if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
                return
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.normalize_text_step(
                total_steps=step_protocol.IMAGE_TEXT_TOTAL_STEPS
            ),
        )
        result = build_text_result_payload(
            extracted_text=read_text(artifact_dir / "extracted_text.txt"),
        )
        write_json(artifact_dir / "result.json", result)
        set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)
        return

    structure_path = artifact_dir / "structure_tree.json"
    if not structure_path.exists():
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.validate_single_image_step(
                total_steps=step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
            ),
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.recognize_single_image_structure_step(
                total_steps=step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
            ),
            preview_text="",
        )
        source_tree = consume_stream_result(
            session,
            job_id=job.id,
            artifact_dir=artifact_dir,
            generator=stream_call_dashscope_json(
                image_bytes=image_bytes,
                filename=filename,
                channel="raw_model",
                external_log_context={
                    "feature": "图片转脑图",
                    "operation": "single_image_structure",
                    "job_id": job.id,
                    "artifact_refs": artifact_refs,
                },
            ),
            allow_preview_text=True,
            import_jobs_dir=import_jobs_dir,
        )
        write_json(structure_path, source_tree)
        update_job_usage(session, job.id, stage_key="structure", increment=1)
        set_job_stage(session, job.id, stage=JOB_STAGE_STRUCTURE)
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
    else:
        source_tree = read_json(structure_path)

    result_path = artifact_dir / "result.json"
    if not result_path.exists():
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.normalize_tree_step(
                total_steps=step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
            ),
        )
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.build_preview_step(
                total_steps=step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
            ),
        )
        result = build_image_import_result_payload(
            source_tree=source_tree,
            fallback_title=fallback_title,
        )
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
        set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)


def run_image_batch_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    *,
    import_jobs_dir: Path,
    stream_call_dashscope_json,
    stream_call_dashscope_batch_json,
) -> None:
    image_items = load_batch_image_items(
        artifact_dir,
        source_meta,
        import_error_cls=MindMapImportError,
    )
    input_paths = [
        path
        for path in sorted(artifact_dir.glob("input-*.*"))
        if path.is_file()
    ]
    artifact_refs = _build_input_artifact_refs(input_paths)
    raw_structure_index = source_meta.get("structure_image_index")
    structure_index = int(raw_structure_index) if raw_structure_index is not None else None
    fallback_title = str(source_meta.get("fallback_title") or "未命名宫殿")

    result_path = artifact_dir / "result.json"
    if not result_path.exists():
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.validate_image_batch_step(),
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return

        structure_path = artifact_dir / "structure_tree.json"
        if structure_index is None:
            _set_progress_step(
                session,
                job_id=job.id,
                import_jobs_dir=import_jobs_dir,
                step=step_protocol.generate_batch_mindmap_direct_step(),
                preview_text="",
            )
            final_tree = consume_stream_result(
                session,
                job_id=job.id,
                artifact_dir=artifact_dir,
                generator=stream_call_dashscope_batch_json(
                    image_items=image_items,
                    structure_tree=None,
                    channel="raw_model",
                    range_prompt="",
                    page_numbers=None,
                    disable_rebalance=True,
                    extracted_text=None,
                    external_log_context={
                        "feature": "多图转脑图",
                        "operation": "batch_direct_generation",
                        "job_id": job.id,
                        "artifact_refs": artifact_refs,
                    },
                ),
                allow_preview_text=True,
                import_jobs_dir=import_jobs_dir,
            )
            update_job_usage(session, job.id, stage_key="merge", increment=1)
            set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)
        else:
            if not structure_path.exists():
                _set_progress_step(
                    session,
                    job_id=job.id,
                    import_jobs_dir=import_jobs_dir,
                    step=step_protocol.extract_batch_structure_step(),
                    preview_text="",
                )
                structure_bytes, structure_filename = image_items[structure_index]
                structure_tree = consume_stream_result(
                    session,
                    job_id=job.id,
                    artifact_dir=artifact_dir,
                    generator=stream_call_dashscope_json(
                        image_bytes=structure_bytes,
                        filename=structure_filename,
                        channel="raw_model",
                        disable_rebalance=True,
                        external_log_context={
                            "feature": "多图转脑图",
                            "operation": "batch_structure",
                            "job_id": job.id,
                            "artifact_refs": artifact_refs,
                        },
                    ),
                    allow_preview_text=True,
                    import_jobs_dir=import_jobs_dir,
                )
                write_json(structure_path, structure_tree)
                update_job_usage(session, job.id, stage_key="structure", increment=1)
                set_job_stage(session, job.id, stage=JOB_STAGE_STRUCTURE)
                if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
                    return
            else:
                structure_tree = read_json(structure_path)

            _set_progress_step(
                session,
                job_id=job.id,
                import_jobs_dir=import_jobs_dir,
                step=step_protocol.enhance_batch_with_body_step(),
                preview_text="",
            )
            final_tree = consume_stream_result(
                session,
                job_id=job.id,
                artifact_dir=artifact_dir,
                generator=stream_call_dashscope_batch_json(
                    image_items=image_items,
                    structure_tree=structure_tree,
                    channel="raw_model",
                    range_prompt="",
                    page_numbers=None,
                    disable_rebalance=True,
                    external_log_context={
                        "feature": "多图转脑图",
                        "operation": "batch_structured_merge",
                        "job_id": job.id,
                        "artifact_refs": artifact_refs,
                    },
                ),
                allow_preview_text=True,
                import_jobs_dir=import_jobs_dir,
            )
            update_job_usage(session, job.id, stage_key="merge", increment=1)
            set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)

        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.build_preview_step(
                total_steps=step_protocol.BATCH_MINDMAP_TOTAL_STEPS
            ),
        )
        result = build_batch_import_result_payload(
            source_tree=final_tree,
            fallback_title=fallback_title,
            structure_image_index=structure_index,
            image_count=len(image_items),
        )
        write_json(artifact_dir / "final_tree.json", final_tree)
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)
