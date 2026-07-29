"""HTTP fetch for dictionary HTML pages."""

from __future__ import annotations

import urllib.error
import urllib.request
from typing import Final

DEFAULT_TIMEOUT_SECONDS: Final[float] = 12.0

# Browser-like UA reduces Cambridge 403 rate (Saladict uses real browser cookies;
# we send a stable desktop UA without credentials).
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


class FetchError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def fetch_html(url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> str:
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
            "User-Agent": _USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            charset = response.headers.get_content_charset() or "utf-8"
            return raw.decode(charset, errors="replace")
    except urllib.error.HTTPError as exc:
        raise FetchError(
            f"HTTP {exc.code} fetching dictionary page",
            status_code=exc.code,
        ) from exc
    except urllib.error.URLError as exc:
        raise FetchError("Network error fetching dictionary page") from exc
