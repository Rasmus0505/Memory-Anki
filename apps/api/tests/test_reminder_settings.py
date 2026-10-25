"""设置存取：Bark Key 解析、打码、部分更新语义。"""

from __future__ import annotations

from memory_anki.modules.reminders.application.reminder_settings import (
    mask_bark_key,
    parse_bark_key,
    read_settings,
    update_settings,
)


def test_parse_accepts_a_full_url_or_a_bare_key() -> None:
    assert parse_bark_key("https://api.day.app/MDRJd9yDZi4B5cP5ShnB4P/title/body") == (
        "MDRJd9yDZi4B5cP5ShnB4P"
    )
    assert parse_bark_key("api.day.app/MDRJd9yDZi4B5cP5ShnB4P") == "MDRJd9yDZi4B5cP5ShnB4P"
    assert parse_bark_key("MDRJd9yDZi4B5cP5ShnB4P") == "MDRJd9yDZi4B5cP5ShnB4P"
    assert parse_bark_key("") == ""
    assert parse_bark_key(None) == ""


def test_mask_keeps_only_the_tail() -> None:
    assert mask_bark_key("MDRJd9yDZi4B5cP5ShnB4P") == "••••nB4P"
    assert mask_bark_key("") == ""


def test_partial_update_keeps_the_existing_key(db_session) -> None:
    update_settings(db_session, {"enabled": True, "bark_key": "https://api.day.app/abcdefgh/a/b"})
    db_session.commit()

    updated = update_settings(db_session, {"morning_time": "07:15"})
    db_session.commit()

    assert updated.morning_time.strftime("%H:%M") == "07:15"
    assert updated.bark_key == "abcdefgh"
    assert read_settings(db_session).bark_key == "abcdefgh"


def test_explicit_empty_key_clears_it(db_session) -> None:
    update_settings(db_session, {"bark_key": "abcdefgh"})
    update_settings(db_session, {"bark_key": ""})
    db_session.commit()
    assert read_settings(db_session).bark_key == ""


def test_invalid_values_fall_back_to_defaults(db_session) -> None:
    updated = update_settings(
        db_session,
        {
            "morning_time": "not-a-time",
            "content_mode": "shouty",
            "due_threshold": "many",
            "morning_window_minutes": 99999,
        },
    )
    db_session.commit()
    assert updated.morning_time.strftime("%H:%M") == "08:30"
    assert updated.content_mode == "detailed"
    assert updated.due_threshold == 0
    assert updated.morning_window_minutes == 720


def test_icon_url_must_be_an_absolute_http_url(db_session) -> None:
    kept = update_settings(db_session, {"icon_url": "https://cdn.example.com/icon.png"})
    assert kept.icon_url == "https://cdn.example.com/icon.png"

    rejected = update_settings(db_session, {"icon_url": "/icons/icon-192.png"})
    assert rejected.icon_url == ""
