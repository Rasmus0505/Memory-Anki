from pathlib import Path

from tools import check_architecture


def test_article_reading_boundary_rejects_document_writes_and_get_commits(tmp_path, monkeypatch):
    monkeypatch.setattr(check_architecture, "API_SRC", tmp_path / "api")
    monkeypatch.setattr(check_architecture, "WEB_SRC", tmp_path / "web")
    files = {
        "api/modules/content/application/article_reading.py": "def get_article_reading(store):\n    store.commit()\n",
        "api/modules/content/infrastructure/article_reading_store.py": "# article.reading.\n",
        "web/modules/content/api/articleReadingApi.ts": "savePalaceEditor()",
        "web/modules/content/ui/mindmap-editor/article/useArticleReadingProgress.ts": "invalidateQueries()",
    }
    for relative, source in files.items():
        path: Path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    errors: list[str] = []
    check_architecture.check_article_reading_cursor_boundary(errors)
    assert any("read-only" in error for error in errors)
    assert any("savePalaceEditor" in error for error in errors)
    assert any("invalidateQueries" in error for error in errors)
    assert any("offline replay" in error for error in errors)


def test_real_article_reading_boundary():
    errors: list[str] = []
    check_architecture.check_article_reading_cursor_boundary(errors)
    assert errors == []
