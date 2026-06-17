from __future__ import annotations

import http.client
import io
import json
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

from memory_anki.supervisor.runtime_supervisor_support import ReleaseRecord, make_session_id

COOKIE_NAME = "memory_anki_release"
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def send_text_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    message: str,
) -> None:
    body = message.encode("utf-8", errors="replace")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if handler.command == "HEAD":
        return
    try:
        handler.wfile.write(body)
    except Exception:
        pass


def parse_cookie(raw_cookie: str | None) -> tuple[str | None, str | None]:
    if not raw_cookie:
        return None, None
    try:
        cookie = SimpleCookie(raw_cookie)
    except Exception:
        return None, None
    morsel = cookie.get(COOKIE_NAME)
    if morsel is None:
        return None, None
    value = morsel.value
    if "." not in value:
        return None, None
    release_id, session_id = value.split(".", 1)
    return release_id or None, session_id or None


def make_cookie_value(release_id: str) -> tuple[str, str]:
    session_id = make_session_id()
    return session_id, f"{release_id}.{session_id}"


def is_document_request(handler: BaseHTTPRequestHandler) -> bool:
    if handler.command not in {"GET", "HEAD"}:
        return False
    path = handler.path.split("?", 1)[0]
    if path.startswith("/api") or path.startswith("/__supervisor"):
        return False
    if path in {"/", ""}:
        return True
    if "." in Path(path).name:
        return False
    accept = str(handler.headers.get("Accept") or "")
    return "text/html" in accept or "*/*" in accept


def select_release_for_request(
    supervisor: Any,
    handler: BaseHTTPRequestHandler,
) -> tuple[ReleaseRecord, str | None]:
    request_release_id, session_id = parse_cookie(handler.headers.get("Cookie"))
    with supervisor.lock:
        if not supervisor.current_release_id or supervisor.current_release_id not in supervisor.releases:
            raise RuntimeError("No active release is available.")
        set_cookie_header: str | None = None
        target_release_id = supervisor.current_release_id
        if is_document_request(handler):
            if supervisor._candidate_is_routable_locked():
                promoted_release_id = supervisor._promote_candidate_locked()
                if promoted_release_id:
                    target_release_id = promoted_release_id
                session_id, cookie_value = make_cookie_value(target_release_id)
                set_cookie_header = f"{COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; SameSite=Lax"
            elif request_release_id in supervisor.releases and session_id:
                target_release_id = request_release_id
            else:
                session_id, cookie_value = make_cookie_value(target_release_id)
                set_cookie_header = f"{COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; SameSite=Lax"
        elif request_release_id in supervisor.releases and session_id:
            target_release_id = request_release_id
        release = supervisor.releases[target_release_id]
        if session_id:
            supervisor.release_sessions.setdefault(target_release_id, {})[session_id] = time.time()
        return release, set_cookie_header


def _release_state(supervisor: Any, release: ReleaseRecord) -> str:
    if release.release_id == supervisor.current_release_id:
        return "current"
    if release.release_id == supervisor.candidate_release_id and release.ready:
        return "candidate_ready"
    if release.release_id == supervisor.candidate_release_id:
        return "candidate_pending"
    if release.retired_at is not None:
        return "retired"
    return "tracked"


def supervisor_status(supervisor: Any) -> dict[str, Any]:
    with supervisor.lock:
        build_stuck_seconds = (
            round(max(0.0, time.time() - supervisor.build_started_at), 3)
            if supervisor.building and supervisor.build_started_at is not None
            else None
        )
        return {
            "ok": True,
            "current_release_id": supervisor.current_release_id,
            "candidate_release_id": supervisor.candidate_release_id,
            "building": supervisor.building,
            "last_successful_release_id": supervisor.last_successful_release_id,
            "build_started_at": supervisor._serialize_timestamp(
                supervisor.build_started_at if supervisor.building else None,
            ),
            "build_stuck_seconds": build_stuck_seconds,
            "last_publish_error": supervisor.last_publish_error,
            "releases": [
                {
                    "release_id": release.release_id,
                    "ready": release.ready,
                    "port": release.port,
                    "state": _release_state(supervisor, release),
                    "retired_at": release.retired_at,
                }
                for release in supervisor.releases.values()
            ],
        }


