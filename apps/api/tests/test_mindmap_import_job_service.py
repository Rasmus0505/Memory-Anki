from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import fitz
import pytest
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import Base, engine
from memory_anki.infrastructure.db._tables.misc import MindMapImportJob
from memory_anki.modules.produce.application import mindmap_import_job_api
from memory_anki.modules.produce.application import mindmap_import_job_service as job_service
from memory_anki.modules.produce.application.mindmap_import import (
    MindMapImportError,
    job_repository,
)
from memory_anki.modules.produce.presentation import import_router
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog
from memory_anki.platform.application import AiRuntimeOptions


def _ai_runtime(session: Session | None = None) -> SettingsAiRuntimeProvider:
    return SettingsAiRuntimeProvider(session)


def _prompt_catalog(session: Session | None = None) -> SettingsPromptCatalog:
    return SettingsPromptCatalog(session)


def _load_job(job_id: str) -> dict:
    with Session(engine) as session:
        job = job_service.get_job(session, job_id)
        assert job is not None
        return job_service.serialize_job(job)


def _stream_return(value):
    if False:
        yield None
    return value


def _pdf_bytes() -> bytes:
    document = fitz.open()
    document.new_page().insert_text((72, 72), "first")
    document.new_page().insert_text((72, 72), "second")
    content = document.tobytes()
    document.close()
    return content


@pytest.fixture(autouse=True)
def isolate_import_jobs(tmp_path, monkeypatch):
    monkeypatch.setattr(job_service, "IMPORT_JOBS_DIR", tmp_path)
    Base.metadata.create_all(engine)
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
            ai_runtime=_ai_runtime(session),
        )

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("节点"),
    ), patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return({"title": "导入脑图", "children": [{"text": "节点", "children": []}]}),
    ):
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    with Session(engine) as session:
        reused = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
            ai_runtime=_ai_runtime(session),
        )

    assert reused.id == job.id
    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["owner_id"] == "palace_1"
    assert payload["operation_id"] == job.id
    assert payload["source_meta"]["owner_id"] == "palace_1"
    assert payload["source_meta"]["operation_id"] == job.id
    assert "api_key" not in payload["source_meta"]["ai_runtime"]



def test_persisted_runtime_restores_credentials_through_platform_provider():
    restored_snapshots = []

    class FakeRuntimeProvider:
        def restore(self, snapshot):
            restored_snapshots.append(snapshot)
            return SimpleNamespace(
                api_key="current-secret",
                base_url=snapshot.base_url,
                model=snapshot.model,
                provider=snapshot.provider,
                extra_payload=snapshot.extra_payload,
                prompt_override=snapshot.prompt_override,
            )

    runtime = job_service._dashscope_runtime(
        {
            "ai_runtime": {
                "scenario_key": "vision_batch_mindmap",
                "model": "snapshot-model",
                "provider": "dashscope",
                "base_url": "https://snapshot.test/v1",
                "extra_payload": {"enable_thinking": False},
            }
        },
        ai_runtime=FakeRuntimeProvider(),
    )

    assert runtime.api_key == "current-secret"
    assert runtime.model == "snapshot-model"
    assert restored_snapshots[0].scenario_key == "vision_batch_mindmap"


@pytest.mark.skip(reason="structure/direct path removed")
def test_resume_after_structure_checkpoint_only_reruns_merge_stage():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"struct", "structure.png"), (b"body", "body.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"struct", "structure.png"), (b"body", "body.png")],
                fallback_title="批量导入",
                                ai_runtime=_ai_runtime(session),
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
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

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
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    completed_job = _load_job(job.id)
    assert completed_job["status"] == job_service.JOB_STATUS_COMPLETED
    assert completed_job["usage"]["structure"] == 1
    assert completed_job["usage"]["merge"] == 1
    assert completed_job["result"]["source_tree"]["children"][0]["children"][0]["text"] == "补充"
    assert mock_structure_again.call_count == 0
    assert mock_merge.call_count == 1


@pytest.mark.skip(reason="structure/direct path removed")
def test_batch_job_without_structure_image_uses_direct_generation_flow():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
                fallback_title="批量导入",
                                ai_runtime=_ai_runtime(session),
            )

    with patch.object(job_service, "_stream_call_dashscope_json") as mock_structure, patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        return_value=_stream_return(
            {
                "title": "第一章",
                "children": [
                    {"text": "知识点一", "children": []},
                    {"text": "知识点二", "children": []},
                ],
            }
        ),
    ) as mock_merge:
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["result"]["structure_image_index"] is None
    assert payload["result"]["image_count"] == 2
    assert payload["result"]["review_preview"]["node_count"] == 2
    assert payload["result"]["review_preview"]["suggested_segments"]["count"] == 2
    assert payload["usage"]["structure"] == 0
    assert payload["usage"]["merge"] == 1
    assert mock_structure.call_count == 0
    assert mock_merge.call_count == 1


