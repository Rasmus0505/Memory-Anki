import base64
import copy

import pytest
from pydantic import ValidationError

from memory_anki.infrastructure.db._tables.palaces import Attachment, Palace
from memory_anki.modules.content.application.article_package import (
    ArticleTransferCommand,
    apply_article_transfer,
    document_nodes,
    export_article_package,
    remap_document,
)
from memory_anki.modules.content.application.editor_state_service import EditorStateConflictError
from memory_anki.modules.content.infrastructure.article_package_transaction import (
    ArticlePackageParticipant,
)
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork


def doc():
    return {"schemaVersion": 1, "root": {"data": {"uid": "root", "text": "Title", "memoryAnkiId": 800}, "children": [{"data": {"uid": "child", "text": "Body", "memoryAnkiId": 900}}]}}


def run(session, tmp_path, mode="create", palace_id=None, **values):
    return apply_article_transfer(session, ArticleTransferCommand(mode=mode, owner_id=f"palace:{palace_id}" if palace_id else "new:article", operation_id="op", document=values.pop("document", doc()), **values), palace_id=palace_id, attachments_dir=tmp_path, participant=ArticlePackageParticipant(session), uow=SqlAlchemyUnitOfWork(session))


def test_remap_never_trusts_numeric_projection_ids():
    source = doc()
    result, mapping = remap_document(source, fresh=True)
    assert set(mapping) == {"root", "child"}
    assert not set(mapping).intersection(mapping.values())
    assert all("memoryAnkiId" not in node["data"] for node in document_nodes(result).values())
    assert source == doc()
    with pytest.raises(ValueError, match="unique"):
        invalid = doc()
        invalid["root"]["children"][0]["data"]["uid"] = "root"
        document_nodes(invalid)


def test_create_append_update_and_stale_guard(db_session, tmp_path):
    created = run(db_session, tmp_path)
    target = created["palace_id"]
    assert len(document_nodes(created["editor_doc"])) == 2
    root = created["editor_doc"]["root"]["data"]["uid"]
    appended = run(db_session, tmp_path, "append", target, expected_revision=created["editor_fingerprint"], parent_uid=root)
    assert len(document_nodes(appended["editor_doc"])) == 4
    assert appended["uid_map"] != created["uid_map"]
    with pytest.raises(EditorStateConflictError):
        run(db_session, tmp_path, "append", target, expected_revision=created["editor_fingerprint"], parent_uid=root)
    package = export_article_package(db_session, target)
    changed = copy.deepcopy(package["document"])
    changed["root"]["children"][0]["data"]["text"] = "Revised"
    updated = run(db_session, tmp_path, "update", target, document=changed, source_owner=package["source_owner"], base_revision=package["base_revision"], expected_revision=package["base_revision"], confirm_replace=True, quiz=package["quiz"])
    assert set(document_nodes(updated["editor_doc"])) == set(document_nodes(changed))
    assert updated["editor_fingerprint"] != package["base_revision"]


def test_replace_confirmation_owner_and_revision_are_mandatory(db_session, tmp_path):
    created = run(db_session, tmp_path)
    target = created["palace_id"]
    with pytest.raises(ValueError, match="confirmation"):
        run(db_session, tmp_path, "replace", target, expected_revision=created["editor_fingerprint"])
    with pytest.raises(ValueError, match="source owner"):
        run(db_session, tmp_path, "update", target, confirm_replace=True, expected_revision=created["editor_fingerprint"], source_owner="palace:999", base_revision=created["editor_fingerprint"])
    with pytest.raises(ValueError, match="revision is mandatory"):
        run(db_session, tmp_path, "replace", target, confirm_replace=True)
    with pytest.raises(ValidationError):
        ArticleTransferCommand(mode="create", owner_id="new", operation_id="op", document=doc(), silently_ignored=True)


def test_asset_rollback_removes_created_palace_and_files(db_session, tmp_path, monkeypatch):
    def fail(*args, **kwargs):
        raise ValueError("bad quiz")
    monkeypatch.setattr("memory_anki.modules.content.application.article_package.import_article_quiz", fail)
    asset = {"source": "assets/image.png", "name": "image.png", "media_type": "image/png", "base64": base64.b64encode(b"\x89PNG\r\n\x1a\nfake-test").decode()}
    with pytest.raises(ValueError, match="bad quiz"):
        run(db_session, tmp_path, assets=[asset], quiz={"invalid": True})
    assert db_session.query(Palace).count() == 0
    assert db_session.query(Attachment).count() == 0
    assert list(tmp_path.iterdir()) == []


def test_assets_are_rebound_into_new_palace(db_session, tmp_path):
    incoming = doc()
    incoming["root"]["data"]["image"] = "assets/image.png"
    asset = {"source": "assets/image.png", "name": "image.png", "media_type": "image/png", "base64": base64.b64encode(b"\x89PNG\r\n\x1a\nfake-test").decode()}
    result = run(db_session, tmp_path, document=incoming, assets=[asset])
    attachment = db_session.query(Attachment).one()
    assert attachment.palace_id == result["palace_id"]
    assert result["editor_doc"]["root"]["data"]["image"] == f"/api/v1/attachments/{attachment.id}"
    assert (tmp_path / attachment.filename).exists()


def test_foreign_attachment_without_payload_is_rejected(db_session, tmp_path):
    incoming = doc()
    incoming["root"]["data"]["image"] = "/api/v1/attachments/999"
    with pytest.raises(ValueError, match="Foreign attachment"):
        run(db_session, tmp_path, document=incoming)
    assert db_session.query(Palace).count() == 0
