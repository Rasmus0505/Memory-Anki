from __future__ import annotations

import hashlib
import json
import mimetypes
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_TTS_BASE_URL,
    VOICE_COACH_CACHE_DIR,
)
from memory_anki.infrastructure.db.models import Config

VoiceCoachEvent = Literal[
    "session_start",
    "idle_nudge",
    "edit_idle_nudge",
    "milestone",
    "all_clear_ready",
    "session_complete",
]

VOICE_COACH_TEMPLATES: dict[VoiceCoachEvent, str] = {
    "session_start": "这一轮只做一件事：看当前宫殿，慢慢推进。",
    "idle_nudge": "回来。先看当前节点，想不起就揭开，不纠缠。",
    "edit_idle_nudge": "把注意力放回当前节点，先补一句最小提示。",
    "milestone": "节奏已经起来了，保持这个速度。",
    "all_clear_ready": "这一组已经铺开了，扫一遍红标就可以结算。",
    "session_complete": "结束前看一眼红标，它们就是下次入口。",
}

VOICE_COACH_CONFIG_KEYS = {
    "flow_voice_api_key",
    "flow_voice_base_url",
    "flow_voice_model",
    "flow_voice_voice",
    "flow_voice_format",
    "flow_voice_sample_rate",
    "flow_voice_instruction",
}

SUPPORTED_AUDIO_FORMATS = {"mp3", "wav", "opus", "pcm"}
DEFAULT_MODEL = "cosyvoice-v3-flash"
DEFAULT_VOICE = "longanyang"
DEFAULT_FORMAT = "mp3"
DEFAULT_SAMPLE_RATE = 24000


class VoiceCoachError(RuntimeError):
    pass


class VoiceCoachConfigError(VoiceCoachError):
    pass


class VoiceCoachProtocolError(VoiceCoachError):
    pass


class VoiceCoachHttpError(VoiceCoachError):
    def __init__(self, *, status_code: int, response_body: str):
        self.status_code = status_code
        self.response_body = response_body
        super().__init__(f"HTTP {status_code}")

    @property
    def is_auth_error(self) -> bool:
        return self.status_code in {401, 403}

    @property
    def is_rate_limited(self) -> bool:
        return self.status_code == 429


class VoiceCoachNetworkError(VoiceCoachError):
    pass


@dataclass(frozen=True, slots=True)
class VoiceCoachConfig:
    api_key: str
    base_url: str
    model: str
    voice: str
    audio_format: str
    sample_rate: int
    instruction: str
    timeout_seconds: float = 90.0


@dataclass(frozen=True, slots=True)
class VoiceCoachSynthesisResult:
    event: VoiceCoachEvent
    text: str
    cache_key: str
    audio_url: str
    cached: bool
    model: str
    voice: str
    audio_format: str
    sample_rate: int
    request_id: str


def resolve_voice_coach_config(session: Session) -> VoiceCoachConfig:
    rows = session.query(Config).filter(Config.key.in_(VOICE_COACH_CONFIG_KEYS)).all()
    values = {row.key: row.value for row in rows}

    api_key = _first_non_empty(values.get("flow_voice_api_key"), DASHSCOPE_API_KEY)
    if not api_key:
        raise VoiceCoachConfigError("未配置语音教练 API Key。请在个人中心填写，或设置 DASHSCOPE_API_KEY。")

    audio_format = _sanitize_audio_format(values.get("flow_voice_format"))
    return VoiceCoachConfig(
        api_key=api_key,
        base_url=_first_non_empty(values.get("flow_voice_base_url"), DASHSCOPE_TTS_BASE_URL),
        model=_first_non_empty(values.get("flow_voice_model"), DEFAULT_MODEL),
        voice=_first_non_empty(values.get("flow_voice_voice"), DEFAULT_VOICE),
        audio_format=audio_format,
        sample_rate=_coerce_sample_rate(values.get("flow_voice_sample_rate")),
        instruction=str(values.get("flow_voice_instruction") or "").strip(),
    )