def test_non_json_or_html_provider_errors_become_structured_retryable_failures():
    with Session(engine) as session:
        job = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
            ai_runtime=_ai_runtime(session),
        )

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        side_effect=MindMapImportError("Internal Server Error"),
    ):
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    failed_job = _load_job(job.id)
    assert failed_job["status"] == job_service.JOB_STATUS_FAILED
    assert failed_job["resumable"] is True
    assert failed_job["error"]["code"] == "provider_http_error"
    assert failed_job["error"]["retryable"] is True
    assert "Internal Server Error" in failed_job["error"]["raw_snippet"]


def test_list_jobs_route_marks_stale_running_jobs_interrupted(make_client, session_factory):
    client = make_client(import_router)
    with session_factory() as session:
        session.add(
            MindMapImportJob(
                id="stale-route-job",
                entity_key="palace_1",
                source_kind=job_service.SOURCE_KIND_IMAGE_SINGLE,
                mode=job_service.MODE_MINDMAP,
                status=job_service.JOB_STATUS_RUNNING,
                stage=job_service.JOB_STAGE_MERGE,
                fingerprint="fingerprint-route",
                source_meta_json="{}",
                result_json="{}",
                error_json="{}",
                usage_json="{}",
            )
        )
        session.commit()

    response = client.get("/api/v1/import/jobs", params={"entity_key": "palace_1"})

    assert response.status_code == 200
    stale_job = response.json()["items"][0]
    assert stale_job["status"] == job_service.JOB_STATUS_INTERRUPTED
    assert stale_job["resumable"] is True
    assert "服务重启" in stale_job["progress"]["message"]

    with session_factory() as session:
        stored_job = session.query(MindMapImportJob).filter_by(id="stale-route-job").one()
        assert stored_job.status == job_service.JOB_STATUS_INTERRUPTED


def test_reconcile_stale_running_jobs_keeps_alive_thread_running():
    with Session(engine) as session:
        session.add_all(
            (
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
                ),
                MindMapImportJob(
                    id="alive-job",
                    entity_key="palace_1",
                    source_kind=job_service.SOURCE_KIND_IMAGE_SINGLE,
                    mode=job_service.MODE_MINDMAP,
                    status=job_service.JOB_STATUS_RUNNING,
                    stage=job_service.JOB_STAGE_STRUCTURE,
                    fingerprint="fingerprint-2",
                    source_meta_json="{}",
                    result_json="{}",
                    error_json="{}",
                    usage_json="{}",
                ),
            )
        )
        session.commit()
        changed = job_repository.reconcile_stale_running_jobs(
            session,
            is_thread_alive_fn=lambda job_id: job_id == "alive-job",
            entity_key="palace_1",
        )

        stale_job = session.query(MindMapImportJob).filter_by(id="stale-job").one()
        alive_job = session.query(MindMapImportJob).filter_by(id="alive-job").one()

    assert changed == 1
    assert stale_job.status == job_service.JOB_STATUS_INTERRUPTED
    assert alive_job.status == job_service.JOB_STATUS_RUNNING


