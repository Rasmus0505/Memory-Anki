from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import MindMapImportJob, SubjectDocument, engine
from memory_anki.modules.palaces.application import mindmap_import_job_service as job_service
from memory_anki.modules.palaces.application.mindmap_import_service import MindMapImportError, PdfImportOptions


def _make_subject_document() -> SubjectDocument:
    return SubjectDocument(
        id=99,
        subject_id=4,
        filename="subjects/4/test.pdf",
        original_name="test.pdf",
        mime_type="application/pdf",
        file_size=256,
        page_count=6,
    )


def _load_job(job_id: str) -> dict:
    with Session(engine) as session:
        job = job_service.get_job(session, job_id)
        assert job is not None
        return job_service.serialize_job(job)


def _stream_return(value):
    if False:
        yield None
    return value


@pytest.fixture(autouse=True)
def isolate_import_jobs(tmp_path, monkeypatch):
    job_service.ensure_mindmap_import_job_schema()
    monkeypatch.setattr(job_service, "IMPORT_JOBS_DIR", tmp_path)
    with Session(engine) as session:
        session.query(MindMapImportJob).delete()
        session.commit()
    yield
    with Session(engine) as session:
        session.query(MindMapImportJob).delete()
        session.commit()


def test_same_fingerprint_completed_job_is_reused_without_creating_a_new_job():
    with Session(engine) as session:
        job = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

    with patch.object(
        job_service,
        "_stream_call_dashscope_json",
        return_value=_stream_return({"title": "导入脑图", "children": [{"text": "节点", "children": []}]}),
    ):
        job_service._run_job_worker(job.id)

    with Session(engine) as session:
        reused = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

    assert reused.id == job.id
    assert _load_job(job.id)["status"] == job_service.JOB_STATUS_COMPLETED


def test_resume_after_structure_checkpoint_only_reruns_merge_stage():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=([(b"struct", "structure.png"), (b"body", "body.png")], 0),
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"struct", "structure.png"), (b"body", "body.png")],
                fallback_title="批量导入",
                structure_image_index=0,
            )

    with patch.object(
        job_service,
        "_stream_call_dashscope_json",
        return_value=_stream_return({"title": "结构", "children": [{"text": "原节点", "children": []}]}),
    ) as mock_structure, patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        side_effect=MindMapImportError("merge failed"),
    ):
        job_service._run_job_worker(job.id)

    failed_job = _load_job(job.id)
    assert failed_job["status"] == job_service.JOB_STATUS_FAILED
    assert failed_job["stage"] == job_service.JOB_STAGE_STRUCTURE
    assert failed_job["usage"]["structure"] == 1
    assert failed_job["usage"]["merge"] == 0
    assert mock_structure.call_count == 1

    with patch.object(job_service, "_stream_call_dashscope_json") as mock_structure_again, patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        return_value=_stream_return({"title": "结构", "children": [{"text": "原节点", "children": [{"text": "补充", "children": []}]}]}),
    ) as mock_merge:
        job_service._run_job_worker(job.id)

    completed_job = _load_job(job.id)
    assert completed_job["status"] == job_service.JOB_STATUS_COMPLETED
    assert completed_job["usage"]["structure"] == 1
    assert completed_job["usage"]["merge"] == 1
    assert completed_job["result"]["source_tree"]["children"][0]["children"][0]["text"] == "补充"
    assert mock_structure_again.call_count == 0
    assert mock_merge.call_count == 1


def test_pdf_resume_reuses_cached_render_and_ocr_outputs():
    document = _make_subject_document()
    with patch.object(
        job_service,
        "render_selected_pdf_pages",
        return_value=[(2, b"page-2", "page-2.png"), (4, b"page-4", "page-4.png")],
    ) as mock_render:
        with Session(engine) as session:
            job = job_service.create_pdf_import_job(
                session,
                entity_key="palace_1",
                document=document,
                mode=job_service.MODE_MINDMAP,
                page_selection=[2, 4],
                structure_page=4,
                pdf_mode=job_service.PDF_IMPORT_MODE_STRUCTURED_MERGE,
                range_prompt="第一节",
                fallback_title="test.pdf",
                import_options=PdfImportOptions(),
            )

    assert mock_render.call_count == 0

    with patch.object(job_service, "get_subject_document_by_id", return_value=document), patch.object(
        job_service,
        "render_selected_pdf_pages",
        return_value=[(2, b"page-2", "page-2.png"), (4, b"page-4", "page-4.png")],
    ) as mock_render_during_run, patch.object(
        job_service,
        "_stream_call_dashscope_json",
        return_value=_stream_return({"title": "结构", "children": [{"text": "原节点", "children": []}]}),
    ), patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("第一节\n补充正文"),
    ), patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        side_effect=MindMapImportError("merge failed"),
    ):
        job_service._run_job_worker(job.id)

    failed_job = _load_job(job.id)
    assert failed_job["status"] == job_service.JOB_STATUS_FAILED
    assert failed_job["stage"] == job_service.JOB_STAGE_MERGE
    assert failed_job["usage"]["merge"] == 0
    assert mock_render_during_run.call_count == 1

    with patch.object(job_service, "get_subject_document_by_id", return_value=document), patch.object(
        job_service, "render_selected_pdf_pages"
    ) as mock_render_again, patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        return_value=_stream_return({"title": "结构", "children": [{"text": "原节点", "children": [{"text": "补充正文", "children": []}]}]}),
    ) as mock_pdf_call:
        job_service._run_job_worker(job.id)

    completed_job = _load_job(job.id)
    assert completed_job["status"] == job_service.JOB_STATUS_COMPLETED
    assert completed_job["usage"]["merge"] == 1
    assert completed_job["result"]["source_tree"]["children"][0]["children"][0]["text"] == "补充正文"
    assert mock_render_again.call_count == 0
    assert mock_pdf_call.call_count == 1


