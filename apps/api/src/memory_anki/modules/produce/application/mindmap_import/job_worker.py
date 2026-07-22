from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import MindMapImportJob

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
    JOB_STAGE_OCR,
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
    stream_call_dashscope_text,
    stream_call_formatter_json,
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

    # 单图脑图：先识别全部文字，再整理 JSON（与 PDF/多图同一语义）
    result_path = artifact_dir / "result.json"
    if not result_path.exists():
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
        combined_text, ocr_pages = _run_page_ocr(
            session,
            job=job,
            source_meta=source_meta,
            artifact_dir=artifact_dir,
            image_items=[(image_bytes, filename)],
            artifact_refs=artifact_refs,
            import_jobs_dir=import_jobs_dir,
            stream_call_dashscope_text=stream_call_dashscope_text,
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.normalize_tree_step(
                total_steps=step_protocol.IMAGE_MINDMAP_TOTAL_STEPS
            ),
            preview_text="",
        )
        source_tree, formatter_metadata = _format_ocr_tree(
            session,
            job=job,
            artifact_dir=artifact_dir,
            combined_text=combined_text,
            fallback_title=fallback_title,
            import_jobs_dir=import_jobs_dir,
            stream_call_formatter_json=stream_call_formatter_json,
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return
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
        result.update(
            {
                "pipeline_strategy": "extract_then_format",
                "vision_resolved_ai": _resolved_ai(source_meta, "vision_ai_runtime")
                or _resolved_ai(source_meta, "ai_runtime"),
                "formatter_resolved_ai": _resolved_ai(source_meta, "formatter_ai_runtime"),
                "ocr_pages": ocr_pages,
                "stage_usage": {
                    "ocr": [item.get("usage") for item in ocr_pages],
                    "formatter": formatter_metadata.get("usage"),
                },
                "formatter_response": (
                    read_text(artifact_dir / "formatter_response.txt")
                    if (artifact_dir / "formatter_response.txt").exists()
                    else ""
                ),
            }
        )
        write_json(artifact_dir / "final_tree.json", source_tree)
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)


def _validate_direct_tree(tree: dict[str, Any]) -> None:
    if not str(tree.get("title") or "").strip():
        raise MindMapImportError("模型返回的根标题为空。")
    children = tree.get("children")
    if not isinstance(children, list) or not children:
        raise MindMapImportError("模型返回的脑图没有有效内容节点。")


def _target_title(fallback_title: str) -> str:
    normalized = str(fallback_title or "").strip()
    if normalized in {"", "未命名宫殿", "新建宫殿", "未命名"}:
        return ""
    return normalized


def _resolved_ai(source_meta: dict[str, Any], key: str) -> dict[str, Any] | None:
    runtime_meta = source_meta.get(key)
    if not isinstance(runtime_meta, dict):
        return None
    resolved = runtime_meta.get("resolved_ai")
    return dict(resolved) if isinstance(resolved, dict) else None


def _run_page_ocr(
    session: Session,
    *,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    image_items: list[tuple[bytes, str | None]],
    artifact_refs: list[dict[str, Any]],
    import_jobs_dir: Path,
    stream_call_dashscope_text,
) -> tuple[str, list[dict[str, Any]]]:
    from memory_anki.modules.pdf_library.api import read_cached_page, write_cached_page

    ocr_dir = artifact_dir / "ocr"
    ocr_dir.mkdir(parents=True, exist_ok=True)
    selected_pages = [int(value) for value in source_meta.get("page_selection") or []]
    pdf_document_id = str(source_meta.get("pdf_document_id") or "").strip()
    ocr_model = None
    vision_runtime = source_meta.get("vision_ai_runtime") or source_meta.get("ai_runtime") or {}
    if isinstance(vision_runtime, dict):
        ocr_model = str(vision_runtime.get("model") or "").strip() or None
    page_results: list[dict[str, Any]] = []
    combined_parts: list[str] = []
    for index, image_item in enumerate(image_items):
        page_number = selected_pages[index] if index < len(selected_pages) else index + 1
        page_path = ocr_dir / f"page-{page_number}.txt"
        metadata: dict[str, Any] = {}
        reuse_source: str | None = None
        if page_path.exists() and page_path.read_text(encoding="utf-8").strip():
            page_text = read_text(page_path)
            reused = True
            reuse_source = "job_artifact"
        else:
            cached = (
                read_cached_page(pdf_document_id, page_number)
                if pdf_document_id
                else None
            )
            if cached is not None:
                page_text, cache_meta = cached
                write_text(page_path, page_text)
                reused = True
                reuse_source = "document_cache"
                if cache_meta.get("model"):
                    metadata["cached_model"] = cache_meta.get("model")
            else:
                page_text = consume_stream_result(
                    session,
                    job_id=job.id,
                    artifact_dir=artifact_dir,
                    generator=stream_call_dashscope_text(
                        image_items=[image_item],
                        page_numbers=[page_number],
                        range_prompt="",
                        channel="ocr",
                        force_default_prompt=True,
                        external_log_context={
                            "feature": "PDF 转脑图" if job.source_kind == "pdf-document" else "图片转脑图",
                            "operation": "page_ocr",
                            "job_id": job.id,
                            "artifact_refs": [artifact_refs[index]] if index < len(artifact_refs) else [],
                            "stream_metadata": metadata,
                        },
                    ),
                    allow_preview_text=True,
                    import_jobs_dir=import_jobs_dir,
                )
                write_text(page_path, page_text)
                update_job_usage(session, job.id, stage_key="ocr", increment=1)
                reused = False
                if pdf_document_id and str(page_text or "").strip():
                    try:
                        write_cached_page(
                            pdf_document_id,
                            page_number,
                            page_text,
                            model=ocr_model,
                            source_job_id=job.id,
                        )
                    except ValueError:
                        pass
        combined_parts.append(f"===== PDF 第 {page_number} 页 =====\n{page_text.strip()}")
        page_results.append(
            {
                "page_number": page_number,
                "text": page_text,
                "reused": reused,
                "reuse_source": reuse_source,
                "usage": metadata.get("usage"),
                "finish_reason": metadata.get("finish_reason"),
            }
        )
    combined_text = "\n\n".join(combined_parts).strip()
    write_text(artifact_dir / "ocr_combined.txt", combined_text)
    set_job_stage(session, job.id, stage=JOB_STAGE_OCR)
    return combined_text, page_results


