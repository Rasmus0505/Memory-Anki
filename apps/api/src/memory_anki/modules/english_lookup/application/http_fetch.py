"""HTTP fetch for dictionary pages.

Python's urllib honors the Windows system proxy. A paused Clash/V2Ray
listener (commonly 127.0.0.1:7890/7897) then fails every lookup with
connection refused. Probe that proxy and fall back to a direct connection.
"""

from __future__ import annotations

import socket
import time
import urllib.error
import urllib.request
from typing import Final
from urllib.request import OpenerDirector, ProxyHandler, Request

DEFAULT_TIMEOUT_SECONDS: Final[float] = 12.0
_PROXY_PROBE_TTL_SECONDS: Final[float] = 10.0
_PROXY_PROBE_TIMEOUT_SECONDS: Final[float] = 0.2

# Browser-like UA reduces Cambridge 403 rate (Saladict uses real browser cookies;
# we send a stable desktop UA without credentials).
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

_DEFAULT_HEADERS: Final[dict[str, str]] = {
    "User-Agent": _USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
}

# (monotonic_ts, endpoint, alive)
_proxy_probe_cache: tuple[float, tuple[str, int], bool] | None = None


class FetchError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def reset_proxy_probe_cache() -> None:
    """Test hook: forget the last proxy liveness probe."""
    global _proxy_probe_cache
    _proxy_probe_cache = None


def fetch_html(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    headers: dict[str, str] | None = None,
) -> str:
    raw, charset, _content_type = fetch_response(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            **(headers or {}),
        },
        timeout=timeout,
    )
    return raw.decode(charset or "utf-8", errors="replace")


def fetch_raw(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[bytes, str | None]:
    raw, charset, _content_type = fetch_response(
        url,
        data=data,
        headers=headers,
        method=method,
        timeout=timeout,
    )
    return raw, charset


def fetch_binary(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[bytes, str]:
    raw, _charset, content_type = fetch_response(url, headers=headers, timeout=timeout)
    return raw, content_type


def fetch_response(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[bytes, str | None, str]:
    merged_headers = {**_DEFAULT_HEADERS, **(headers or {})}
    last_error: BaseException | None = None
    proxy_failed = False
    for opener in _openers_to_try():
        request = Request(url, data=data, headers=merged_headers, method=method)
        try:
            with _urlopen(opener, request, timeout) as response:
                raw = response.read()
                headers = response.headers
                charset_getter = getattr(headers, "get_content_charset", None)
                charset = charset_getter() if callable(charset_getter) else None
                type_getter = getattr(headers, "get_content_type", None)
                content_type = (type_getter() or "").strip() if callable(type_getter) else ""
                if not content_type:
                    header_get = getattr(headers, "get", None)
                    header_value = header_get("Content-Type") if callable(header_get) else ""
                    content_type = str(header_value or "").split(";", 1)[0].strip()
                return raw, charset, content_type or "application/octet-stream"
        except urllib.error.HTTPError as exc:
            raise FetchError(
                f"HTTP {exc.code} fetching dictionary page",
                status_code=exc.code,
            ) from exc
        except urllib.error.URLError as exc:
            last_error = exc
            if _is_proxy_connection_error(exc):
                proxy_failed = True
                _remember_proxy_dead()
                continue
            raise FetchError("Network error fetching dictionary page") from exc
        except TimeoutError as exc:
            last_error = exc
            raise FetchError("Network error fetching dictionary page") from exc
    if proxy_failed:
        raise FetchError("Network error fetching dictionary page") from last_error
    raise FetchError("Network error fetching dictionary page") from last_error


def _urlopen(opener: OpenerDirector, request: Request, timeout: float):
    return opener.open(request, timeout=timeout)


def _openers_to_try() -> list[OpenerDirector]:
    direct = urllib.request.build_opener(ProxyHandler({}))
    endpoint = _configured_proxy_endpoint()
    if endpoint is None:
        return [direct]
    if not _cached_proxy_alive(endpoint):
        return [direct]
    proxied = urllib.request.build_opener()
    return [proxied, direct]


def _configured_proxy_endpoint() -> tuple[str, int] | None:
    proxies = urllib.request.getproxies()
    proxy_url = str(proxies.get("https") or proxies.get("http") or "").strip()
    if not proxy_url:
        return None
    return _parse_proxy_host_port(proxy_url)


def _parse_proxy_host_port(proxy_url: str) -> tuple[str, int] | None:
    raw = proxy_url.strip()
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    raw = raw.split("/", 1)[0]
    if "@" in raw:
        raw = raw.rsplit("@", 1)[-1]
    if not raw:
        return None
    if raw.startswith("[") and "]" in raw:
        host, _, rest = raw[1:].partition("]")
        if rest.startswith(":"):
            try:
                return host, int(rest[1:])
            except ValueError:
                return None
        return (host, 80) if host else None
    if ":" not in raw:
        return raw, 80
    host, _, port_text = raw.rpartition(":")
    if not host:
        return None
    try:
        return host, int(port_text)
    except ValueError:
        return None


def _cached_proxy_alive(endpoint: tuple[str, int]) -> bool:
    global _proxy_probe_cache
    now = time.monotonic()
    cached = _proxy_probe_cache
    if cached is not None and cached[1] == endpoint and now - cached[0] < _PROXY_PROBE_TTL_SECONDS:
        return cached[2]
    alive = _probe_proxy(endpoint)
    _proxy_probe_cache = (now, endpoint, alive)
    return alive


def _remember_proxy_dead() -> None:
    endpoint = _configured_proxy_endpoint()
    if endpoint is None:
        return
    global _proxy_probe_cache
    _proxy_probe_cache = (time.monotonic(), endpoint, False)


def _probe_proxy(endpoint: tuple[str, int]) -> bool:
    host, port = endpoint
    try:
        with socket.create_connection((host, port), timeout=_PROXY_PROBE_TIMEOUT_SECONDS):
            return True
    except OSError:
        return False


def _is_proxy_connection_error(exc: BaseException) -> bool:
    current: BaseException | None = exc
    seen = 0
    while current is not None and seen < 8:
        if isinstance(current, ConnectionRefusedError):
            return True
        errno = getattr(current, "errno", None)
        winerror = getattr(current, "winerror", None)
        if errno in {61, 111} or winerror == 10061 or errno == 10061:
            return True
        message = str(current).lower()
        if "10061" in message or "actively refused" in message or "connection refused" in message:
            return True
        reason = getattr(current, "reason", None)
        nxt = current.__cause__
        if nxt is None and isinstance(reason, BaseException):
            nxt = reason
        current = nxt
        seen += 1
    return False
