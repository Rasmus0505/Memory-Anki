from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from memory_anki.infrastructure.db._tables.batch_generation import (
    BatchGenerationAsset,
    BatchGenerationBook,
    BatchGenerationSection,
    BatchGenerationStep,
    BatchGenerationWorkspace,
)
from memory_anki.modules.batch_generation.application.workspace_service import BatchWorkspaceService


def _pdf(path: Path) -> None:
    document = fitz.open()
    first = document.new_page()
    first.insert_text((72, 72), "第一章 教育起源\n第一节 学校产生\n" + "教材正文 " * 30)
    second = document.new_page()
    second.insert_text((72, 72), "第二节 古代教育\n" + "更多教材内容 " * 30)
    document.new_page()
    document.save(path)
    document.close()


def test_pdf_analysis_creates_persistent_outline_and_mixed_profile(db_session, tmp_path) -> None:
    source = tmp_path / "外国教育史.pdf"
    _pdf(source)
    service = BatchWorkspaceService(db_session)
    workspace = service.create_workspace("整书测试")
    snapshot = service.add_pdf(workspace["id"], source, "textbook")

    assert snapshot["assets"][0]["page_count"] == 3
    assert snapshot["assets"][0]["analysis"]["pdf_profile"] == "mixed"
    assert snapshot["books"][0]["sections"]
    assert snapshot["books"][0]["sections"][0]["start_page"] == 1


def test_outline_edit_invalidates_steps_and_rejects_stale_draft(db_session, tmp_path) -> None:
    source = tmp_path / "教材.pdf"
    _pdf(source)
    service = BatchWorkspaceService(db_session)
    workspace_id = service.create_workspace("失效测试")["id"]
    snapshot = service.add_pdf(workspace_id, source, "textbook")
    section = snapshot["books"][0]["sections"][0]
    old_operation = section["operation_id"]
    db_session.add(BatchGenerationStep(id="step-1", section_id=section["id"], kind="palace", status="ready", operation_id=old_operation))
    db_session.commit()

    updated = service.update_section(section["id"], {"end_page": 2}, section["revision"])

    assert updated["revision"] == section["revision"] + 1
    assert db_session.get(BatchGenerationStep, "step-1").status == "stale"
    with pytest.raises(RuntimeError, match="stale operation"):
        service.save_draft(section["id"], "palace", {"nodes": []}, old_operation)


def test_representative_gate_prompt_preview_and_publish_conflict(db_session, tmp_path) -> None:
    source = tmp_path / "教材.pdf"
    _pdf(source)
    service = BatchWorkspaceService(db_session)
    workspace_id = service.create_workspace("闸门测试")["id"]
    snapshot = service.add_pdf(workspace_id, source, "textbook")
    book = snapshot["books"][0]
    section = book["sections"][0]

    gated = service.confirm_outline(book["id"], section["id"])
    assert gated["books"][0]["gate_status"] == "representative_ready"
    preview = service.prompt_preview(section["id"], "palace", "qwen3-vl-flash", "system", "user")
    assert preview["input"]["section"]["pages"] == [section["start_page"], section["end_page"]]
    assert preview["estimated_input_tokens"] > 0

    service.save_draft(section["id"], "palace", {}, section["operation_id"])
    plan = service.build_publish_plan(workspace_id)
    assert plan["status"] == "blocked"
    assert plan["conflicts"][0]["reason"] == "unresolved_quality_issues"


def test_delete_workspace_removes_rows_and_asset_directory(db_session, tmp_path, monkeypatch) -> None:
    asset_root = tmp_path / "batch_generation"
    monkeypatch.setattr(
        "memory_anki.modules.batch_generation.application.workspace_service.APP_HOME",
        tmp_path,
    )
    monkeypatch.setattr(
        "memory_anki.modules.batch_generation.application.workspace_service.ASSET_ROOT",
        asset_root,
    )
    source = tmp_path / "待删除教材.pdf"
    _pdf(source)
    service = BatchWorkspaceService(db_session)
    workspace_id = service.create_workspace("删除测试")["id"]
    snapshot = service.add_pdf(workspace_id, source, "textbook")
    book_id = snapshot["books"][0]["id"]
    section_id = snapshot["books"][0]["sections"][0]["id"]
    asset_id = snapshot["assets"][0]["id"]
    workspace_dir = asset_root / workspace_id

    result = service.delete_workspace(workspace_id)

    assert result == {"id": workspace_id, "deleted": True}
    assert not workspace_dir.exists()
    assert db_session.get(BatchGenerationWorkspace, workspace_id) is None
    assert db_session.get(BatchGenerationAsset, asset_id) is None
    assert db_session.get(BatchGenerationBook, book_id) is None
    assert db_session.get(BatchGenerationSection, section_id) is None
    with pytest.raises(KeyError, match="workspace not found"):
        service.delete_workspace(workspace_id)


def test_delete_workspace_rejects_asset_path_outside_root(db_session, tmp_path, monkeypatch) -> None:
    workspace_id = "../outside"
    db_session.add(
        BatchGenerationWorkspace(
            id=workspace_id,
            title="非法路径测试",
            operation_id="operation-id",
            settings_json="{}",
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "memory_anki.modules.batch_generation.application.workspace_service.ASSET_ROOT",
        tmp_path / "batch_generation",
    )
    service = BatchWorkspaceService(db_session)

    with pytest.raises(RuntimeError, match="invalid workspace asset path"):
        service.delete_workspace(workspace_id)

    assert db_session.get(BatchGenerationWorkspace, workspace_id) is not None