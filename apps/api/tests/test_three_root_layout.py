from pathlib import Path

from memory_anki.core import migration


def test_three_root_layout_moves_legacy_tree(tmp_path: Path, monkeypatch) -> None:
    app_home = tmp_path / "home"
    learning = app_home / "学习数据"
    attachments = app_home / "学科附件"
    cache = app_home / "日志缓存"
    (app_home / "data" / "attachments" / "subjects" / "4").mkdir(parents=True)
    (app_home / "data" / "memory_palace.db").write_bytes(b"db")
    (app_home / "data" / "attachments" / "subjects" / "4" / "a.pdf").write_bytes(b"pdf")
    (app_home / "english").mkdir()
    (app_home / "english" / "note.txt").write_text("e", encoding="utf-8")
    (app_home / "ai_call_logs").mkdir()
    (app_home / "ai_call_logs" / "x.log").write_text("l", encoding="utf-8")
    (app_home / "pdf_library").mkdir()
    (app_home / "pdf_library" / "book.pdf").write_bytes(b"book")

    monkeypatch.setattr(migration, "APP_HOME", app_home)
    monkeypatch.setattr(migration, "LEARNING_DIR", learning)
    monkeypatch.setattr(migration, "SUBJECT_ATTACHMENTS_DIR", attachments)
    monkeypatch.setattr(migration, "CACHE_DIR", cache)
    monkeypatch.setattr(migration, "MIGRATION_STATE_PATH", app_home / "migration-state.json")

    migration.ensure_three_root_layout_migrated()

    assert (learning / "memory_palace.db").read_bytes() == b"db"
    assert (learning / "english" / "note.txt").read_text(encoding="utf-8") == "e"
    assert (attachments / "subjects" / "4" / "a.pdf").read_bytes() == b"pdf"
    assert (attachments / "pdf_library" / "book.pdf").read_bytes() == b"book"
    assert (cache / "ai_call_logs" / "x.log").read_text(encoding="utf-8") == "l"
    assert not (app_home / "data").exists()
    assert migration.is_app_migration_completed(migration.THREE_ROOT_LAYOUT_MIGRATION_KEY)


def test_three_root_layout_does_not_overwrite_existing_dest(tmp_path: Path, monkeypatch) -> None:
    app_home = tmp_path / "home"
    learning = app_home / "学习数据"
    attachments = app_home / "学科附件"
    cache = app_home / "日志缓存"
    learning.mkdir(parents=True)
    (learning / "memory_palace.db").write_bytes(b"new")
    (app_home / "data").mkdir()
    (app_home / "data" / "memory_palace.db").write_bytes(b"old")

    monkeypatch.setattr(migration, "APP_HOME", app_home)
    monkeypatch.setattr(migration, "LEARNING_DIR", learning)
    monkeypatch.setattr(migration, "SUBJECT_ATTACHMENTS_DIR", attachments)
    monkeypatch.setattr(migration, "CACHE_DIR", cache)
    monkeypatch.setattr(migration, "MIGRATION_STATE_PATH", app_home / "migration-state.json")

    migration.ensure_three_root_layout_migrated()

    assert (learning / "memory_palace.db").read_bytes() == b"new"
    assert (app_home / "data" / "memory_palace.db").read_bytes() == b"old"
