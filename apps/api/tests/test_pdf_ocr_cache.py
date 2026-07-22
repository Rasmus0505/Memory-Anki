from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import Base, engine
from memory_anki.infrastructure.db._tables.misc import MindMapImportJob
from memory_anki.modules.pdf_library import ocr_cache
from memory_anki.modules.produce.application import mindmap_import_job_service as job_service
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog
from memory_anki.platform.application import AiRuntimeOptions


def _ai_runtime(session: Session | None = None) -> SettingsAiRuntimeProvider:
    return SettingsAiRuntimeProvider(session)


def _prompt_catalog(session: Session | None = None) -> SettingsPromptCatalog:
    return SettingsPromptCatalog(session)


def _stream_return(value):
    if False:
        yield None
    return value


def _load_job(job_id: str) -> dict:
    with Session(engine) as session:
        job = job_service.get_job(session, job_id)
        assert job is not None
        return job_service.serialize_job(job)


def test_document_ocr_cache_roundtrip(tmp_path: Path):
    ocr_cache.write_cached_page(
        "doc-a",
        3,
        "第三页正文",
        model="qwen3.5-ocr",
        source_job_id="job-1",
        cache_dir=tmp_path,
    )
    hit = ocr_cache.read_cached_page("doc-a", 3, cache_dir=tmp_path)
    assert hit is not None
    text, meta = hit
    assert text == "第三页正文"
    assert meta["model"] == "qwen3.5-ocr"
    coverage = ocr_cache.list_document_ocr_coverage("doc-a", cache_dir=tmp_path)
    assert [item["page_number"] for item in coverage] == [3]


@pytest.fixture()
def isolate_jobs_and_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(job_service, "IMPORT_JOBS_DIR", tmp_path / "jobs")
    cache_dir = tmp_path / "ocr-cache"
    monkeypatch.setattr(ocr_cache, "PDF_OCR_CACHE_DIR", cache_dir)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.query(MindMapImportJob).delete()
        session.commit()
    yield cache_dir
    with Session(engine) as session:
        session.query(MindMapImportJob).delete()
        session.commit()


def test_ocr_reuses_document_cache_across_jobs(isolate_jobs_and_cache):
    cache_dir = isolate_jobs_and_cache
    ocr_cache.write_cached_page(
        "pdf-shared",
        1,
        "来自全局缓存的第一页",
        model="qwen3.5-ocr",
        source_job_id="seed",
        cache_dir=cache_dir,
    )

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
                fallback_title="俄国近代教育",
                ai_runtime=_ai_runtime(session),
                vision_ai_options=AiRuntimeOptions(model="qwen3.5-ocr"),
            )

    artifact_dir = job_service.get_job_artifact_dir(job.id)
    with Session(engine) as session:
        job_row = job_service.get_job(session, job.id)
        assert job_row is not None
        source_meta = json.loads(job_row.source_meta_json)
        source_meta["pdf_document_id"] = "pdf-shared"
        source_meta["page_selection"] = [1, 2]
        job_row.source_meta_json = json.dumps(source_meta, ensure_ascii=False)
        session.commit()
    (artifact_dir / "source_meta.json").write_text(
        json.dumps(source_meta, ensure_ascii=False),
        encoding="utf-8",
    )

    with patch.object(
        job_service,
        "_stream_call_dashscope_text",
        return_value=_stream_return("第二页新识别"),
    ) as ocr_call, patch.object(
        job_service,
        "_stream_call_formatter_json",
        return_value=_stream_return(
            {"title": "俄国近代教育", "children": [{"text": "内容", "children": []}]}
        ),
    ):
        job_service._run_job_worker(job.id, ai_runtime=_ai_runtime(), prompt_catalog=_prompt_catalog())

    payload = _load_job(job.id)
    assert payload["status"] == job_service.JOB_STATUS_COMPLETED, payload
    assert ocr_call.call_count == 1
    assert payload["ocr_pages"][0]["reused"] is True
    assert payload["ocr_pages"][0].get("reuse_source") == "document_cache"
    assert payload["ocr_pages"][1]["reused"] is False
    assert "来自全局缓存的第一页" in (artifact_dir / "ocr" / "page-1.txt").read_text(encoding="utf-8")
    hit = ocr_cache.read_cached_page("pdf-shared", 2, cache_dir=cache_dir)
    assert hit is not None
    assert hit[0] == "第二页新识别"
