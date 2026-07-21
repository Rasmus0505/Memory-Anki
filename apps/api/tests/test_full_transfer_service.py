from __future__ import annotations

import io
import json
import zipfile

import pytest
from sqlalchemy import text

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.backups.application import full_transfer_service
from memory_anki.modules.palaces.presentation import import_router


def _create_alembic_revision(session, revision: str = "test_revision") -> None:
    session.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
    session.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
        {"revision": revision},
    )
    session.commit()


@pytest.fixture()
def transfer_env(tmp_path, monkeypatch):
    attachments = tmp_path / "attachments"
    attachments.mkdir()
    monkeypatch.setattr(full_transfer_service, "ATTACHMENTS_DIR", attachments)
    return attachments


def test_build_full_archive_contains_manifest_data_and_attachments(db_session, transfer_env):
    _create_alembic_revision(db_session)
    palace = Palace(title="Alpha")
    db_session.add(palace)
    (transfer_env / "image.txt").write_text("attachment", encoding="utf-8")
    db_session.commit()

    archive_bytes, filename = full_transfer_service.build_full_archive(db_session)

    assert filename.startswith("memory-anki-full-")
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        manifest = json.loads(archive.read("manifest.json"))
        data = json.loads(archive.read("data.json"))
    assert "data.json" in names
    assert "attachments/image.txt" in names
    assert manifest["table_counts"]["palaces"] == 1
    assert data["palaces"][0]["title"] == "Alpha"


def test_import_full_archive_replaces_tables_and_attachments(db_session, transfer_env):
    _create_alembic_revision(db_session)
    source_palace = Palace(title="Source")
    db_session.add(source_palace)
    (transfer_env / "keep.txt").write_text("new", encoding="utf-8")
    db_session.commit()
    archive_bytes, _ = full_transfer_service.build_full_archive(db_session)

    bind = db_session.get_bind()
    db_session.close()
    dirty_session = db_session.__class__(bind=bind)
    dirty_session.query(Palace).delete()
    dirty_session.add(Palace(title="Old"))
    (transfer_env / "stale.txt").write_text("old", encoding="utf-8")
    dirty_session.commit()

    result = full_transfer_service.import_full_archive(archive_bytes, dirty_session)

    assert result["table_counts"]["palaces"] == 1
    assert result["restored_attachments"] == 1
    replacement_session = db_session.__class__(bind=bind)
    try:
        assert replacement_session.query(Palace).one().title == "Source"
    finally:
        replacement_session.close()
    assert (transfer_env / "keep.txt").read_text(encoding="utf-8") == "new"
    assert not (transfer_env / "stale.txt").exists()


def test_import_full_archive_ignores_attachment_path_traversal(db_session, transfer_env, tmp_path):
    _create_alembic_revision(db_session)
    archive_bytes, _ = full_transfer_service.build_full_archive(db_session)
    source = io.BytesIO(archive_bytes)
    target = io.BytesIO()
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w") as modified:
        for item in original.infolist():
            modified.writestr(item, original.read(item.filename))
        modified.writestr("attachments/../../escape.txt", "bad")

    result = full_transfer_service.import_full_archive(target.getvalue(), db_session)

    assert result["restored_attachments"] == 0
    assert not (tmp_path / "escape.txt").exists()


def test_inspect_archive_rejects_bad_zip(db_session):
    with pytest.raises(full_transfer_service.FullTransferError, match="有效的 zip"):
        full_transfer_service.inspect_archive(b"not a zip", db_session)


def test_import_route_does_not_create_rescue_snapshot_for_bad_zip(make_client, monkeypatch):
    called = False

    def fake_create_rescue_snapshot(reason: str):
        nonlocal called
        called = True
        return reason

    monkeypatch.setattr(import_router, "create_rescue_snapshot", fake_create_rescue_snapshot)
    client = make_client(import_router)

    response = client.post(
        "/api/v1/import/full",
        files={"file": ("bad.zip", b"not a zip", "application/zip")},
    )

    assert response.status_code == 400
    assert "有效的 zip" in response.json()["detail"]
    assert called is False
