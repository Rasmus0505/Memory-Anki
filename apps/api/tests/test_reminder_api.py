"""提醒接口：设置读写、Key 打码、测试通知与状态。"""

from __future__ import annotations

import pytest

from memory_anki.modules.reminders.infrastructure.bark_gateway import BarkResult
from memory_anki.modules.reminders.presentation import router as reminders_router


@pytest.fixture()
def client(make_client):
    return make_client(reminders_router)


def test_settings_default_off_and_key_is_never_echoed(client) -> None:
    payload = client.get("/api/v1/reminders/settings").json()
    assert payload["settings"]["enabled"] is False
    assert payload["settings"]["bark_configured"] is False
    assert "bark_key" not in payload["settings"]
    assert payload["status"]["next_at"] is None


def test_put_accepts_a_pasted_bark_url_and_returns_only_a_mask(client) -> None:
    response = client.put(
        "/api/v1/reminders/settings",
        json={
            "enabled": True,
            "bark_key": "https://api.day.app/MDRJd9yDZi4B5cP5ShnB4P/title/body",
            "morning_time": "07:45",
        },
    )
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["bark_configured"] is True
    assert settings["bark_key_masked"] == "••••nB4P"
    assert "MDRJd9yDZi4B5cP5ShnB4P" not in response.text
    assert settings["morning_time"] == "07:45"
    assert response.json()["status"]["next_at"] is not None


def test_test_endpoint_reports_a_delivery_failure(client, monkeypatch) -> None:
    client.put(
        "/api/v1/reminders/settings",
        json={"enabled": True, "bark_key": "abcdefgh"},
    )
    monkeypatch.setattr(
        reminders_router,
        "send_bark",
        lambda *args, **kwargs: BarkResult(False, 200, "bad key"),
    )
    payload = client.post("/api/v1/reminders/test").json()
    assert payload["ok"] is False
    assert payload["error"] == "bad key"


def test_test_endpoint_refuses_when_unconfigured(client) -> None:
    payload = client.post("/api/v1/reminders/test").json()
    assert payload["ok"] is False
    assert "Bark" in payload["error"]


def test_test_endpoint_sends_and_names_todays_count(client, monkeypatch) -> None:
    client.put("/api/v1/reminders/settings", json={"enabled": True, "bark_key": "abcdefgh"})
    sent: list[tuple] = []

    def fake_send(key, title, body, **kwargs):
        sent.append((key, title, body))
        return BarkResult(True, 200)

    monkeypatch.setattr(reminders_router, "send_bark", fake_send)
    payload = client.post("/api/v1/reminders/test").json()
    assert payload["ok"] is True
    assert sent and sent[0][0] == "abcdefgh"
    assert "到期" in sent[0][2]


def test_settings_expose_the_new_channels_off_by_default(client) -> None:
    settings = client.get("/api/v1/reminders/settings").json()["settings"]
    assert settings["idle_enabled"] is False
    assert settings["ready_enabled"] is False
    assert settings["hourly_enabled"] is False
    assert settings["quiet_start_hour"] == 0
    assert settings["quiet_end_hour"] == 8
    assert settings["daily_cap"] == 60


def test_preview_sends_a_sample_of_the_requested_kind(client, monkeypatch) -> None:
    client.put("/api/v1/reminders/settings", json={"enabled": True, "bark_key": "abcdefgh"})
    sent: list[tuple] = []

    def fake_send(key, title, body, **kwargs):
        sent.append((title, body))
        return BarkResult(True, 200)

    monkeypatch.setattr(reminders_router, "send_bark", fake_send)
    for kind in ("morning", "evening", "ready", "idle", "hourly"):
        response = client.post("/api/v1/reminders/preview", json={"kind": kind})
        assert response.status_code == 200, response.text
        assert response.json()["ok"] is True
        assert response.json()["kind"] == kind
    assert len(sent) == 5
    titles = " ".join(title for title, _ in sent)
    assert "到期" in titles and "还在吗" in titles and "整点" not in titles


def test_preview_rejects_an_unknown_kind(client) -> None:
    response = client.post("/api/v1/reminders/preview", json={"kind": "shout"})
    assert response.status_code == 400