def test_interrupted_job_can_resume_and_complete_from_checkpoint():
    with Session(engine) as session:
        job = job_service.create_image_import_job(
            session,
            entity_key="palace_1",
            mode=job_service.MODE_MINDMAP,
            image_bytes=b"image-a",
            filename="demo.png",
            fallback_title="未命名宫殿",
            ai_runtime=_ai_runtime(session),
        )
        job.status = job_service.JOB_STATUS_INTERRUPTED
        job_id = job.id
        session.commit()

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("节点"),
    ), patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return({"title": "导入脑图", "children": [{"text": "节点", "children": []}]}),
    ):
        job_service._run_job_worker(job_id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job_id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["resumable"] is False


@pytest.mark.skip(reason="structure/direct path removed")
def test_request_pause_sets_pause_requested_and_worker_lands_on_paused_checkpoint():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"struct", "structure.png"), (b"body", "body.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"struct", "structure.png"), (b"body", "body.png")],
                fallback_title="批量导入",
                                ai_runtime=_ai_runtime(session),
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
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

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
            ai_runtime=_ai_runtime(session),
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


@pytest.mark.parametrize(
    ("selection", "expected"),
    [
        ("1-3,5,3", [1, 2, 3, 5]),
        ("5,1", [5, 1]),
        ("1，3-4", [1, 3, 4]),
    ],
)
def test_pdf_page_selection_parses_ranges_and_preserves_order(selection, expected):
    assert mindmap_import_job_api.parse_pdf_page_selection(selection, 5) == expected


@pytest.mark.parametrize("selection", ["", "3-1", "0,2", "2,6", "abc"])
def test_pdf_page_selection_rejects_invalid_or_out_of_bounds_values(selection):
    with pytest.raises(MindMapImportError):
        mindmap_import_job_api.parse_pdf_page_selection(selection, 5)


def test_pdf_job_keeps_source_snapshot_and_rerun_gets_new_operation(tmp_path, monkeypatch):
    library_dir = tmp_path / "pdf-library"
    library_dir.mkdir()
    import_dir = tmp_path / "import-jobs"
    pdf_path = library_dir / "document.pdf"
    pdf_path.write_bytes(_pdf_bytes())

    from memory_anki.infrastructure.db._tables.misc import PdfDocument

    with Session(engine) as session:
        document = PdfDocument(
            id="pdf-1",
            filename=pdf_path.name,
            original_name="课程.pdf",
            mime_type="application/pdf",
            file_size=pdf_path.stat().st_size,
            page_count=2,
        )
        session.add(document)
        session.commit()

        monkeypatch.setattr(job_service, "IMPORT_JOBS_DIR", import_dir)
        monkeypatch.setattr(mindmap_import_job_api, "IMPORT_JOBS_DIR", import_dir)
        monkeypatch.setattr(mindmap_import_job_api, "PDF_LIBRARY_DIR", library_dir)
        with patch.object(
            mindmap_import_job_api.llm_gateway,
            "prepare_batch_items",
            side_effect=lambda **kwargs: kwargs["image_items"],
        ):
            job = job_service.create_pdf_import_job(
                session,
                entity_key="palace_1",
                document_id=document.id,
                page_selection="2,1",
                mode=job_service.MODE_MINDMAP,
                fallback_title="PDF 导入",
                ai_runtime=_ai_runtime(session),
            )

        source_dir = import_dir / job.id
        with fitz.open(source_dir / "source.pdf") as snapshot:
            assert snapshot.page_count == 2
        assert job.source_kind == "pdf-document"

        pdf_path.unlink()
        session.delete(document)
        session.commit()
        rerun = job_service.rerun_job(session, job_id=job.id)

    assert rerun.id != job.id
    assert rerun.entity_key == job.entity_key
    assert (import_dir / rerun.id / "source.pdf").exists()
    payload = job_service.serialize_job(rerun)
    assert payload["operation_id"] == rerun.id
    assert payload["source_meta"]["rerun_of"] == job.id
    assert payload["source_meta"]["page_selection"] == [2, 1]


def test_pdf_job_reports_storage_exhaustion_and_removes_incomplete_job(tmp_path, monkeypatch):
    library_dir = tmp_path / "pdf-library"
    library_dir.mkdir()
    import_dir = tmp_path / "import-jobs"
    pdf_path = library_dir / "document.pdf"
    pdf_path.write_bytes(_pdf_bytes())

    from memory_anki.infrastructure.db._tables.misc import PdfDocument

    with Session(engine) as session:
        document = PdfDocument(
            id="pdf-storage-full",
            filename=pdf_path.name,
            original_name="课程.pdf",
            mime_type="application/pdf",
            file_size=pdf_path.stat().st_size,
            page_count=2,
        )
        session.add(document)
        session.commit()

        monkeypatch.setattr(job_service, "IMPORT_JOBS_DIR", import_dir)
        monkeypatch.setattr(mindmap_import_job_api, "IMPORT_JOBS_DIR", import_dir)
        monkeypatch.setattr(mindmap_import_job_api, "PDF_LIBRARY_DIR", library_dir)
        with (
            patch.object(
                mindmap_import_job_api.llm_gateway,
                "prepare_batch_items",
                side_effect=lambda **kwargs: kwargs["image_items"],
            ),
            patch.object(
                mindmap_import_job_api.job_artifacts,
                "write_bytes",
                side_effect=OSError(28, "No space left on device"),
            ),
        ):
            with pytest.raises(MindMapImportError, match="存储空间不足"):
                job_service.create_pdf_import_job(
                    session,
                    entity_key="palace_storage_full",
                    document_id=document.id,
                    page_selection="1-2",
                    mode=job_service.MODE_MINDMAP,
                    fallback_title="PDF 导入",
                    ai_runtime=_ai_runtime(session),
                )

        assert (
            session.query(MindMapImportJob)
            .filter(MindMapImportJob.entity_key == "palace_storage_full")
            .count()
            == 0
        )
        assert not import_dir.exists() or not any(import_dir.iterdir())


@pytest.mark.parametrize(
    'direct_error',
    [
        MindMapImportError('模型返回内容不是有效的脑图 JSON。'),
        RuntimeError('DataInspectionFailed: output rejected'),
    ],
)
@pytest.mark.skip(reason="structure/direct path removed")
def test_invalid_direct_generation_falls_back_to_page_ocr_and_formatter(direct_error):
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
                fallback_title="德国近代教育",
                                ai_runtime=_ai_runtime(session),
            )

    with patch.object(
        job_service,
        "_stream_call_dashscope_batch_json",
        side_effect=direct_error,
    ) as direct_call, patch.object(
        job_service,
        "_stream_call_dashscope_text",
        side_effect=[_stream_return("第斯多惠\n影响"), _stream_return("第四节 俄国近代教育")],
    ) as ocr_call, patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return(
            {
                "title": "德国近代教育",
                "children": [
                    {
                        "text": "第斯多惠",
                        "children": [{"text": "影响", "children": []}],
                    }
                ],
            }
        ),
    ) as formatter_call:
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED, payload
    assert payload["pipeline_strategy"] == "vision_ocr_fallback"
    assert payload["fallback_reason"] == str(direct_error)
    assert [item["page_number"] for item in payload["ocr_pages"]] == [1, 2]
    assert payload["result"]["source_tree"]["children"][0]["text"] == "第斯多惠"
    assert direct_call.call_count == 1
    assert ocr_call.call_count == 2
    assert formatter_call.call_count == 1


