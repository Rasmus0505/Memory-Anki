import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.core.config import DEFAULTS
from memory_anki.core.runtime import build_runtime_health, build_runtime_info
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Config, get_session
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log,
    list_external_ai_call_logs,
    resolve_external_ai_call_log_artifact,
)
from memory_anki.modules.reviews.application.schedule_service import (
    normalize_algorithm,
    update_all_pending_schedules,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiModelRegistryError,
    delete_ai_model_catalog_item,
    get_ai_model_impact,
    list_model_scenarios,
    save_ai_model_settings,
    test_model_connection,
    test_provider_connection,
    upsert_ai_model_catalog_item,
)
from memory_anki.modules.settings.application.ai_model_registry_catalog import normalize_provider_key
from memory_anki.modules.settings.application.ai_prompts import (
    AiPromptValidationError,
    list_prompt_templates,
    reset_prompt_templates,
    save_prompt_templates,
)

router = APIRouter(tags=["settings"])

SCHEDULE_IMPACTING_KEYS = {
    "default_algorithm",
    "custom_intervals",
    "ebbinghaus_intervals",
    "sleep_review_time",
    "early_review_anchor",
}

CLIENT_PREFERENCE_GROUPS = {
    "memory_anki_shortcuts",
    "review_feedback_settings",
    "english_practice_settings",
    "timer_automation_config",
    "timer_focus_config",
    "dashboard_duration_filter",
    "palace_list_view_settings",
    "palace_shelf_view_settings",
    "voice_coach_settings",
}

CLIENT_PREFERENCE_KEY_PREFIX = "client_preferences."


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    for row in session.query(Config).all():
        result[row.key] = normalize_algorithm(row.value) if row.key == "default_algorithm" else row.value
    return result


def write_settings(data: dict, session: Session) -> dict:
    before_settings = read_settings(session)

    for key, value in data.items():
        if key in DEFAULTS:
            nextValue = normalize_algorithm(value) if key == "default_algorithm" else value
            row = session.query(Config).filter_by(key=key).first()
            if row:
                row.value = str(nextValue)
                row.updated_at = utc_now_naive()
            else:
                session.add(Config(key=key, value=str(nextValue)))
    session.commit()

    next_settings = read_settings(session)
    if data.get("apply_to_pending") == "all":
        changed_keys = {
            key
            for key in SCHEDULE_IMPACTING_KEYS
            if str(before_settings.get(key, "")) != str(next_settings.get(key, ""))
        }
        if changed_keys:
            update_all_pending_schedules(
                session,
                next_settings.get("default_algorithm"),
            )
            next_settings = read_settings(session)

    return next_settings


def _client_preference_key(group: str) -> str:
    return f"{CLIENT_PREFERENCE_KEY_PREFIX}{group}"


def read_client_preferences(session: Session) -> dict:
    result: dict[str, object | None] = {}
    for group in CLIENT_PREFERENCE_GROUPS:
        row = session.query(Config).filter_by(key=_client_preference_key(group)).first()
        if not row or not row.value:
            result[group] = None
            continue
        try:
            result[group] = json.loads(row.value)
        except Exception:
            result[group] = None
    return result


def write_client_preferences(data: dict, session: Session) -> dict:
    next_preferences = read_client_preferences(session)
    for group in CLIENT_PREFERENCE_GROUPS:
        if group not in data:
            continue
        value = data.get(group)
        payload = "" if value is None else json.dumps(value, ensure_ascii=False)
        row = session.query(Config).filter_by(key=_client_preference_key(group)).first()
        if row:
            row.value = payload
            row.updated_at = utc_now_naive()
        else:
            session.add(Config(key=_client_preference_key(group), value=payload))
        next_preferences[group] = value
    session.commit()
    return next_preferences


@router.get("/settings")
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings")
def api_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/settings/review")
def api_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings/review")
def api_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/profile/review-settings")
def api_profile_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/profile/review-settings")
def api_profile_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/runtime-info")
def api_runtime_info():
    return build_runtime_info()


@router.get("/runtime-health")
def api_runtime_health():
    return build_runtime_health(
        startup_mode=str(os.environ.get("MEMORY_ANKI_STARTUP_MODE") or "serve"),
    )


@router.get("/profile/client-preferences")
def api_get_client_preferences(s: Session = Depends(session_dep)):
    return {"items": read_client_preferences(s)}


@router.put("/profile/client-preferences")
def api_update_client_preferences(data: dict, s: Session = Depends(session_dep)):
    return {"items": write_client_preferences(data if isinstance(data, dict) else {}, s)}


@router.get("/settings/ai-prompts")
def api_ai_prompt_settings(s: Session = Depends(session_dep)):
    return {"items": list_prompt_templates(s)}


