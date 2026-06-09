from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Config
from memory_anki.modules.voice_coach import application as service
from memory_anki.modules.voice_coach import presentation


@pytest.fixture()
def db_session(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", "env-key")
    monkeypatch.setattr(service, "DASHSCOPE_TTS_BASE_URL", "https://dashscope.test/api/v1")
    monkeypatch.setattr(service, "VOICE_COACH_CACHE_DIR", tmp_path / "voice_coach")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as session:
        yield session


def test_config_falls_back_to_environment_values(db_session):
    config = service.resolve_voice_coach_config(db_session)

    assert config.api_key == "env-key"
    assert config.base_url == "https://dashscope.test/api/v1"
    assert config.model == "cosyvoice-v3-flash"
    assert config.voice == "longanyang"
    assert config.audio_format == "mp3"
    assert config.sample_rate == 24000


def test_config_raises_clear_error_when_api_key_is_missing(db_session, monkeypatch):
    monkeypatch.setattr(service, "DASHSCOPE_API_KEY", None)
    db_session.add(Config(key="flow_voice_api_key", value=""))
    db_session.commit()

    with pytest.raises(service.VoiceCoachConfigError, match="API Key"):
        service.resolve_voice_coach_config(db_session)


def test_synthesize_downloads_audio_and_writes_cache(db_session, monkeypatch):
    calls: list[str] = []

    def fake_call_dashscope_tts(*, config, text):
        calls.append(text)
        return {
            "request_id": "request-1",
            "output": {"audio": {"url": "https://audio.test/session.mp3"}},
        }

    monkeypatch.setattr(service, "call_dashscope_tts", fake_call_dashscope_tts)
    monkeypatch.setattr(service, "download_audio", lambda *_args, **_kwargs: b"mp3-bytes")

    result = service.synthesize_voice_coach_event(db_session, "session_start")

    assert result.cached is False
    assert result.request_id == "request-1"
    assert calls == [service.VOICE_COACH_TEMPLATES["session_start"]]
    assert service.cache_path_for(result.cache_key, "mp3").read_bytes() == b"mp3-bytes"


def test_synthesize_uses_cache_without_calling_provider(db_session, monkeypatch):
    config = service.resolve_voice_coach_config(db_session)
    cache_key = service.build_voice_coach_cache_key(
        config=config,
        text=service.VOICE_COACH_TEMPLATES["idle_nudge"],
    )
    service.cache_path_for(cache_key, "mp3").parent.mkdir(parents=True, exist_ok=True)
    service.cache_path_for(cache_key, "mp3").write_bytes(b"cached-audio")

    def fail_provider_call(**_kwargs):
        raise AssertionError("provider should not be called on cache hit")

    monkeypatch.setattr(service, "call_dashscope_tts", fail_provider_call)

    result = service.synthesize_voice_coach_event(db_session, "idle_nudge")

    assert result.cached is True
    assert result.cache_key == cache_key


def test_extract_audio_url_accepts_nested_dashscope_shape():
    payload = {"output": {"audio": {"url": "https://audio.test/file.mp3"}}}

    assert service.extract_audio_url(payload) == "https://audio.test/file.mp3"


def test_extract_audio_url_rejects_missing_url():
    with pytest.raises(service.VoiceCoachProtocolError, match="音频 URL"):
        service.extract_audio_url({"output": {}})


def test_resolve_cached_audio_validates_cache_key(db_session):
    assert service.resolve_cached_audio("not-a-cache-key") is None


def test_audio_route_returns_cached_file(db_session):
    cache_key = "a" * 64
    service.cache_path_for(cache_key, "mp3").parent.mkdir(parents=True, exist_ok=True)
    service.cache_path_for(cache_key, "mp3").write_bytes(b"cached-audio")
    app = FastAPI()
    app.include_router(presentation.router, prefix="/api/v1")
    client = TestClient(app)

    response = client.get(f"/api/v1/voice-coach/audio/{cache_key}")

    assert response.status_code == 200
    assert response.content == b"cached-audio"
