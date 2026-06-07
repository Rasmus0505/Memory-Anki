from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, ExternalAiCallLog
from memory_anki.infrastructure.llm import external_ai_call_logs
from memory_anki.modules.palaces.application.mindmap_import import runtime


def test_runtime_creates_persistent_ai_call_log_for_import(monkeypatch, tmp_path: Path):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(test_engine)
    monkeypatch.setattr(external_ai_call_logs, "engine", test_engine)
    monkeypatch.setattr(external_ai_call_logs, "AI_CALL_LOGS_DIR", tmp_path / "ai_call_logs")

    def fake_stream_chat_completion_text(**kwargs):
        if False:
            yield ""
        return '{"title":"第一章","children":[{"text":"重点","children":[]}]}'

    monkeypatch.setattr(runtime, "stream_chat_completion_text", fake_stream_chat_completion_text)

    result = runtime.call_dashscope_json(
        runtime=runtime.DashscopeImportRuntime(
            api_key="test-key",
            base_url="https://dashscope.test/v1",
            model="qwen3-vl-flash",
        ),
        image_bytes=b"fake-image",
        filename="demo.png",
        external_log_context={
            "feature": "图片转脑图",
            "operation": "single_image_structure",
            "job_id": "job-1",
        },
    )

    assert result["title"] == "第一章"

    with Session(test_engine) as session:
        row = session.query(ExternalAiCallLog).filter_by(job_id="job-1").one()
        assert row.feature == "图片转脑图"
        assert row.operation == "single_image_structure"
        assert row.status == "success"
        assert "思维导图识别助手" in row.request_json
        assert "第一章" in row.response_json
