from pathlib import Path

import pytest

import check_architecture


def test_article_domain_rejects_editor_runtime_dependency(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(check_architecture, "WEB_SRC", tmp_path)
    monkeypatch.setattr(check_architecture, "API_SRC", tmp_path / "api")
    domain = tmp_path / "modules/content/domain/mindmap-document-entity/model/articleDocument.ts"
    domain.parent.mkdir(parents=True)
    domain.write_text("import { Editor } from '@tiptap/core'", encoding="utf-8")
    errors: list[str] = []
    check_architecture.check_article_workspace_boundary(errors)
    assert any("framework-free" in error for error in errors)


@pytest.mark.parametrize("filename", ["article_transfer.py", "article_package.py"])
def test_scoped_transfer_rejects_whole_library_restore(tmp_path: Path, monkeypatch, filename: str) -> None:
    monkeypatch.setattr(check_architecture, "WEB_SRC", tmp_path / "web")
    monkeypatch.setattr(check_architecture, "API_SRC", tmp_path)
    service = tmp_path / "modules/content/application" / filename
    service.parent.mkdir(parents=True)
    service.write_text("from backups import import_full_archive", encoding="utf-8")
    errors: list[str] = []
    check_architecture.check_article_workspace_boundary(errors)
    assert any("whole-library replacement" in error for error in errors)