def is_connection_refused_proxy_error(exc: Exception) -> bool:
    if isinstance(exc, ConnectionRefusedError):
        return True
    if isinstance(exc, OSError) and getattr(exc, "winerror", None) == 10061:
        return True
    return "[WinError 10061]" in str(exc)


def recover_release_for_proxy(supervisor: Any, release_id: str) -> ReleaseRecord | None:
    with supervisor.lock:
        release = supervisor.releases.get(release_id)
        if release is None:
            return None
        release_path = Path(release.path)
    if not release_path.exists():
        return None
    supervisor._stop_release_process(release_id)
    if not supervisor._restore_saved_release(release_id):
        return None
    with supervisor.lock:
        return supervisor.releases.get(release_id)


def forward_proxy_request(
    supervisor: Any,
    handler: BaseHTTPRequestHandler,
    *,
    release: ReleaseRecord,
    set_cookie_header: str | None,
    body: bytes | None,
    headers: dict[str, str],
) -> None:
    headers["Host"] = f"{supervisor.config.host}:{release.port}"
    connection = http.client.HTTPConnection(supervisor.config.host, release.port, timeout=120)
    try:
        connection.request(handler.command, handler.path, body=body, headers=headers)
        response = connection.getresponse()
        handler.send_response(response.status, response.reason)
        for header, value in response.getheaders():
            if header.lower() in HOP_BY_HOP_HEADERS:
                continue
            handler.send_header(header, value)
        if set_cookie_header:
            handler.send_header("Set-Cookie", set_cookie_header)
        handler.end_headers()
        if handler.command != "HEAD":
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                handler.wfile.write(chunk)
    finally:
        try:
            connection.close()
        except Exception:
            pass


def proxy_request(supervisor: Any, handler: BaseHTTPRequestHandler) -> None:
    try:
        release, set_cookie_header = select_release_for_request(supervisor, handler)
    except Exception as exc:
        send_text_response(handler, 503, str(exc))
        return

    content_length = int(handler.headers.get("Content-Length") or "0")
    body = handler.rfile.read(content_length) if content_length > 0 else None
    headers = {
        key: value
        for key, value in handler.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "host"
    }
    try:
        forward_proxy_request(
            supervisor,
            handler,
            release=release,
            set_cookie_header=set_cookie_header,
            body=body,
            headers=dict(headers),
        )
    except Exception as exc:
        if is_connection_refused_proxy_error(exc):
            recovered_release = recover_release_for_proxy(supervisor, release.release_id)
            if recovered_release is not None:
                try:
                    if body is not None and isinstance(handler.rfile, io.BufferedIOBase):
                        handler.rfile = io.BytesIO(body)
                    forward_proxy_request(
                        supervisor,
                        handler,
                        release=recovered_release,
                        set_cookie_header=set_cookie_header,
                        body=body,
                        headers=dict(headers),
                    )
                    return
                except Exception as retry_exc:
                    exc = retry_exc
        send_text_response(handler, 502, f"Proxy error: {exc}")


def make_handler(supervisor: Any):
    class SupervisorHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path.startswith("/__supervisor/health"):
                _send_status_response(supervisor, self, include_body=True)
                return
            proxy_request(supervisor, self)

        def do_HEAD(self):  # noqa: N802
            if self.path.startswith("/__supervisor/health"):
                _send_status_response(supervisor, self, include_body=False)
                return
            proxy_request(supervisor, self)

        def do_POST(self):  # noqa: N802
            proxy_request(supervisor, self)

        def do_PUT(self):  # noqa: N802
            proxy_request(supervisor, self)

        def do_PATCH(self):  # noqa: N802
            proxy_request(supervisor, self)

        def do_DELETE(self):  # noqa: N802
            proxy_request(supervisor, self)

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    return SupervisorHandler


def _send_status_response(
    supervisor: Any,
    handler: BaseHTTPRequestHandler,
    *,
    include_body: bool,
) -> None:
    payload = supervisor_status(supervisor)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    if include_body:
        handler.wfile.write(body)
