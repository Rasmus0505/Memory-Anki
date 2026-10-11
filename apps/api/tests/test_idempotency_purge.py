"""Idempotency cache cleanup and settings pollution guards."""
from datetime import datetime, timedelta

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.settings.presentation.router import read_settings
from memory_anki.platform.persistence import purge_expired_mutation_responses


def test_purge_expired_mutation_responses_deletes_only_old_mutation_rows(db_session):
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

    deleted = purge_expired_mutation_responses(db_session, now=now)

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
    assert "desired_retention" in settings


def test_batched_purge_removes_all_expired_in_small_batches(db_session):
    from datetime import timedelta

    from memory_anki.core.time import utc_now_naive
    from memory_anki.infrastructure.db._tables.misc import Config
    from memory_anki.platform.persistence import purge_expired_mutation_responses

    old = utc_now_naive() - timedelta(days=30)
    db_session.add_all(
        [Config(key=f"api_mutation.old-{i}", value="{}", updated_at=old) for i in range(7)]
        + [Config(key="api_mutation.fresh", value="{}", updated_at=utc_now_naive())]
    )
    db_session.commit()

    assert purge_expired_mutation_responses(db_session, batch_size=3) == 7
    remaining = [row.key for row in db_session.query(Config).filter(Config.key.like("api_mutation.%"))]
    assert remaining == ["api_mutation.fresh"]


def test_read_settings_ignores_receipts_without_scanning_them(db_session):
    from sqlalchemy import text

    from memory_anki.modules.settings.presentation.router import (
        _key_ranges_outside_excluded_prefixes,
        _range_query,
    )

    db_session.add_all(
        [Config(key=f"api_mutation.r{i}", value="x" * 50) for i in range(20)]
        + [Config(key="client_preferences.dev1", value="{}"), Config(key="zzz_custom", value="kept")]
    )
    db_session.commit()

    settings = read_settings(db_session)
    assert settings["zzz_custom"] == "kept"
    assert not any(key.startswith(("api_mutation.", "client_preferences.")) for key in settings)

    for lower, upper in _key_ranges_outside_excluded_prefixes():
        compiled = _range_query(db_session, lower, upper).statement.compile(
            compile_kwargs={"literal_binds": True}
        )
        plan = " ".join(
            str(row[3]) for row in db_session.execute(text(f"EXPLAIN QUERY PLAN {compiled}"))
        )
        assert "SEARCH" in plan, plan