def synthesize_voice_coach_event(
    session: Session,
    event: VoiceCoachEvent,
) -> VoiceCoachSynthesisResult:
    text = VOICE_COACH_TEMPLATES[event]
    config = resolve_voice_coach_config(session)
    cache_key = build_voice_coach_cache_key(config=config, text=text)
    cached_path = cache_path_for(cache_key, config.audio_format)
    if cached_path.exists() and cached_path.stat().st_size > 0:
        return _result(
            event=event,
            text=text,
            config=config,
            cache_key=cache_key,
            cached=True,
            request_id="",
        )

    response_payload = call_dashscope_tts(config=config, text=text)
    audio_url = extract_audio_url(response_payload)
    audio_bytes = download_audio(audio_url, timeout_seconds=config.timeout_seconds)
    if not audio_bytes:
        raise VoiceCoachProtocolError("语音教练接口返回了空音频。")

    cached_path.parent.mkdir(parents=True, exist_ok=True)
    cached_path.write_bytes(audio_bytes)
    metadata_path_for(cache_key).write_text(
        json.dumps(
            {
                "event": event,
                "text": text,
                "model": config.model,
                "voice": config.voice,
                "format": config.audio_format,
                "sample_rate": config.sample_rate,
                "request_id": str(response_payload.get("request_id") or ""),
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return _result(
        event=event,
        text=text,
        config=config,
        cache_key=cache_key,
        cached=False,
        request_id=str(response_payload.get("request_id") or ""),
    )


def build_voice_coach_cache_key(*, config: VoiceCoachConfig, text: str) -> str:
    payload = {
        "model": config.model,
        "voice": config.voice,
        "text": text,
        "instruction": config.instruction,
        "format": config.audio_format,
        "sample_rate": config.sample_rate,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def call_dashscope_tts(*, config: VoiceCoachConfig, text: str) -> dict[str, Any]:
    payload_input: dict[str, Any] = {
        "text": text,
        "voice": config.voice,
        "format": config.audio_format,
        "sample_rate": config.sample_rate,
    }
    if config.instruction:
        payload_input["instruction"] = config.instruction

    payload = {
        "model": config.model,
        "input": payload_input,
    }
    request = urllib.request.Request(
        build_dashscope_tts_url(config.base_url),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            body = response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        raise VoiceCoachHttpError(
            status_code=exc.code,
            response_body=exc.read().decode("utf-8", errors="ignore"),
        ) from exc
    except urllib.error.URLError as exc:
        raise VoiceCoachNetworkError(str(exc.reason)) from exc

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise VoiceCoachProtocolError("语音教练接口返回内容格式异常。") from exc
    if not isinstance(parsed, dict):
        raise VoiceCoachProtocolError("语音教练接口返回内容格式异常。")
    return parsed


def extract_audio_url(payload: dict[str, Any]) -> str:
    candidates = [
        payload.get("url"),
        _dig(payload, "output", "audio", "url"),
        _dig(payload, "output", "url"),
        _dig(payload, "data", "url"),
        _dig(payload, "result", "url"),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    raise VoiceCoachProtocolError("语音教练接口未返回音频 URL。")


def download_audio(url: str, *, timeout_seconds: float) -> bytes:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise VoiceCoachHttpError(
            status_code=exc.code,
            response_body=exc.read().decode("utf-8", errors="ignore"),
        ) from exc
    except urllib.error.URLError as exc:
        raise VoiceCoachNetworkError(str(exc.reason)) from exc


def resolve_cached_audio(cache_key: str) -> tuple[Path, str] | None:
    if not re.fullmatch(r"[a-f0-9]{64}", cache_key):
        return None
    for audio_format in sorted(SUPPORTED_AUDIO_FORMATS):
        path = cache_path_for(cache_key, audio_format)
        if path.exists() and path.is_file():
            mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            return path, mime_type
    return None


def build_dashscope_tts_url(base_url: str) -> str:
    trimmed = str(base_url or "").strip().rstrip("/")
    if trimmed.endswith("/services/audio/tts/SpeechSynthesizer"):
        return trimmed
    return f"{trimmed}/services/audio/tts/SpeechSynthesizer"


def cache_path_for(cache_key: str, audio_format: str) -> Path:
    return VOICE_COACH_CACHE_DIR / f"{cache_key}.{audio_format}"


def metadata_path_for(cache_key: str) -> Path:
    return VOICE_COACH_CACHE_DIR / f"{cache_key}.json"


def _result(
    *,
    event: VoiceCoachEvent,
    text: str,
    config: VoiceCoachConfig,
    cache_key: str,
    cached: bool,
    request_id: str,
) -> VoiceCoachSynthesisResult:
    return VoiceCoachSynthesisResult(
        event=event,
        text=text,
        cache_key=cache_key,
        audio_url=f"/api/v1/voice-coach/audio/{cache_key}",
        cached=cached,
        model=config.model,
        voice=config.voice,
        audio_format=config.audio_format,
        sample_rate=config.sample_rate,
        request_id=request_id,
    )


def _dig(value: dict[str, Any], *path: str) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_non_empty(*values: str | None) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _sanitize_audio_format(value: str | None) -> str:
    candidate = str(value or DEFAULT_FORMAT).strip().lower()
    return candidate if candidate in SUPPORTED_AUDIO_FORMATS else DEFAULT_FORMAT


def _coerce_sample_rate(value: str | None) -> int:
    try:
        sample_rate = int(str(value or "").strip())
    except ValueError:
        return DEFAULT_SAMPLE_RATE
    return sample_rate if sample_rate > 0 else DEFAULT_SAMPLE_RATE
