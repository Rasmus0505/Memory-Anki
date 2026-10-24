"""写请求成功后必须让仪表盘快照失效。"""
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from memory_anki.app import main


def _client(status_code: int) -> TestClient:
    async def endpoint(request):
        return PlainTextResponse("ok", status_code=status_code)

    app = Starlette(routes=[Route("/api/v1/thing", endpoint, methods=["GET", "POST"])])
    app.add_middleware(main.DashboardInvalidationMiddleware)
    return TestClient(app)


def test_successful_write_invalidates_the_dashboard(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "request_dashboard_refresh", lambda: calls.append("refresh"))

    assert _client(200).post("/api/v1/thing").status_code == 200
    assert calls == ["refresh"]


def test_failed_write_and_reads_do_not_invalidate(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "request_dashboard_refresh", lambda: calls.append("refresh"))

    assert _client(500).post("/api/v1/thing").status_code == 500
    assert _client(200).get("/api/v1/thing").status_code == 200
    assert calls == []
