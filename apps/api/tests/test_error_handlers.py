"""Global API error response coverage."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from memory_anki.app.error_handlers import install_error_handlers


class DemoPayload(BaseModel):
    name: str


def make_error_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/missing")
    def missing_route():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="not found")

    @app.post("/validate")
    def validate_route(payload: DemoPayload):
        return payload

    @app.get("/boom")
    def boom_route():
        raise RuntimeError("boom with traceback")

    @app.put("/busy")
    def busy_route():
        from memory_anki.core.runtime_storage_lock import StorageBusyError

        raise StorageBusyError(
            "timed out acquiring runtime storage thread lock", wait_seconds=15.0
        )

    return app


def test_http_exception_uses_structured_detail():
    response = TestClient(make_error_app()).get("/missing")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {"code": "http_404", "message": "not found"},
    }


def test_validation_error_uses_structured_detail():
    response = TestClient(make_error_app()).post("/validate", json={})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "validation_error"
    assert detail["message"] == "请求参数校验失败。"
    assert detail["errors"]


def test_unexpected_error_hides_traceback():
    response = TestClient(make_error_app(), raise_server_exceptions=False).get("/boom")

    assert response.status_code == 500
    payload = response.json()
    assert payload == {
        "detail": {
            "code": "internal_error",
            "message": "服务器内部错误，请查看服务端日志。",
        }
    }
    assert "traceback" not in response.text.lower()
    assert "boom with traceback" not in response.text


def test_storage_busy_reports_retryable_503_not_internal_error():
    """Lock contention must be retryable, not an opaque 500.

    A rolling backup can hold the shared runtime lock for minutes; the mindmap
    autosave used to surface that as "服务器内部错误", which hid a safely
    repeatable condition.
    """
    response = TestClient(make_error_app(), raise_server_exceptions=False).put("/busy")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "15"
    detail = response.json()["detail"]
    assert detail["code"] == "storage_busy"
    assert detail["retryAfterSeconds"] == 15
    # The client-facing message must not leak the internal lock class name.
    assert "StorageBusyError" not in response.text
    assert "traceback" not in response.text.lower()
    # Nor may it name a single guessed holder. The message used to blame
    # "后台备份", but the common cause turned out to be a lagging-palace rebuild
    # inside a read request, so that wording sent debugging the wrong way.
    assert "备份" not in detail["message"]
