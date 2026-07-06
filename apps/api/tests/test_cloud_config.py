from memory_anki.core.config import resolve_cors_origins
from memory_anki.infrastructure.db._tables import _base


def test_resolve_cors_origins_defaults_to_wildcard_for_local_development():
    assert resolve_cors_origins("") == ["*"]


def test_resolve_cors_origins_parses_comma_separated_allowlist():
    assert resolve_cors_origins(
        " https://memory-anki.vercel.app,https://preview.vercel.app , "
    ) == [
        "https://memory-anki.vercel.app",
        "https://preview.vercel.app",
    ]


def test_cloud_init_db_uses_metadata_bootstrap(monkeypatch):
    calls: list[str] = []

    monkeypatch.setattr(_base, "is_cloud_deploy", lambda: True)
    monkeypatch.setattr(_base, "run_migrations", lambda: calls.append("migrations"))
    monkeypatch.setattr(
        _base.Base.metadata,
        "create_all",
        lambda **kwargs: calls.append(f"create_all:{kwargs['checkfirst']}"),
    )

    _base.init_db()

    assert calls == ["create_all:True"]
