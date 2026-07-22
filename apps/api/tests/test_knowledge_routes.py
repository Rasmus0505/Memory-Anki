"""knowledge routes direct coverage for subjects, chapters, and bindings."""
import pytest

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.knowledge.application import chapter_service, subject_service
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.platform.application import MUTATION_ID_HEADER


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
    def test_create_replay_does_not_duplicate_subject(self, client, session_factory):
        headers = {MUTATION_ID_HEADER: "knowledge-subject-replay"}

        first = client.post("/api/v1/subjects", json={"name": "数学"}, headers=headers)
        second = client.post("/api/v1/subjects", json={"name": "忽略"}, headers=headers)

        assert second.json() == first.json()
        with session_factory() as session:
            assert session.query(Subject).count() == 1

    def test_create_rolls_back_when_mutation_response_fails(
        self, client, session_factory, monkeypatch
    ):
        monkeypatch.setattr(
            knowledge_router.SqlAlchemyMutationResponseStore,
            "save",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("cache failed")),
        )

        with pytest.raises(RuntimeError, match="cache failed"):
            client.post(
                "/api/v1/subjects",
                json={"name": "Must Roll Back"},
                headers={MUTATION_ID_HEADER: "knowledge-subject-rollback"},
            )

        with session_factory() as session:
            assert session.query(Subject).count() == 0

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
    def test_create_replay_does_not_duplicate_chapter(
        self, client, subject_id, session_factory
    ):
        headers = {MUTATION_ID_HEADER: "knowledge-chapter-replay"}

        first = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "第一章"},
            headers=headers,
        )
        second = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "忽略"},
            headers=headers,
        )

        assert second.json() == first.json()
        with session_factory() as session:
            assert session.query(Chapter).filter_by(subject_id=subject_id).count() == 1

    def test_create_rolls_back_when_mutation_response_fails(
        self, client, subject_id, session_factory, monkeypatch
    ):
        monkeypatch.setattr(
            knowledge_router.SqlAlchemyMutationResponseStore,
            "save",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("cache failed")),
        )

        response = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "Must Roll Back"},
            headers={MUTATION_ID_HEADER: "knowledge-chapter-rollback"},
        )

        assert response.status_code == 500
        with session_factory() as session:
            assert session.query(Chapter).filter_by(subject_id=subject_id).count() == 0

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


def test_palace_knowledge_binding_is_explicit_and_revisioned(make_client):
    client = make_client(knowledge_router, palace_router)
    subject = client.post("/api/v1/subjects", json={"name": "数学"}).json()
    chapter = client.post(
        f"/api/v1/subjects/{subject['id']}/chapters",
        json={"name": "第一章"},
    ).json()
    palace = client.post(
        "/api/v1/palaces",
        json={"title": "记忆宫殿", "subject_ids": [subject["id"]]},
    ).json()

    response = client.put(
        f"/api/v1/palaces/{palace['id']}/knowledge-binding",
        json={
            "subject_ids": [subject["id"]],
            "chapter_ids": [chapter["id"]],
            "primary_chapter_id": chapter["id"],
            "base_revision": 0,
            "operation_id": "bind-math-chapter",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["explicit_chapter_ids"] == [chapter["id"]]
    assert body["primary_chapter_id"] == chapter["id"]
    assert body["binding_revision"] == 1
    assert body["subjects"][0]["id"] == subject["id"]

    stale = client.put(
        f"/api/v1/palaces/{palace['id']}/knowledge-binding",
        json={
            "subject_ids": [subject["id"]],
            "chapter_ids": [],
            "primary_chapter_id": None,
            "base_revision": 0,
            "operation_id": "stale-binding",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "knowledge_binding_conflict"


def test_removing_last_subject_moves_palace_to_uncategorized(make_client):
    client = make_client(knowledge_router, palace_router)
    subject = client.post("/api/v1/subjects", json={"name": "物理"}).json()
    palace = client.post(
        "/api/v1/palaces",
        json={"title": "力学", "subject_ids": [subject["id"]]},
    ).json()

    response = client.put(
        f"/api/v1/palaces/{palace['id']}/knowledge-binding",
        json={
            "subject_ids": [],
            "chapter_ids": [],
            "primary_chapter_id": None,
            "base_revision": 0,
            "operation_id": "remove-last-subject",
        },
    )
    assert response.status_code == 200
    assert [item["name"] for item in response.json()["subjects"]] == ["未分类"]


def test_subject_delete_is_blocked_when_used_by_palace(make_client):
    client = make_client(knowledge_router, palace_router)
    subject = client.post("/api/v1/subjects", json={"name": "化学"}).json()
    client.post(
        "/api/v1/palaces",
        json={"title": "元素", "subject_ids": [subject["id"]]},
    )

    response = client.delete(f"/api/v1/subjects/{subject['id']}")
    assert response.status_code == 409
    assert response.json()["requires_reassignment"] is True
    assert response.json()["palace_count"] == 1
