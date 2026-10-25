"""到期单元的 FSRS 记忆保留率：只读投影，缺少状态时不参与平均。"""

from __future__ import annotations

import json
from datetime import date, timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.application.unit_retention_read import (
    retrievability,
    summarize_due_retention,
)


def _palace(session, title: str = "保留率宫殿") -> Palace:
    palace = Palace(title=title, archived=False, editor_doc=json.dumps({"root": {}}))
    session.add(palace)
    session.flush()
    return palace


def _unit(session, palace, *, stability, days_since, due=None, uid="u1"):
    now = utc_now_naive()
    session.add(
        ReviewUnitState(
            id=f"{palace.id}:{uid}",
            palace_id=palace.id,
            anchor_uid=uid,
            unit_kind="permanent_split",
            node_uids_json=json.dumps([uid]),
            membership_hash=f"hash-{palace.id}-{uid}",
            content_hash=f"content-{palace.id}-{uid}",
            due_date=due or date(2026, 10, 25),
            has_passed=True,
            active=True,
            fsrs_stability=stability,
            fsrs_last_review=now - timedelta(days=days_since),
        )
    )
    session.flush()


def test_retrievability_follows_the_fsrs_curve() -> None:
    # 刚复习完：满分。
    assert retrievability(10, 0) == 1.0
    # 经过一个 stability 周期后正好落在期望保留率附近（0.9 附近）。
    assert 0.85 < retrievability(10, 10) < 0.92
    # 时间是稳定度的两倍时更差。
    assert retrievability(10, 20) < retrievability(10, 10)
    assert retrievability(None, 5) is None
    assert retrievability(0, 5) is None


def test_summary_averages_only_units_with_state(db_session) -> None:
    palace = _palace(db_session)
    _unit(db_session, palace, stability=10, days_since=1, uid="fresh")
    _unit(db_session, palace, stability=2, days_since=30, uid="stale")
    # 没有 FSRS 状态的单元不参与平均，否则会把数字稀释得好看。
    _unit(db_session, palace, stability=None, days_since=0, uid="new")
    db_session.commit()

    summary = summarize_due_retention(
        db_session, date(2026, 10, 25), now=utc_now_naive()
    )
    assert summary.due_units == 3
    assert summary.measured_units == 2
    assert summary.average is not None and summary.lowest is not None
    assert summary.lowest < 0.5
    assert summary.average > summary.lowest
    assert summary.at_risk_units >= 1


def test_summary_is_empty_when_nothing_is_due(db_session) -> None:
    palace = _palace(db_session)
    _unit(db_session, palace, stability=5, days_since=1, due=date(2026, 12, 31))
    db_session.commit()

    summary = summarize_due_retention(
        db_session, date(2026, 10, 25), now=utc_now_naive()
    )
    assert summary.due_units == 0
    assert summary.average is None


def test_retention_is_a_percentage_in_the_copy(db_session) -> None:
    from memory_anki.modules.reminders.application.reminder_message import compose
    from memory_anki.modules.reminders.domain.schemas import (
        KIND_MORNING,
        DueSnapshot,
        ReminderSettings,
    )

    message = compose(
        KIND_MORNING,
        ReminderSettings(enabled=True, bark_key="k"),
        DueSnapshot(due_count=40, average_retention=0.62, oldest_overdue_days=0),
    )
    assert "记忆平均剩 62%" in message.body
