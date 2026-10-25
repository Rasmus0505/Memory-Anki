"""状态展示：投递时间必须带时区，否则浏览器会按本地时间解读 UTC。"""

from __future__ import annotations

from datetime import datetime

from memory_anki.modules.reminders.application.reminder_settings import update_settings
from memory_anki.modules.reminders.application.reminder_status import build_status
from memory_anki.modules.reminders.infrastructure.delivery_store import record_attempt


def test_last_delivery_time_carries_a_utc_offset(db_session) -> None:
    update_settings(db_session, {"enabled": True, "bark_key": "abcdefgh"})
    record_attempt(
        db_session,
        study_day=datetime(2026, 10, 25).date(),
        slot="morning",
        ok=True,
        title="t",
        body="b",
        now=datetime(2026, 10, 25, 0, 30),
    )
    db_session.commit()

    last = build_status(db_session)["last_delivery"]
    assert last is not None
    assert last["at"].endswith("+00:00")


def test_status_is_empty_before_anything_was_sent(db_session) -> None:
    status = build_status(db_session)
    assert status["last_delivery"] is None
    assert status["next_at"] is None
    assert status["consecutive_failures"] == 0
