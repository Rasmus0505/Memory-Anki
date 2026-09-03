from __future__ import annotations

import json
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.modules.session.application.live_study_room import (
    CONTROLLER_DISCONNECT_GRACE_SECONDS,
    apply_live_study_command,
    expire_disconnected_controllers,
    get_live_study_projection,
    reset_live_study_room,
    subscribe_live_study,
    unsubscribe_live_study,
)
from memory_anki.modules.session.presentation import router as sessions_router


def setup_function() -> None:
    reset_live_study_room()


def _publish(client_id: str, operation_id: str, **fields: object) -> dict:
    return apply_live_study_command(
        {
            "type": "publish",
            "client_id": client_id,
            "operation_id": operation_id,
            **fields,
        }
    )


def test_publish_is_last_write_wins_and_idempotent() -> None:
    first = _publish(
        "desktop",
        "op-1",
        take_control=True,
        route="/freestyle",
        surface="freestyle",
        view={"currentCardId": "card-a"},
    )
    assert first["projection"]["revision"] == 1
    assert first["projection"]["controller_client_id"] == "desktop"
    assert first["projection"]["view"]["currentCardId"] == "card-a"

    duplicate = _publish(
        "desktop",
        "op-1",
        take_control=True,
        view={"currentCardId": "should-not-apply"},
    )
    assert duplicate["projection"]["view"]["currentCardId"] == "card-a"
    assert duplicate["projection"]["revision"] == 1

    second = _publish(
        "pwa",
        "op-2",
        take_control=True,
        view={"currentCardId": "card-b"},
    )
    assert second["projection"]["revision"] == 2
    assert second["projection"]["controller_client_id"] == "pwa"
    assert second["projection"]["view"]["currentCardId"] == "card-b"


def test_remaining_study_surfaces_are_last_write_wins() -> None:
    quiz = _publish(
        "desktop",
        "quiz-1",
        take_control=True,
        surface="palace_quiz",
        route="/palaces/7/quiz",
        view={"palaceId": 7, "questionId": 11, "questionState": {"questionId": 11, "state": {"selectedOptionId": "a"}}},
    )
    assert quiz["projection"]["surface"] == "palace_quiz"
    later = _publish(
        "pwa",
        "quiz-2",
        take_control=True,
        surface="english_course",
        route="/english/listening/courses/3",
        view={"courseId": 3, "typingSentenceIndex": 4, "sentencePhase": "locally_completed"},
    )
    assert later["projection"]["revision"] > quiz["projection"]["revision"]
    assert later["projection"]["controller_client_id"] == "pwa"
    assert later["projection"]["view"]["typingSentenceIndex"] == 4
    practice = _publish(
        "desktop",
        "practice-1",
        take_control=True,
        surface="mindmap_review",
        route="/palaces/7",
        view={"palaceId": 7, "editorMode": "recall", "currentNodeUid": "node-3"},
    )
    reading = _publish(
        "pwa",
        "reading-1",
        take_control=True,
        surface="english_reading",
        route="/english/reading/materials/9",
        view={"articleId": 9, "selectedIds": [1, 4], "targetId": 4},
    )
    assert practice["projection"]["view"]["currentNodeUid"] == "node-3"
    assert reading["projection"]["revision"] > practice["projection"]["revision"]
    assert reading["projection"]["view"]["articleId"] == 9


def test_non_controller_timer_publish_is_ignored() -> None:
    _publish(
        "desktop",
        "op-1",
        take_control=True,
        timer={"status": "running", "effectiveSeconds": 12},
    )
    ignored = _publish(
        "pwa",
        "op-2",
        timer={"status": "paused", "effectiveSeconds": 99},
    )
    assert ignored["projection"]["controller_client_id"] == "desktop"
    assert ignored["projection"]["timer"]["effectiveSeconds"] == 12
    assert ignored["projection"]["revision"] == 1


def test_subscribers_receive_updates_and_echo_publisher_id() -> None:
    subscriber_id, inbox = subscribe_live_study("pwa")
    _publish(
        "desktop",
        "op-1",
        take_control=True,
        route="/freestyle",
        surface="freestyle",
        view={"currentCardId": "card-a"},
    )
    message = inbox.get(timeout=1)
    assert message is not None
    assert message["event"] == "update"
    assert message["data"]["publisher_client_id"] == "desktop"
    assert message["data"]["projection"]["view"]["currentCardId"] == "card-a"
    unsubscribe_live_study(subscriber_id)


def test_controller_disconnect_pauses_timer_after_grace() -> None:
    _publish(
        "desktop",
        "op-1",
        take_control=True,
        timer={"status": "running", "semanticState": "running", "effectiveSeconds": 8},
    )
    subscriber_id, _inbox = subscribe_live_study("desktop")
    unsubscribe_live_study(subscriber_id)
    expire_disconnected_controllers(now=time.monotonic() + CONTROLLER_DISCONNECT_GRACE_SECONDS + 0.01)
    projection = get_live_study_projection()
    assert projection["controller_client_id"] is None
    assert projection["timer"]["status"] == "paused"
    assert projection["timer"]["semanticState"] == "paused"


def test_http_command_returns_projection() -> None:
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    client = TestClient(app)
    posted = client.post(
        "/api/v1/session/live/commands",
        json={
            "type": "publish",
            "client_id": "desktop",
            "operation_id": "http-1",
            "take_control": True,
            "surface": "freestyle",
            "route": "/freestyle",
            "view": {"currentCardId": "card-http"},
        },
    )
    assert posted.status_code == 200
    body = posted.json()
    assert body["projection"]["view"]["currentCardId"] == "card-http"
    assert body["projection"]["surface"] == "freestyle"


def test_http_rejects_unknown_surface() -> None:
    app = FastAPI()
    app.include_router(sessions_router.router, prefix="/api/v1")
    client = TestClient(app)
    response = client.post(
        "/api/v1/session/live/commands",
        json={
            "type": "publish",
            "client_id": "desktop",
            "operation_id": "bad-surface",
            "surface": "settings",
        },
    )
    assert response.status_code == 400
    assert "unsupported live study surface" in response.json()["detail"]


def test_live_room_module_is_not_sqlite_backed() -> None:
    from pathlib import Path

    source = Path(
        "apps/api/src/memory_anki/modules/session/application/live_study_room.py"
    ).read_text(encoding="utf-8")
    assert "sqlite" not in source.lower()
    assert "get_session" not in source
    assert json.loads(json.dumps(get_live_study_projection()))["surface"] == "idle"
