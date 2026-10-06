from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.presentation.article_package_router import router


def test_route_rejects_unknown_fields_and_wrong_target_without_mutation(db_session):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[session_dep] = lambda: db_session
    document = {"schemaVersion": 1, "root": {"data": {"uid": "root", "text": "Title"}}}
    command = {"mode": "append", "owner_id": "palace:2", "operation_id": "op", "document": document, "expected_revision": "rev"}
    with TestClient(app) as client:
        assert client.post("/api/v1/palaces/1/article-transfer", json=command).status_code == 422
        assert client.post("/api/v1/content/article-transfer", json={**command, "allow_stale_overwrite": True}).status_code == 422
        assert client.get("/api/v1/palaces/999/article-package").status_code == 404
