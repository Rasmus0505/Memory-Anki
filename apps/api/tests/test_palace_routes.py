"""Direct tests for the palaces presentation router."""

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.backups.application.backup_palace_versions import (
    create_palace_version,
)
from memory_anki.modules.backups.presentation import router as backups_router
from memory_anki.modules.mindmap.application.editor_state_documents import (
    EDITOR_FINGERPRINT_KEY,
)
from memory_anki.modules.palaces.presentation import router as palace_router


def editor_doc(text: str = "T") -> dict:
    return {
        "root": {
            "data": {"text": text, "memoryAnkiRootKind": "palace"},
            "children": [{"data": {"text": "Child Text", "uid": "child-1"}, "children": []}],
        }
    }


def assert_http_error(response, status_code: int = 404, message: str = "not found"):
    assert response.status_code == status_code
    assert response.json()["detail"] == message


def assert_missing(response):
    assert_http_error(response)


def create_palace(client, title: str = "Test Palace") -> int:
    response = client.post(
        "/api/v1/palaces",
        json={
            "title": title,
            "description": "desc",
            "pegs": [{"name": "Peg A", "content": "Content A"}],
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


def create_segment(client, palace_id: int, name: str = "Segment 1") -> int:
    response = client.post(
        f"/api/v1/palaces/{palace_id}/segments",
        json={"name": name, "node_uids": []},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["item"]["name"] == name
    return body["item"]["id"]


def upload_attachment(client, palace_id: int) -> tuple[int, str]:
    response = client.post(
        f"/api/v1/palaces/{palace_id}/upload",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    return body["id"], body["filename"]


def seed_version(session_factory, palace_id: int, title: str = "Versioned Palace") -> int:
    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace is not None
        palace.title = title
        palace.editor_doc = palace.editor_doc or ""
        version = create_palace_version(session, palace, "editor_save")
        session.commit()
        return version.id


@pytest.fixture(autouse=True)
def _no_rolling_backup(monkeypatch):
    monkeypatch.setattr(
        palace_router,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )


@pytest.fixture()
def client(make_client):
    return make_client(palace_router, backups_router)


@pytest.fixture()
def palace_id(client) -> int:
    return create_palace(client, "Test Palace")


class TestPalaceCrud:
    def test_create_returns_palace_json(self, client):
        response = client.post(
            "/api/v1/palaces",
            json={"title": "New Palace", "description": "", "pegs": []},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "New Palace"
        assert isinstance(body["id"], int)

    def test_list_contains_created_palace(self, client, palace_id):
        response = client.get("/api/v1/palaces")

        assert response.status_code == 200
        assert any(item["id"] == palace_id for item in response.json())

    def test_list_search_filters_by_title(self, client, palace_id):
        assert client.get("/api/v1/palaces", params={"search": "Test Palace"}).json()
        assert client.get("/api/v1/palaces", params={"search": "no-such-title"}).json() == []

    def test_get_detail(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}")

        assert response.status_code == 200
        assert response.json()["title"] == "Test Palace"

    def test_get_missing_returns_error_payload(self, client):
        assert_missing(client.get("/api/v1/palaces/99999"))

    def test_update_title(self, client, palace_id):
        response = client.put(
            f"/api/v1/palaces/{palace_id}",
            json={"title": "Renamed Palace"},
        )

        assert response.status_code == 200
        assert response.json()["title"] == "Renamed Palace"

    def test_update_missing_returns_error_payload(self, client):
        assert_missing(client.put("/api/v1/palaces/99999", json={"title": "x"}))

    def test_delete_then_get_reports_missing(self, client, palace_id):
        assert client.delete(f"/api/v1/palaces/{palace_id}").json() == {"ok": True}
        assert_missing(client.get(f"/api/v1/palaces/{palace_id}"))

    def test_delete_hides_from_list_and_restore_recovers(self, client, session_factory, palace_id):
        assert client.delete(f"/api/v1/palaces/{palace_id}").json() == {"ok": True}

        list_response = client.get("/api/v1/palaces")
        deleted_response = client.get("/api/v1/palaces/deleted")
        with session_factory() as session:
            retained = session.get(Palace, palace_id)

        assert retained is not None
        assert retained.deleted_at is not None
        assert all(item["id"] != palace_id for item in list_response.json())
        assert any(item["id"] == palace_id for item in deleted_response.json()["items"])

        restore_response = client.post(f"/api/v1/palaces/{palace_id}/restore")

        assert restore_response.status_code == 200
        assert restore_response.json()["id"] == palace_id
        assert any(item["id"] == palace_id for item in client.get("/api/v1/palaces").json())
        assert all(
            item["id"] != palace_id
            for item in client.get("/api/v1/palaces/deleted").json()["items"]
        )


class TestPalaceGroupedLists:
    def test_grouped_shape(self, client, palace_id):
        body = client.get("/api/v1/palaces/grouped").json()

        assert set(body) == {"groups", "ungrouped", "subjects"}

    def test_grouped_summary_shape(self, client, palace_id):
        body = client.get("/api/v1/palaces/grouped-summary").json()

        assert set(body) == {"groups", "ungrouped", "subjects"}

    def test_subject_shelf_returns_payload(self, client, palace_id):
        response = client.get("/api/v1/palaces/subjects")

        assert response.status_code == 200
        assert isinstance(response.json(), dict)


class TestPalaceEditor:
    def test_get_editor_returns_palace_and_state(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}/editor")

        assert response.status_code == 200
        body = response.json()
        assert body["palace"]["id"] == palace_id
        assert "editor_doc" in body
        assert EDITOR_FINGERPRINT_KEY in body

    def test_get_editor_missing(self, client):
        assert_missing(client.get("/api/v1/palaces/99999/editor"))

    def test_put_editor_saves_doc(self, client, palace_id):
        response = client.put(
            f"/api/v1/palaces/{palace_id}/editor",
            json={"editor_source": "palace_edit", "editor_doc": editor_doc("Saved Text")},
        )

        assert response.status_code == 200
        saved = client.get(f"/api/v1/palaces/{palace_id}/editor").json()
        assert saved["editor_doc"]["root"]["children"][0]["data"]["text"] == "Child Text"

    def test_put_editor_invalid_payload_returns_400(self, client, palace_id, monkeypatch):
        def raise_value_error(*args, **kwargs):
            raise ValueError("invalid editor payload")

        monkeypatch.setattr(palace_router, "save_palace_editor_state", raise_value_error)
        response = client.put(
            f"/api/v1/palaces/{palace_id}/editor",
            json={"editor_doc": editor_doc("Invalid")},
        )

        assert response.status_code == 400

    def test_put_editor_conflict_returns_409(self, client, palace_id):
        current = client.get(f"/api/v1/palaces/{palace_id}/editor").json()
        stale_fingerprint = current[EDITOR_FINGERPRINT_KEY]
        first = client.put(
            f"/api/v1/palaces/{palace_id}/editor",
            json={"editor_source": "palace_edit", "editor_doc": editor_doc("First")},
        )
        assert first.status_code == 200

        response = client.put(
            f"/api/v1/palaces/{palace_id}/editor",
            json={
                "editor_source": "palace_edit",
                "expected_editor_fingerprint": stale_fingerprint,
                "editor_doc": editor_doc("Second"),
            },
        )

        assert response.status_code == 409

    def test_focus_session_returns_focus_fields(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}/focus-session")

        assert response.status_code == 200
        body = response.json()
        assert body["focus_node_uids"] == []
        assert body["focus_count"] == 0

    def test_toggle_focus_node(self, client, palace_id):
        focused = client.put(
            f"/api/v1/palaces/{palace_id}/focus-nodes/uid-1",
            json={"focused": True},
        ).json()
        unfocused = client.put(
            f"/api/v1/palaces/{palace_id}/focus-nodes/uid-1",
            json={"focused": False},
        ).json()

        assert focused["focused"] is True
        assert focused["focus_count"] == 1
        assert unfocused["focused"] is False
        assert unfocused["focus_count"] == 0


class TestPalaceTemplates:
    def test_template_lifecycle_and_instantiation(self, client, palace_id):
        save_response = client.put(
            f"/api/v1/palaces/{palace_id}/editor",
            json={
                "editor_source": "palace_edit",
                "editor_doc": editor_doc("Template Root"),
                "editor_config": {"layout": "logicalStructure"},
            },
        )
        assert save_response.status_code == 200

        created = client.post(
            "/api/v1/palace-templates",
            json={
                "palace_id": palace_id,
                "name": "房间桩",
                "description": "常用房间结构",
            },
        )
        assert created.status_code == 200
        template = created.json()["item"]
        assert template["name"] == "房间桩"
        assert template["description"] == "常用房间结构"
        assert template["source_palace_id"] == palace_id

        listed = client.get("/api/v1/palace-templates").json()
        assert listed["items"][0]["id"] == template["id"]

        instantiated = client.post(
            f"/api/v1/palace-templates/{template['id']}/instantiate",
            json={"title": "解剖学第3章"},
        )
        assert instantiated.status_code == 200
        palace = instantiated.json()
        assert palace["title"] == "解剖学第3章"
        assert palace["description"] == "由模板「房间桩」创建"

        editor = client.get(f"/api/v1/palaces/{palace['id']}/editor").json()
        assert editor["editor_doc"]["root"]["data"]["text"] == "解剖学第3章"
        assert editor["editor_doc"]["root"]["children"][0]["data"]["text"] == "Child Text"

        deleted = client.delete(f"/api/v1/palace-templates/{template['id']}")
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}
        assert client.get("/api/v1/palace-templates").json() == {"items": []}

        missing = client.post(
            f"/api/v1/palace-templates/{template['id']}/instantiate",
            json={"title": "x"},
        )
        assert missing.status_code == 400
        assert missing.json()["detail"] == "模板不存在。"

    def test_create_template_from_empty_palace_returns_400(self, client, palace_id):
        response = client.post(
            "/api/v1/palace-templates",
            json={"palace_id": palace_id, "name": "空白"},
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "这个宫殿还没有思维导图内容，无法存为模板。"


class TestPalaceSegments:
    def test_list_segments_contains_default(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}/segments")

        assert response.status_code == 200
        assert isinstance(response.json()["items"], list)

    def test_create_segment(self, client, palace_id):
        segment_id = create_segment(client, palace_id, "Segment A")

        assert isinstance(segment_id, int)

    def test_get_segment_detail(self, client, palace_id):
        segment_id = create_segment(client, palace_id)
        response = client.get(f"/api/v1/palace-segments/{segment_id}")

        assert response.status_code == 200
        body = response.json()
        assert body["item"]["id"] == segment_id
        assert body["palace"]["id"] == palace_id
        assert "editor_doc" in body

    def test_update_segment(self, client, palace_id):
        segment_id = create_segment(client, palace_id)
        response = client.put(
            f"/api/v1/palace-segments/{segment_id}",
            json={"name": "Renamed Segment"},
        )

        assert response.status_code == 200
        assert response.json()["item"]["name"] == "Renamed Segment"

    def test_delete_segment(self, client, palace_id):
        segment_id = create_segment(client, palace_id)

        assert client.delete(f"/api/v1/palace-segments/{segment_id}").json() == {"ok": True}
        assert_missing(client.get(f"/api/v1/palace-segments/{segment_id}"))

    def test_segment_missing_branches(self, client):
        assert_missing(client.get("/api/v1/palace-segments/99999"))
        assert_missing(client.put("/api/v1/palace-segments/99999", json={"name": "x"}))
        assert_missing(client.delete("/api/v1/palace-segments/99999"))


class TestPalaceVersions:
    def test_list_versions(self, client, session_factory, palace_id):
        seed_version(session_factory, palace_id)

        response = client.get(f"/api/v1/palaces/{palace_id}/versions")

        assert response.status_code == 200
        body = response.json()
        assert body["palace_title"] == "Versioned Palace"
        assert body["versions"]

    def test_version_detail(self, client, session_factory, palace_id):
        version_id = seed_version(session_factory, palace_id)
        response = client.get(f"/api/v1/palaces/{palace_id}/versions/{version_id}")

        assert response.status_code == 200
        assert response.json()["id"] == version_id

    def test_version_detail_missing(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}/versions/99999")

        assert_http_error(response, message="version not found")

    def test_restore_version(self, client, session_factory, palace_id):
        version_id = seed_version(session_factory, palace_id, "Restore Target")
        response = client.post(
            f"/api/v1/palaces/{palace_id}/restore-version",
            json={"version_id": version_id},
        )

        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_restore_version_invalid_id(self, client, palace_id):
        response = client.post(
            f"/api/v1/palaces/{palace_id}/restore-version",
            json={"version_id": 0},
        )

        assert_http_error(response, status_code=400, message="invalid version id")


class TestPalaceAttachments:
    @pytest.fixture(autouse=True)
    def _attachments_dir(self, monkeypatch, tmp_path):
        monkeypatch.setattr(palace_router, "ATTACHMENTS_DIR", tmp_path)

    def test_upload_attachment(self, client, palace_id, tmp_path):
        att_id, filename = upload_attachment(client, palace_id)

        assert isinstance(att_id, int)
        assert (tmp_path / filename).read_bytes() == b"hello"

    def test_upload_to_missing_palace(self, client):
        response = client.post(
            "/api/v1/palaces/99999/upload",
            files={"file": ("a.txt", b"hello", "text/plain")},
        )

        assert_missing(response)

    def test_download_attachment(self, client, palace_id):
        att_id, _ = upload_attachment(client, palace_id)
        response = client.get(f"/api/v1/attachments/{att_id}")

        assert response.status_code == 200
        assert response.content == b"hello"

    def test_delete_attachment(self, client, palace_id, tmp_path):
        att_id, filename = upload_attachment(client, palace_id)

        response = client.delete(f"/api/v1/attachments/{att_id}")

        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert not (tmp_path / filename).exists()

    def test_attachment_missing(self, client):
        assert_missing(client.get("/api/v1/attachments/99999"))


class TestPracticeSession:
    def test_get_progress_empty(self, client, palace_id):
        response = client.get(f"/api/v1/practice/session/{palace_id}")

        assert response.status_code == 200
        assert response.json() == {"progress": None}

    def test_upsert_then_get_progress(self, client, palace_id):
        payload = {
            "reveal_map": {"uid-1": "revealed"},
            "red_node_ids": ["uid-2"],
            "completed": False,
        }
        response = client.put(f"/api/v1/practice/session/{palace_id}", json=payload)

        assert response.status_code == 200
        assert response.json()["progress"]["reveal_map"] == payload["reveal_map"]
        saved = client.get(f"/api/v1/practice/session/{palace_id}").json()
        assert saved["progress"]["red_node_ids"] == payload["red_node_ids"]

    def test_delete_progress(self, client, palace_id):
        client.put(
            f"/api/v1/practice/session/{palace_id}",
            json={"reveal_map": {"uid-1": "revealed"}},
        )

        assert client.delete(f"/api/v1/practice/session/{palace_id}").json() == {"ok": True}
        assert client.get(f"/api/v1/practice/session/{palace_id}").json() == {"progress": None}

    def test_progress_missing_palace(self, client):
        assert_missing(client.get("/api/v1/practice/session/99999"))
        assert_missing(client.put("/api/v1/practice/session/99999", json={}))


class TestPalaceMisc:
    def test_review_plan_main_and_missing(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}/review-plan")

        assert response.status_code == 200
        assert response.json()["palace_id"] == palace_id
        assert_missing(client.get("/api/v1/palaces/99999/review-plan"))

    def test_practice_flag_sets_needs_practice(self, client, palace_id):
        response = client.put(
            f"/api/v1/palaces/{palace_id}/practice-flag",
            json={"needs_practice": True},
        )

        assert response.status_code == 200
        assert response.json()["item"]["needs_practice"] is True

    def test_practice_flag_missing(self, client):
        assert_missing(client.put("/api/v1/palaces/99999/practice-flag", json={}))

    def test_archive_endpoint_returns_current_router_behavior(self, client, palace_id):
        response = client.put(f"/api/v1/palaces/{palace_id}/archive", json={"archived": True})

        assert response.status_code == 200
        assert response.json() == {"ok": True, "archived": False}

    def test_archive_missing(self, client):
        assert_missing(client.put("/api/v1/palaces/99999/archive", json={"archived": True}))

    def test_list_backups_uses_router_hook(self, client, monkeypatch):
        monkeypatch.setattr(backups_router, "list_backups", lambda: [])

        response = client.get("/api/v1/backups")

        assert response.status_code == 200
        assert response.json() == {"items": []}
