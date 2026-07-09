"""knowledge routes direct coverage for subjects, chapters, and bindings."""
import pytest

from memory_anki.modules.knowledge.application import chapter_service, subject_service
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.palaces.presentation import router as palace_router


@pytest.fixture(autouse=True)
def _no_rolling_backup(monkeypatch):
    monkeypatch.setattr(
        chapter_service,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        subject_service,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        palace_router,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )


@pytest.fixture()
def client(make_client):
    return make_client(knowledge_router)


@pytest.fixture()
def subject_id(client) -> int:
    response = client.post("/api/v1/subjects", json={"name": "数学", "color": "#ff0000"})
    assert response.status_code == 200
    return response.json()["id"]


class TestSubjects:
    def test_create_and_list(self, client, subject_id):
        items = client.get("/api/v1/subjects").json()

        assert any(item["id"] == subject_id and item["name"] == "数学" for item in items)

    def test_update(self, client, subject_id):
        body = client.put(f"/api/v1/subjects/{subject_id}", json={"name": "高数"}).json()

        assert body["name"] == "高数"

    def test_update_missing(self, client):
        response = client.put("/api/v1/subjects/999", json={"name": "x"})

        assert response.status_code == 404
        assert response.json()["detail"] == "not found"

    def test_delete(self, client, subject_id):
        assert client.delete(f"/api/v1/subjects/{subject_id}").json() == {"ok": True}
        assert client.get("/api/v1/subjects").json() == []


class TestChapterTree:
    def test_create_chapter_and_tree(self, client, subject_id):
        chapter = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "第一章"},
        ).json()
        child = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "1.1", "parent_id": chapter["id"]},
        ).json()

        tree = client.get(f"/api/v1/subjects/{subject_id}/tree").json()

        assert tree["subject"]["id"] == subject_id
        assert tree["chapters"][0]["id"] == chapter["id"]
        assert tree["chapters"][0]["children"][0]["id"] == child["id"]

    def test_delete_chapter_cascades(self, client, subject_id):
        chapter = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "第一章"},
        ).json()
        client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "1.1", "parent_id": chapter["id"]},
        )

        assert client.delete(f"/api/v1/chapters/{chapter['id']}").json() == {"ok": True}
        assert client.get(f"/api/v1/subjects/{subject_id}/tree").json()["chapters"] == []

    def test_get_chapter_detail_with_breadcrumbs(self, client, subject_id):
        root = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "祖层"},
        ).json()
        parent = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "父层", "parent_id": root["id"]},
        ).json()
        child = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "孙层", "parent_id": parent["id"]},
        ).json()

        body = client.get(f"/api/v1/chapters/{child['id']}").json()

        assert body["chapter"]["id"] == child["id"]
        assert body["chapter"]["breadcrumbs"] == [
            {"id": root["id"], "name": "祖层"},
            {"id": parent["id"], "name": "父层"},
        ]

    def test_get_chapter_missing(self, client):
        response = client.get("/api/v1/chapters/999")

        assert response.status_code == 404
        assert response.json()["detail"] == "not found"

    def test_update_chapter_fields(self, client, subject_id):
        chapter = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "第一章"},
        ).json()

        body = client.put(
            f"/api/v1/chapters/{chapter['id']}",
            json={"name": "改", "sort_order": 5},
        ).json()

        assert body["name"] == "改"
        assert body["sort_order"] == 5


def test_subject_editor_roundtrip(client, subject_id):
    initial = client.get(f"/api/v1/subjects/{subject_id}/editor")
    assert initial.status_code == 200

    editor_doc = {"root": {"data": {"text": "数学"}, "children": []}}
    saved = client.put(
        f"/api/v1/subjects/{subject_id}/editor",
        json={"editor_doc": editor_doc},
    )
    assert saved.status_code == 200

    body = client.get(f"/api/v1/subjects/{subject_id}/editor").json()
    assert body["editor_doc"]["root"]["data"]["text"] == "数学"
    assert body["editor_doc"]["root"]["data"]["memoryAnkiRootKind"] == "subject"
    assert body["editor_doc"]["root"]["children"] == []


def test_link_chapters_binding(make_client):
    client = make_client(knowledge_router, palace_router)
    subject = client.post("/api/v1/subjects", json={"name": "数学"}).json()
    chapter = client.post(
        f"/api/v1/subjects/{subject['id']}/chapters",
        json={"name": "第一章"},
    ).json()
    palace = client.post("/api/v1/palaces", json={"title": "记忆宫殿"}).json()

    response = client.put(
        f"/api/v1/palaces/{palace['id']}/chapters",
        json={"chapter_ids": [chapter["id"]]},
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    chapters = client.get(f"/api/v1/palaces/{palace['id']}/chapters").json()
    assert [item["id"] for item in chapters] == [chapter["id"]]