def test_create_pdf_import_job_defaults_to_direct_generation_without_structure_page():
    document = SubjectDocument(
        id=99,
        subject_id=4,
        filename="subjects/4/test.pdf",
        original_name="test.pdf",
        mime_type="application/pdf",
        file_size=256,
        page_count=40,
    )

    with Session(engine) as session:
        job = job_service.create_pdf_import_job(
            session,
            entity_key="palace_1",
            document=document,
            mode=job_service.MODE_MINDMAP,
            page_selection=[26, 27, 28],
            structure_page=26,
            range_prompt="第一节",
            fallback_title="test.pdf",
            import_options=PdfImportOptions(),
        )

    payload = _load_job(job.id)
    assert payload["source_meta"]["pdf_mode"] == job_service.PDF_IMPORT_MODE_DIRECT_GENERATION
    assert payload["source_meta"]["structure_page"] is None


def test_pdf_direct_generation_job_uses_pdf_json_flow_and_returns_no_structure_page():
    document = SubjectDocument(
        id=99,
        subject_id=4,
        filename="subjects/4/test.pdf",
        original_name="test.pdf",
        mime_type="application/pdf",
        file_size=256,
        page_count=40,
    )
    with Session(engine) as session:
        job = job_service.create_pdf_import_job(
            session,
            entity_key="palace_1",
            document=document,
            mode=job_service.MODE_MINDMAP,
            page_selection=[26, 27, 28],
            structure_page=26,
            pdf_mode=job_service.PDF_IMPORT_MODE_DIRECT_GENERATION,
            range_prompt="第一节",
            fallback_title="test.pdf",
            import_options=PdfImportOptions(),
        )

    with patch.object(job_service, "get_subject_document_by_id", return_value=document), patch.object(
        job_service,
        "render_selected_pdf_pages",
        return_value=[
            (26, b"page-26", "page-26.png"),
            (27, b"page-27", "page-27.png"),
            (28, b"page-28", "page-28.png"),
        ],
    ), patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("第一节 古罗马的教育阶段\n正文细节"),
    ), patch.object(
        job_service,
        "_stream_call_dashscope_pdf_json",
        return_value=_stream_return(
            {
                "title": "第一节",
                "children": [
                    {"text": "背景", "children": []},
                    {"text": "特点", "children": []},
                    {"text": "影响", "children": []},
                ],
            }
        ),
    ) as mock_pdf_call:
        job_service._run_job_worker(job.id)

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["result"]["structure_page"] is None
    assert payload["result"]["match_mode"] == job_service.PDF_IMPORT_MODE_DIRECT_GENERATION
    assert len(payload["result"]["source_tree"]["children"]) == 3
    assert payload["result"]["ocr_grounding_used"] is True
    assert payload["result"]["ocr_text_chars"] > 0
    assert payload["usage"]["ocr"] == 1
    assert payload["usage"]["merge"] == 1
    assert mock_pdf_call.call_count == 1
    assert mock_pdf_call.call_args.kwargs["extracted_text"] == "第一节 古罗马的教育阶段\n正文细节"


