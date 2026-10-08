"""Regression guard for the `database is locked` outage -- instrument correctness.

The original watchdog timed every transaction from ``after_begin``, so it reported
READ-ONLY transactions as "write transaction held", and it reported *blocked
victims* as the holder because a victim's transaction also stays open for the
whole ``busy_timeout`` wait. Production logs show the consequence: a DELETE that
failed after 10847ms was logged as "write transaction held 14.83s opened at
_delete_open_unrated_encounters" -- naming the line that was waiting for the lock
as the line that held it. Three rounds of fixes aimed at those named frames, which
is why the failure kept coming back.

These tests pin the two distinctions that make the instrument trustworthy:

1. a read-only session must never be reported as a write transaction;
2. a call that never acquires the write lock is reported as a *victim*
   ("blocked ... WITHOUT ever acquiring"), never as a holder.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import text

from memory_anki.infrastructure.db._tables.palaces import Palace


def _warning_messages(caplog) -> list[str]:
    return [record.getMessage() for record in caplog.records]


def test_read_only_session_is_never_reported_as_a_write(db_session, caplog):
    """A SELECT-only session must stay completely silent.

    This is the exact bias that made the old instrument untrustworthy: it started
    its timer in ``after_begin``, which SQLAlchemy fires for reads too, so a slow
    read looked identical to a slow write.
    """
    from memory_anki.infrastructure.db._tables import _base

    original = _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS
    _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = 0.05
    try:
        with caplog.at_level(logging.WARNING):
            db_session.execute(text("SELECT 1")).first()
            time.sleep(0.2)  # stand in for slow non-SQL work on a read path
            db_session.commit()
    finally:
        _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = original

    messages = _warning_messages(caplog)
    assert not [m for m in messages if "write transaction HELD" in m], (
        f"a read-only session was reported as holding a write transaction: {messages}"
    )
    assert not [m for m in messages if "WITHOUT ever acquiring" in m], (
        f"a read-only session was reported as a blocked writer: {messages}"
    )


def test_watchdog_names_the_holding_call_site(db_session, caplog):
    """A genuine slow-committing write must name the frame that opened it."""
    from memory_anki.infrastructure.db._tables import _base

    original = _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS
    _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = 0.05
    try:
        with caplog.at_level(logging.WARNING):
            db_session.add(Palace(title="watchdog palace", archived=False, editor_doc="{}"))
            db_session.flush()   # acquires the write lock
            time.sleep(0.2)      # stands in for slow non-SQL work while holding it
            db_session.commit()  # releases it
    finally:
        _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = original

    held = [m for m in _warning_messages(caplog) if "write transaction HELD" in m]
    assert held, f"watchdog did not fire; captured: {_warning_messages(caplog)}"
    assert "test_watchdog_names_the_holding_call_site" in held[0], (
        f"watchdog reported the wrong frame: {held[0]}"
    )


def test_blocked_writer_is_reported_as_victim_not_holder(tmp_path, caplog):
    """A call that cannot get the lock must be labelled a victim.

    Reproduces the production shape: another connection holds the single SQLite
    write lock, so this session's flush burns ``busy_timeout`` and fails. The
    report must say it never acquired the lock -- the old instrument called this
    "held", which is what sent debugging after the wrong function for three
    rounds.

    Needs a real file database: the shared in-memory ``test_engine`` fixture uses
    ``StaticPool`` (one connection for everything), which cannot model two
    connections contending for the same lock.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session as OrmSession

    from memory_anki.infrastructure.db._tables import Base, _base

    db_path = tmp_path / "contended.db"
    url = f"sqlite:///{db_path.as_posix()}"
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 0.3})
    Base.metadata.create_all(engine)

    original = _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS
    _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = 0.05

    holder_conn = engine.connect()
    contender = OrmSession(engine)
    try:
        # Holder takes the write lock for real and keeps it. A dedicated scratch
        # table keeps this about lock ownership, not about Palace's required
        # columns.
        holder_conn.execute(text("BEGIN IMMEDIATE"))
        holder_conn.execute(text("CREATE TABLE holder_probe (id INTEGER PRIMARY KEY)"))
        holder_conn.execute(text("INSERT INTO holder_probe (id) VALUES (1)"))

        with caplog.at_level(logging.WARNING):
            contender.add(Palace(title="contended", archived=False, editor_doc="{}"))
            try:
                contender.flush()  # must fail: the holder owns the single write lock
            except Exception:  # noqa: BLE001 - the failure is the point of the test
                contender.rollback()
                time.sleep(0.2)  # let the rollback's transaction_end run
    finally:
        contender.close()
        holder_conn.rollback()
        holder_conn.close()
        engine.dispose()
        _base.OPEN_WRITE_TRANSACTION_WARN_SECONDS = original

    messages = _warning_messages(caplog)
    victims = [m for m in messages if "WITHOUT ever acquiring" in m]
    holders = [m for m in messages if "write transaction HELD" in m]
    assert victims, f"blocked writer was not reported as a victim; captured: {messages}"
    assert not holders, f"blocked writer was wrongly reported as the holder: {holders}"


def test_watchdog_stays_quiet_for_a_fast_transaction(db_session, caplog):
    """A normal write must not log: the guard has to be free when healthy."""
    with caplog.at_level(logging.WARNING):
        db_session.add(Palace(title="fast palace", archived=False, editor_doc="{}"))
        db_session.commit()

    noisy = [
        m
        for m in _warning_messages(caplog)
        if "write transaction HELD" in m or "WITHOUT ever acquiring" in m
    ]
    assert not noisy, noisy