@router.put("/settings/ai-prompts")
def api_ai_prompt_settings_update(data: dict, s: Session = Depends(session_dep)):
    try:
        templates = data.get("templates") if isinstance(data.get("templates"), dict) else data
        normalized_templates = {
            str(key): str(value)
            for key, value in dict(templates or {}).items()
        }
        return {"items": save_prompt_templates(s, normalized_templates)}
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompts/reset")
def api_ai_prompt_settings_reset(data: dict, s: Session = Depends(session_dep)):
    try:
        keys = data.get("keys")
        if keys is not None and not isinstance(keys, list):
            raise AiPromptValidationError("keys 必须是字符串数组。")
        return {
            "items": reset_prompt_templates(
                s,
                keys=[str(key) for key in keys] if keys else None,
            )
        }
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/ai-models")
def api_ai_model_scenarios(s: Session = Depends(session_dep)):
    return list_model_scenarios(s)


@router.put("/settings/ai-models")
def api_ai_model_scenarios_update(data: dict, s: Session = Depends(session_dep)):
    scene_updates = data.get("scene_updates") if isinstance(data.get("scene_updates"), dict) else None
    scenario_updates = data.get("scenario_updates") if isinstance(data.get("scenario_updates"), dict) else None
    category_updates = data.get("category_updates") if isinstance(data.get("category_updates"), dict) else None
    provider_updates = data.get("provider_updates") if isinstance(data.get("provider_updates"), dict) else None
    if scene_updates is None and scenario_updates is None and category_updates is None and provider_updates is None:
        legacy_updates = data.get("updates") if isinstance(data.get("updates"), dict) else data
        normalized_legacy_updates: dict[str, dict[str, Any]] = {}
        for key, value in dict(legacy_updates or {}).items():
            scenario_key = str(key)
            if isinstance(value, dict):
                normalized_legacy_updates[scenario_key] = value
            else:
                normalized_legacy_updates[scenario_key] = {"default_model": str(value)}
        scene_updates = normalized_legacy_updates
    return save_ai_model_settings(
        s,
        scene_updates=scene_updates or scenario_updates,
        category_updates=category_updates,
        provider_updates=provider_updates,
    )


@router.post("/settings/ai-models/models")
def api_ai_model_catalog_upsert(data: dict, s: Session = Depends(session_dep)):
    try:
        return upsert_ai_model_catalog_item(s, data if isinstance(data, dict) else {})
    except AiModelRegistryError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "code": exc.code, **(exc.details or {})},
        ) from exc


@router.get("/settings/ai-models/models/{model_key}/impact")
def api_ai_model_catalog_impact(model_key: str, s: Session = Depends(session_dep)):
    return get_ai_model_impact(s, model_key)


@router.post("/settings/ai-models/models/{model_key}/test")
def api_ai_model_catalog_test(model_key: str, s: Session = Depends(session_dep)):
    try:
        return test_model_connection(s, model_key)
    except AiModelRegistryError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "code": exc.code, **(exc.details or {})},
        ) from exc


@router.post("/settings/ai-models/providers/{provider_key}/test")
def api_ai_provider_test(provider_key: str, data: dict | None = None, s: Session = Depends(session_dep)):
    normalized_provider = normalize_provider_key(provider_key)
    if normalized_provider is None:
        raise HTTPException(status_code=400, detail={"message": "Provider 无效。", "code": "provider_invalid"})
    model_key = None
    if isinstance(data, dict):
        model_key = data.get("model_key")
    try:
        return test_provider_connection(s, normalized_provider, model_key=model_key)
    except AiModelRegistryError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "code": exc.code, **(exc.details or {})},
        ) from exc


@router.delete("/settings/ai-models/models/{model_key}")
def api_ai_model_catalog_delete(model_key: str, s: Session = Depends(session_dep)):
    try:
        return delete_ai_model_catalog_item(s, model_key)
    except AiModelRegistryError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "code": exc.code, **(exc.details or {})},
        ) from exc


@router.get("/ai-call-logs")
def api_list_ai_call_logs(
    job_id: str | None = None,
    palace_id: int | None = None,
    provider: str | None = None,
    model: str | None = None,
    feature: str | None = None,
    status: str | None = None,
    limit: int = 50,
    s: Session = Depends(session_dep),
):
    return {
        "items": list_external_ai_call_logs(
            s,
            job_id=job_id,
            palace_id=palace_id,
            provider=provider,
            model=model,
            feature=feature,
            status=status,
            limit=limit,
        )
    }


@router.get("/ai-call-logs/{log_id}")
def api_get_ai_call_log(log_id: str, s: Session = Depends(session_dep)):
    payload = get_external_ai_call_log(s, log_id)
    if not payload:
        raise HTTPException(status_code=404, detail="AI 调用日志不存在。")
    return payload


@router.get("/ai-call-logs/{log_id}/artifacts/{artifact_name}")
def api_get_ai_call_log_artifact(log_id: str, artifact_name: str):
    if Path(artifact_name).name != artifact_name:
        raise HTTPException(status_code=400, detail="工件名无效。")
    resolved = resolve_external_ai_call_log_artifact(log_id, artifact_name)
    if not resolved:
        raise HTTPException(status_code=404, detail="AI 调用日志工件不存在。")
    path, mime_type = resolved
    return FileResponse(path, media_type=mime_type, filename=path.name)