def _format_ocr_tree(
    session: Session,
    *,
    job: MindMapImportJob,
    artifact_dir: Path,
    combined_text: str,
    fallback_title: str,
    import_jobs_dir: Path,
    stream_call_formatter_json,
) -> tuple[dict[str, Any], dict[str, Any]]:
    metadata: dict[str, Any] = {}
    tree = consume_stream_result(
        session,
        job_id=job.id,
        artifact_dir=artifact_dir,
        generator=stream_call_formatter_json(
            extracted_text=combined_text,
            target_title=_target_title(fallback_title),
            channel="formatter",
            external_log_context={
                "feature": "PDF 转脑图" if job.source_kind == "pdf-document" else "图片转脑图",
                "operation": "ocr_mindmap_format",
                "job_id": job.id,
                "stream_metadata": metadata,
            },
        ),
        allow_preview_text=True,
        import_jobs_dir=import_jobs_dir,
    )
    _validate_direct_tree(tree)
    write_text(artifact_dir / "formatter_response.txt", str(metadata.get("partial_response") or ""))
    update_job_usage(session, job.id, stage_key="merge", increment=1)
    set_job_stage(session, job.id, stage=JOB_STAGE_MERGE)
    return tree, metadata

def run_image_batch_job(
    session: Session,
    job: MindMapImportJob,
    source_meta: dict[str, Any],
    artifact_dir: Path,
    *,
    import_jobs_dir: Path,
    stream_call_dashscope_text,
    stream_call_formatter_json,
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
    fallback_title = str(source_meta.get("fallback_title") or "未命名宫殿")

    if job.mode == MODE_TEXT:
        extracted_text_path = artifact_dir / "extracted_text.txt"
        if not extracted_text_path.exists():
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
                    image_items=image_items,
                    page_numbers=[int(item) for item in source_meta.get("page_selection") or []] or None,
                    range_prompt="",
                    channel="text",
                    external_log_context={
                        "feature": "PDF 转文字" if job.source_kind == "pdf-document" else "图片转文字",
                        "operation": "batch_text_extraction",
                        "job_id": job.id,
                        "artifact_refs": artifact_refs,
                    },
                ),
                allow_preview_text=True,
                import_jobs_dir=import_jobs_dir,
            )
            write_text(extracted_text_path, extracted_text)
            update_job_usage(session, job.id, stage_key="text", increment=1)
            set_job_stage(session, job.id, stage=JOB_STAGE_TEXT)
        extracted_text = read_text(extracted_text_path)
        set_job_result(
            session,
            job.id,
            result=build_text_result_payload(extracted_text=extracted_text),
            stage=JOB_STAGE_COMPLETED,
        )
        return

    # 多图/PDF 脑图：阶段 A 全量识别文字 → 阶段 B 按范围整理 JSON
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

        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.extract_all_pages_text_step(),
            preview_text="",
        )
        combined_text, ocr_pages = _run_page_ocr(
            session,
            job=job,
            source_meta=source_meta,
            artifact_dir=artifact_dir,
            image_items=image_items,
            artifact_refs=artifact_refs,
            import_jobs_dir=import_jobs_dir,
            stream_call_dashscope_text=stream_call_dashscope_text,
        )
        if pause_if_requested(session, job.id, import_jobs_dir=import_jobs_dir):
            return

        _set_progress_step(
            session,
            job_id=job.id,
            import_jobs_dir=import_jobs_dir,
            step=step_protocol.format_mindmap_json_step(),
            preview_text="",
        )
        final_tree, formatter_metadata = _format_ocr_tree(
            session,
            job=job,
            artifact_dir=artifact_dir,
            combined_text=combined_text,
            fallback_title=fallback_title,
            import_jobs_dir=import_jobs_dir,
            stream_call_formatter_json=stream_call_formatter_json,
        )
        stage_usage: dict[str, Any] = {
            "ocr": [item.get("usage") for item in ocr_pages],
            "formatter": formatter_metadata.get("usage"),
        }

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
            image_count=len(image_items),
        )
        result.update(
            {
                "pipeline_strategy": "extract_then_format",
                "vision_resolved_ai": _resolved_ai(source_meta, "vision_ai_runtime")
                or _resolved_ai(source_meta, "ai_runtime"),
                "formatter_resolved_ai": _resolved_ai(source_meta, "formatter_ai_runtime"),
                "fallback_reason": None,
                "ocr_pages": ocr_pages,
                "stage_usage": stage_usage,
                "formatter_response": (
                    read_text(artifact_dir / "formatter_response.txt")
                    if (artifact_dir / "formatter_response.txt").exists()
                    else ""
                ),
            }
        )
        write_json(artifact_dir / "final_tree.json", final_tree)
        write_json(artifact_dir / "editor_doc.json", result["editor_doc"])
        write_json(result_path, result)
    else:
        result = read_json(result_path)

    set_job_result(session, job.id, result=result, stage=JOB_STAGE_COMPLETED)
