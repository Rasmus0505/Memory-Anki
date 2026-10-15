"""Palace version history keeps one week, but never drops a palace's newest version."""

from datetime import datetime, timedelta

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceVersion
from memory_anki.modules.backups.application.backup_palace_versions import (
    prune_expired_palace_versions,
)

NOW = datetime(2026, 10, 15, 12, 0, 0)


def _palace(session, title: str) -> Palace:
    palace = Palace(title=title)
    session.add(palace)
    session.flush()
    return palace


def _version(session, palace: Palace, created_at: datetime) -> PalaceVersion:
    version = PalaceVersion(
        palace_id=palace.id,
        trigger_reason="editor_save",
        title=palace.title,
        editor_doc="{}",
        created_at=created_at,
    )
    session.add(version)
    session.flush()
    return version


def test_prune_drops_only_versions_past_the_week(db_session):
    palace = _palace(db_session, "recent-and-old")
    old_id = _version(db_session, palace, NOW - timedelta(days=20)).id
    fresh_id = _version(db_session, palace, NOW - timedelta(days=2)).id
    db_session.commit()

    removed = prune_expired_palace_versions(db_session, now=NOW)

    assert removed == 1
    assert db_session.query(PalaceVersion).filter_by(id=old_id).first() is None
    assert db_session.query(PalaceVersion).filter_by(id=fresh_id).first() is not None


def test_prune_keeps_newest_version_of_a_stale_palace(db_session):
    palace = _palace(db_session, "stale")
    _version(db_session, palace, NOW - timedelta(days=40))
    newest_old = _version(db_session, palace, NOW - timedelta(days=30))
    db_session.commit()

    removed = prune_expired_palace_versions(db_session, now=NOW)

    assert removed == 1
    survivors = db_session.query(PalaceVersion).filter_by(palace_id=palace.id).all()
    assert [version.id for version in survivors] == [newest_old.id]


def test_prune_runs_in_small_batches_until_done(db_session):
    palace = _palace(db_session, "bulk")
    for day in range(30, 60):
        _version(db_session, palace, NOW - timedelta(days=day))
    db_session.commit()

    removed = prune_expired_palace_versions(db_session, now=NOW, batch_size=7)

    assert removed == 29
    assert db_session.query(PalaceVersion).filter_by(palace_id=palace.id).count() == 1
