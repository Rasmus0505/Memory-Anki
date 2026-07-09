import asyncio

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.core.api_token_auth import ApiTokenAuthMiddleware


def build_app(token, mount_dir: str | None = None):
    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping():
        return {"ok": True}

    @app.get("/index.html")
    def web():
        return {"web": True}

    if mount_dir is not None:
        from starlette.staticfiles import StaticFiles

        app.mount("/api/attachments", StaticFiles(directory=mount_dir), name="att")

    app.add_middleware(ApiTokenAuthMiddleware, token=token)
    return app


def test_no_token_configured_allows_everything():
    client = TestClient(build_app(None))
    assert client.get("/api/v1/ping").status_code == 200


def test_remote_request_without_token_rejected():
    client = TestClient(build_app("secret"))
    resp = client.get("/api/v1/ping", headers={"X-Forwarded-For": "100.64.0.9"})
    assert resp.status_code == 401


def test_direct_loopback_without_token_allowed():
    async def run_request():
        transport = httpx.ASGITransport(
            app=build_app("secret"),
            client=("127.0.0.1", 123),
        )
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/v1/ping")

    resp = asyncio.run(run_request())
    assert resp.status_code == 200


def test_remote_request_with_token_allowed():
    client = TestClient(build_app("secret"))
    for headers in (
        {"X-Forwarded-For": "100.64.0.9", "X-Memory-Anki-Token": "secret"},
        {"X-Forwarded-For": "100.64.0.9", "Authorization": "Bearer secret"},
    ):
        assert client.get("/api/v1/ping", headers=headers).status_code == 200


def test_web_static_paths_not_blocked():
    client = TestClient(build_app("secret"))
    resp = client.get("/index.html", headers={"X-Forwarded-For": "100.64.0.9"})
    assert resp.status_code == 200


def test_static_mount_under_api_prefix_is_protected(tmp_path):
    (tmp_path / "secret.txt").write_text("s", encoding="utf-8")
    client = TestClient(build_app("secret", mount_dir=str(tmp_path)))

    anonymous = client.get(
        "/api/attachments/secret.txt",
        headers={"X-Forwarded-For": "100.64.0.9"},
    )
    assert anonymous.status_code == 401

    authorized = client.get(
        "/api/attachments/secret.txt",
        headers={"X-Forwarded-For": "100.64.0.9", "X-Memory-Anki-Token": "secret"},
    )
    assert authorized.status_code == 200
    assert authorized.text == "s"