def test_pdf_direct_generation_job_keeps_running_when_ocr_fails():
    document = SubjectDocument(
        id=99,
        subject_id=4,
        filename="subjects/4/test.pdf",
        original_name="test.pdf",
        mime_type="application/pdf",
        file_size=256,
        page_count=40,
    )
    with Session(engine) as session:
        job = job_service.create_pdf_import_job(
            session,
            entity_key="palace_1",
            document=document,
            mode=job_service.MODE_MINDMAP,
            page_selection=[26, 27],
            structure_page=None,
            pdf_mode=job_service.PDF_IMPORT_MODE_DIRECT_GENERATION,
            range_prompt="第一节",
            fallback_title="test.pdf",
            import_options=PdfImportOptions(),
        )

    with patch.object(job_service, "get_subject_document_by_id", return_value=document), patch.object(
        job_service,
        "render_selected_pdf_pages",
        return_value=[
            (26, b"page-26", "page-26.png"),
            (27, b"page-27", "page-27.png"),
        ],
    ), patch.object(
        job_service,
        "_stream_call_dashscope_text",
        side_effect=MindMapImportError("模型没有识别出可用文字。"),
    ), patch.object(
        job_service,
        "_stream_call_dashscope_pdf_json",
        return_value=_stream_return(
            {
                "title": "第一节",
                "children": [{"text": "背景", "children": []}],
            }
        ),
    ) as mock_pdf_call:
        job_service._run_job_worker(job.id)

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["result"]["ocr_grounding_used"] is False
    assert payload["usage"]["ocr"] == 0
    assert "正文补全可信度可能下降" in payload["result"]["warnings"][0]
    assert mock_pdf_call.call_args.kwargs["extracted_text"] is None


def test_source_meta_to_pdf_options_ignores_legacy_strict_restore_flag():
    options = job_service._source_meta_to_pdf_options(
        {
            "import_options": {
                "strict_restore": False,
                "quote_original_text_only": False,
                "mount_on_original_leaf_only": False,
                "preserve_emphasis_marks": False,
                "semantic_split_long_paragraphs": False,
                "preserve_line_breaks": False,
            }
        }
    )

    assert options.quote_original_text_only is False
    assert options.mount_on_original_leaf_only is False
    assert options.preserve_emphasis_marks is False
    assert options.semantic_split_long_paragraphs is False
    assert options.preserve_line_breaks is False


def test_non_json_or_html_provider_errors_become_structured_retryable_failures():
    with Session(engine) as session:
        job = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )

    with patch.object(
        job_service,
        "_stream_call_dashscope_json",
        side_effect=MindMapImportError("Internal Server Error"),
    ):
        job_service._run_job_worker(job.id)

    failed_job = _load_job(job.id)
    assert failed_job["status"] == job_service.JOB_STATUS_FAILED
    assert failed_job["resumable"] is True
    assert failed_job["error"]["code"] == "provider_http_error"
    assert failed_job["error"]["retryable"] is True
    assert "Internal Server Error" in failed_job["error"]["raw_snippet"]


def test_ensure_schema_marks_stale_running_jobs_as_interrupted():
    with Session(engine) as session:
        session.add(
            MindMapImportJob(
                id="stale-job",
                entity_key="palace_1",
                source_kind=job_service.SOURCE_KIND_IMAGE_SINGLE,
                mode=job_service.MODE_MINDMAP,
                status=job_service.JOB_STATUS_RUNNING,
                stage=job_service.JOB_STAGE_MERGE,
                fingerprint="fingerprint-1",
                source_meta_json="{}",
                result_json="{}",
                error_json="{}",
                usage_json="{}",
            )
        )
        session.commit()

    job_service.ensure_mindmap_import_job_schema()

    stale_job = _load_job("stale-job")
    assert stale_job["status"] == job_service.JOB_STATUS_INTERRUPTED
    assert stale_job["resumable"] is True


def test_request_pause_sets_pause_requested_and_worker_lands_on_paused_checkpoint():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=([(b"struct", "structure.png"), (b"body", "body.png")], 0),
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"struct", "structure.png"), (b"body", "body.png")],
                fallback_title="批量导入",
                structure_image_index=0,
            )

    def _stream_and_request_pause():
        with Session(engine) as session:
            job_service.request_pause_job(session, job_id=job.id)
        if False:
            yield None
        return {"title": "结构", "children": [{"text": "原节点", "children": []}]}

    with patch.object(
        job_service,
        "_stream_call_dashscope_json",
        return_value=_stream_and_request_pause(),
    ), patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        return_value=_stream_return({"title": "结构", "children": [{"text": "原节点", "children": []}]}),
    ):
        job_service._run_job_worker(job.id)

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_PAUSED
    assert payload["pause_requested"] is False
    assert payload["stage"] == job_service.JOB_STAGE_STRUCTURE
    assert payload["progress"]["message"] == "识别已暂停，可继续识别。"


def test_running_job_serializes_progress_preview_text():
    with Session(engine) as session:
        job = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
        )
        job_service._set_job_progress(
            session,
            job.id,
            phase="calling_model",
            message="正在识别图片结构",
            step=2,
            total_steps=4,
            preview_text='{"title":"导入脑图"}',
        )
        job_id = job.id

    payload = _load_job(job_id)
    assert payload["progress"]["phase"] == "calling_model"
    assert payload["progress"]["message"] == "正在识别图片结构"
    assert payload["progress"]["step"] == 2
    assert payload["progress"]["total_steps"] == 4
    assert payload["progress"]["preview_text"] == '{"title":"导入脑图"}'
