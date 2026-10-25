"""Bark 网关：URL 编码与失败分类，全程不触真实网络。"""

from __future__ import annotations

from urllib.parse import unquote, urlparse

import pytest
import requests

from memory_anki.modules.reminders.infrastructure.bark_gateway import (
    build_bark_url,
    send_bark,
)


class _Response:
    def __init__(self, status_code: int, payload=None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def test_url_encodes_every_path_segment() -> None:
    url = build_bark_url("key-1", "今天 128 张/到期", "复习 96 · 新 32")
    parsed = urlparse(url)
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]
    # 标题里的斜杠必须留在段内，不能把地址拆成另一条路径。
    assert segments == ["key-1", "今天 128 张/到期", "复习 96 · 新 32"]
    assert "key-1" in url


def test_send_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        requests, "get", lambda url, timeout: _Response(200, {"code": 200, "message": "success"})
    )
    result = send_bark("key-1", "t", "b")
    assert result.ok is True
    assert result.http_status == 200


def test_send_reports_a_bark_level_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        requests, "get", lambda url, timeout: _Response(200, {"code": 400, "message": "bad key"})
    )
    result = send_bark("key-1", "t", "b")
    assert result.ok is False
    assert "bad key" in result.error


def test_send_reports_http_and_network_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        requests, "get", lambda url, timeout: _Response(400, {"code": 400, "message": "device token 无效"})
    )
    rejected = send_bark("key-1", "t", "b")
    assert rejected.ok is False
    # 把 Bark 自己的话带回来，而不是一句没用的 "http 400"。
    assert rejected.error == "device token 无效"

    monkeypatch.setattr(requests, "get", lambda url, timeout: _Response(502))
    assert send_bark("key-1", "t", "b").ok is False

    def boom(url, timeout):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(requests, "get", boom)
    result = send_bark("key-1", "t", "b")
    assert result.ok is False
    assert "ConnectionError" in result.error

    def slow(url, timeout):
        raise requests.Timeout("slow")

    monkeypatch.setattr(requests, "get", slow)
    assert send_bark("key-1", "t", "b").error == "timeout"


def test_icon_is_forwarded_only_when_it_is_a_public_url() -> None:
    with_icon = build_bark_url("key-1", "t", "b", icon_url="https://cdn.example.com/a.png")
    assert "icon=https%3A%2F%2Fcdn.example.com%2Fa.png" in with_icon
    assert "icon=" not in build_bark_url("key-1", "t", "b")
