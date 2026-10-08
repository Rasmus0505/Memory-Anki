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
            "timed out acquiring runtime storage lock", wait_seconds=15.0
        )

    @app.post("/db-locked")
    def db_locked_route():
        import sqlite3

        # The shape SQLAlchemy actually produces: the DBAPI error wrapped in a
        # SQLAlchemy exception, with the message one hop down the cause chain.
        from sqlalchemy.exc import OperationalError

        raise OperationalError(
            "UPDATE review_unit_encounters SET status=?",
            {},
            sqlite3.OperationalError("database is locked"),
        )

    @app.post("/db-other-operational")
    def db_other_operational_route():
        """A non-lock SQLite failure must stay a 500: it is not retryable."""
        import sqlite3

        from sqlalchemy.exc import OperationalError

        raise OperationalError(
            "SELECT * FROM does_not_exist",
            {},
            sqlite3.OperationalError("no such table: does_not_exist"),
        )

    return app


def test_http_exception_uses_structured_detail():
    response = TestClient(make_error_app()).get("/missing")

    assert response.status_code == 404
    assert response.json() == {
        "detail": {"code": "http_404", "message": "not found"},
    }


def test_sqlite_lock_error_reports_retryable_503_not_internal_error():
    """`database is locked` must be retryable, not an opaque 500.

    Measured 2026-10-07: 284 of these in one day, every one reported as
    "服务器内部错误，请查看服务端日志。" with HTTP 500 -- indistinguishable to the
    client from a genuine bug, so the study loop simply died on that card. The
    condition is transient, and the app-level lock already answers 503.
    """
    response = TestClient(make_error_app(), raise_server_exceptions=False).post("/db-locked")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "2"
    detail = response.json()["detail"]
    assert detail["code"] == "database_busy"
    assert detail["retryAfterSeconds"] == 2
    # The message must stay plain and must not leak SQLite internals.
    assert "database is locked" not in response.text
    assert "OperationalError" not in response.text
    assert "traceback" not in response.text.lower()


def test_other_sqlite_operational_errors_stay_500():
    """Only lock contention is retryable.

    `sqlite3.OperationalError` also covers missing tables and bad SQL. Advising a
    retry for those would loop forever on a request that can never succeed.
    """
    response = TestClient(
        make_error_app(), raise_server_exceptions=False
    ).post("/db-other-operational")

    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "internal_error"


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
