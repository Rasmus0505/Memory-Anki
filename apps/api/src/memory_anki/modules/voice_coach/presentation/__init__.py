from __future__ import annotations

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.voice_coach.application import (
    VOICE_COACH_TEMPLATES,
    VoiceCoachConfigError,
    VoiceCoachHttpError,
    VoiceCoachNetworkError,
    VoiceCoachProtocolError,
    resolve_cached_audio,
    synthesize_voice_coach_event,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter(tags=["voice-coach"])


class VoiceCoachSynthesizeRequest(BaseModel):
    event: Literal[
        "session_start",
        "idle_nudge",
        "edit_idle_nudge",
        "milestone",
        "all_clear_ready",
        "session_complete",
    ]
    ai_options: dict | None = None


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


@router.post("/voice-coach/synthesize")
def api_synthesize_voice_coach(
    data: VoiceCoachSynthesizeRequest,
    s: Session = Depends(session_dep),
):
    try:
        result = synthesize_voice_coach_event(
            s,
            data.event,
            ai_options=normalize_ai_runtime_options(data.ai_options),
        )
    except VoiceCoachConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except VoiceCoachProtocolError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except VoiceCoachHttpError as exc:
        detail = exc.response_body.strip()
        if exc.is_auth_error:
            message = f"语音教练接口鉴权失败：HTTP {exc.status_code} {detail}".strip()
            raise HTTPException(status_code=502, detail=message) from exc
        if exc.is_rate_limited:
            message = f"语音教练接口限流：HTTP {exc.status_code} {detail}".strip()
            raise HTTPException(status_code=429, detail=message) from exc
        message = f"语音教练接口调用失败：HTTP {exc.status_code} {detail}".strip()
        raise HTTPException(status_code=502, detail=message) from exc
    except VoiceCoachNetworkError as exc:
        raise HTTPException(status_code=502, detail=f"语音教练接口网络异常：{exc}") from exc
    return {
        "ok": True,
        **asdict(result),
    }


@router.get("/voice-coach/audio/{cache_key}")
def api_get_voice_coach_audio(cache_key: str):
    resolved = resolve_cached_audio(cache_key)
    if not resolved:
        raise HTTPException(status_code=404, detail="语音教练音频不存在。")
    path, mime_type = resolved
    return FileResponse(path, media_type=mime_type, filename=f"{cache_key}{path.suffix}")


@router.get("/voice-coach/templates")
def api_get_voice_coach_templates():
    return {"items": VOICE_COACH_TEMPLATES}
