"""Idempotency cache cleanup and settings pollution guards."""
from datetime import datetime, timedelta

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.persistence.application.idempotency import (
    purge_expired_idempotency_records,
)
from memory_anki.modules.settings.presentation.router import read_settings


def test_purge_expired_idempotency_records_deletes_only_old_mutation_rows(db_session):
    now = datetime(2026, 1, 20, 12, 0, 0)
    old = now - timedelta(days=15)
    fresh = now - timedelta(days=1)
    db_session.add_all(
        [
            Config(key="api_mutation.old", value='{"ok": true}', updated_at=old),
            Config(key="api_mutation.fresh", value='{"ok": true}', updated_at=fresh),
            Config(key="apiXmutation.lookalike", value="keep", updated_at=old),
            Config(key="ordinary.setting", value="keep", updated_at=old),
        ]
    )
    db_session.commit()

    deleted = purge_expired_idempotency_records(db_session, now=now)

    assert deleted == 1
    assert db_session.query(Config).filter_by(key="api_mutation.old").first() is None
    assert db_session.query(Config).filter_by(key="api_mutation.fresh").first() is not None
    assert db_session.query(Config).filter_by(key="apiXmutation.lookalike").first() is not None
    assert db_session.query(Config).filter_by(key="ordinary.setting").first() is not None


def test_read_settings_excludes_mutation_and_client_preference_prefixes(db_session):
    db_session.add_all(
        [
            Config(key="api_mutation.cached-response", value='{"large": true}'),
            Config(key="client_preferences.review_feedback_settings", value='{"sound": false}'),
            Config(key="clientXpreferences.lookalike", value="visible"),
            Config(key="historical_top_level_setting", value="still-visible"),
        ]
    )
    db_session.commit()

    settings = read_settings(db_session)

    assert "api_mutation.cached-response" not in settings
    assert "client_preferences.review_feedback_settings" not in settings
    assert settings["clientXpreferences.lookalike"] == "visible"
    assert settings["historical_top_level_setting"] == "still-visible"
    assert "ebbinghaus_intervals" in settings