def test_ocr_resume_reuses_successful_page_artifact():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
                fallback_title="德国近代教育",
                                ai_runtime=_ai_runtime(session),
            )
    artifact_dir = job_service.get_job_artifact_dir(job.id)
    (artifact_dir / "ocr").mkdir(parents=True, exist_ok=True)
    (artifact_dir / "ocr" / "page-1.txt").write_text("已保存第一页", encoding="utf-8")

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("第二页"),
    ) as ocr_call, patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return(
            {"title": "德国近代教育", "children": [{"text": "内容", "children": []}]}
        ),
    ):
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED, payload
    assert ocr_call.call_count == 1
    assert payload["ocr_pages"][0]["reused"] is True
    assert payload["ocr_pages"][1]["reused"] is False

@pytest.mark.skip(reason="structure/direct path removed")
def test_ocr_role_model_skips_direct_generation():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"page-1", "page-1.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"page-1", "page-1.png")],
                fallback_title="德国近代教育",
                                ai_runtime=_ai_runtime(session),
                vision_ai_options=AiRuntimeOptions(model="qwen3.5-ocr"),
            )

    with patch.object(job_service, "_stream_call_dashscope_batch_json") as direct_call, patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("第斯多惠\n影响"),
    ) as ocr_call, patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return(
            {"title": "德国近代教育", "children": [{"text": "第斯多惠—影响", "children": []}]}
        ),
    ) as formatter_call:
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED
    assert payload["pipeline_strategy"] == "ocr_first"
    assert direct_call.call_count == 0
    assert ocr_call.call_count == 1
    assert formatter_call.call_count == 1
    assert payload["vision_resolved_ai"]["vision_processing_role"] == "ocr_extraction"


def test_extract_then_format_is_default_batch_pipeline():
    with patch.object(
        job_service,
        "_prepare_batch_image_items",
        return_value=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
    ):
        with Session(engine) as session:
            job = job_service.create_batch_import_job(
                session,
                entity_key="palace_1",
                image_items=[(b"page-1", "page-1.png"), (b"page-2", "page-2.png")],
                fallback_title="德国近代教育",
                ai_runtime=_ai_runtime(session),
            )

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        side_effect=[_stream_return("第斯多惠"), _stream_return("影响")],
    ) as ocr_call, patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return(
            {
                "title": "德国近代教育",
                "children": [{"text": "第斯多惠", "children": [{"text": "影响", "children": []}]}],
            }
        ),
    ) as formatter_call:
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED, payload
    assert payload["pipeline_strategy"] == "extract_then_format"
    assert ocr_call.call_count == 2
    assert formatter_call.call_count == 1
