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
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.infrastructure.llm import AiGatewayError
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    get_external_ai_call_log,
    list_external_ai_call_logs,
    resolve_external_ai_call_log_artifact,
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
from memory_anki.modules.settings.application.ai_model_registry_catalog import (
    normalize_provider_key,
)
from memory_anki.modules.settings.application.ai_prompt_composition import (
    activate_block_version,
    activate_scene_version,
    compile_prompt,
    list_block_versions,
    list_prompt_blocks,
    list_scene_defaults,
    list_scene_versions,
    save_prompt_block,
    save_scene_default,
)
from memory_anki.modules.settings.application.ai_prompt_versions import (
    activate_prompt_version,
    create_prompt_candidates,
    create_reset_candidates,
    get_eval_run,
    list_prompt_versions,
    run_prompt_eval,
)
from memory_anki.modules.settings.application.ai_prompts import (
    AiPromptValidationError,
    list_prompt_templates,
)
from memory_anki.modules.settings.application.ai_quality import build_ai_quality_summary
from memory_anki.modules.settings.application.metrics_service import build_metrics
from memory_anki.modules.settings.presentation.response_models import (
    RuntimeHealthResponse,
    RuntimeInfoResponse,
    SettingsResponse,
)
from memory_anki.platform.application import UnitOfWork
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

router = APIRouter(tags=["settings"])

FSRS_SETTINGS_KEYS = {
    "desired_retention",
    "mastery_horizon_days",
    "maximum_interval",
    "learning_steps",
    "relearning_steps",
    "daily_max_reviews",
    "reinforcement_again_minutes",
    "reinforcement_hard_minutes",
}

CLIENT_PREFERENCE_GROUPS = {
    "memory_anki_shortcuts",
    "review_feedback_settings",
    "english_practice_settings",
    "timer_automation_config",
    "timer_focus_config",
    "break_guard_config",
    "dashboard_duration_filter",
    "study_goals",
    "palace_list_view_settings",
    "palace_shelf_view_settings",
    "review_queue_view_settings",
    "time_record_tags",
}

CLIENT_PREFERENCE_KEY_PREFIX = "client_preferences."
_SETTINGS_EXCLUDED_PREFIXES = (
    "api_mutation.",
    CLIENT_PREFERENCE_KEY_PREFIX,
)


def _like_prefix_pattern(prefix: str) -> str:
    return prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    rows = session.query(Config).filter(
        *[
            Config.key.notlike(_like_prefix_pattern(prefix), escape="\\")
            for prefix in _SETTINGS_EXCLUDED_PREFIXES
        ]
    ).all()
    for row in rows:
        result[row.key] = row.value
    return result


def write_settings(
    data: dict, session: Session, *, uow: UnitOfWork
) -> dict:
    before_settings = read_settings(session)

    keys = [key for key in data if key in DEFAULTS]
    existing_by_key: dict[str, Config] = {}
    if keys:
        existing_by_key = {
            row.key: row
            for row in session.query(Config).filter(Config.key.in_(keys)).all()
        }
    for key in keys:
        next_value = str(data[key])
        row = existing_by_key.get(key)
        if row is not None:
            row.value = next_value
            row.updated_at = utc_now_naive()
        else:
            session.add(Config(key=key, value=next_value))
    next_settings = read_settings(session)
    # FSRS settings apply to future ratings immediately; no legacy stage rebuild.
    del before_settings

    uow.commit()
    return next_settings


def _client_preference_key(group: str) -> str:
    return f"{CLIENT_PREFERENCE_KEY_PREFIX}{group}"


def read_client_preferences(session: Session) -> dict:
    result: dict[str, object | None] = {}
    keys = [_client_preference_key(group) for group in CLIENT_PREFERENCE_GROUPS]
    rows_by_key = {
        row.key: row
        for row in session.query(Config).filter(Config.key.in_(keys)).all()
    }
    for group in CLIENT_PREFERENCE_GROUPS:
        row = rows_by_key.get(_client_preference_key(group))
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


@router.get("/settings", response_model=SettingsResponse)
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings", response_model=SettingsResponse)
def api_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s, uow=SqlAlchemyUnitOfWork(s))


@router.get("/settings/review", response_model=SettingsResponse)
def api_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings/review", response_model=SettingsResponse)
def api_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s, uow=SqlAlchemyUnitOfWork(s))


@router.get("/runtime-info", response_model=RuntimeInfoResponse)
def api_runtime_info():
    return build_runtime_info()


@router.get("/runtime-health", response_model=RuntimeHealthResponse)
def api_runtime_health():
    return build_runtime_health(
        startup_mode=str(os.environ.get("MEMORY_ANKI_STARTUP_MODE") or "serve"),
    )


@router.get("/metrics")
def api_metrics(s: Session = Depends(session_dep)):
    return build_metrics(s)


@router.get("/profile/client-preferences")
def api_get_client_preferences(s: Session = Depends(session_dep)):
    return {"items": read_client_preferences(s)}


@router.put("/profile/client-preferences")
def api_update_client_preferences(data: dict, s: Session = Depends(session_dep)):
    return {"items": write_client_preferences(data if isinstance(data, dict) else {}, s)}


@router.get("/settings/ai-prompts")
def api_ai_prompt_settings(s: Session = Depends(session_dep)):
    return {"items": list_prompt_templates(s)}


@router.get("/settings/ai-prompt-blocks")
def api_ai_prompt_blocks(s: Session = Depends(session_dep)):
    return {"items": list_prompt_blocks(s)}


@router.put("/settings/ai-prompt-blocks/{block_key}")
def api_ai_prompt_block_update(block_key: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return save_prompt_block(s, block_key, data)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/ai-prompt-blocks/{block_key}/versions")
def api_ai_prompt_block_versions(block_key: str, s: Session = Depends(session_dep)):
    try:
        return {"items": list_block_versions(s, block_key)}
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompt-blocks/{block_key}/versions/{version_id}/activate")
def api_ai_prompt_block_version_activate(
    block_key: str,
    version_id: str,
    s: Session = Depends(session_dep),
):
    try:
        return activate_block_version(s, block_key, version_id)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/ai-prompt-scenes")
def api_ai_prompt_scenes(s: Session = Depends(session_dep)):
    return {"items": list_scene_defaults(s)}


@router.put("/settings/ai-prompt-scenes/{scene_key}/default")
def api_ai_prompt_scene_default_update(
    scene_key: str,
    data: dict,
    s: Session = Depends(session_dep),
):
    try:
        return save_scene_default(s, scene_key, data)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/ai-prompt-scenes/{scene_key}/versions")
def api_ai_prompt_scene_versions(scene_key: str, s: Session = Depends(session_dep)):
    try:
        return {"items": list_scene_versions(s, scene_key)}
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompt-scenes/{scene_key}/versions/{version_id}/activate")
def api_ai_prompt_scene_version_activate(
    scene_key: str,
    version_id: str,
    s: Session = Depends(session_dep),
):
    try:
        return activate_scene_version(s, scene_key, version_id)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompt-compose/preview")
def api_ai_prompt_compose_preview(data: dict, s: Session = Depends(session_dep)):
    try:
        scene_key = str(data.get("scene_key") or "")
        variables = data.get("variables") if isinstance(data.get("variables"), dict) else {}
        selection = data.get("selection") if isinstance(data.get("selection"), dict) else None
        return compile_prompt(scene_key, variables, session=s, selection=selection)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/settings/ai-prompts")
def api_ai_prompt_settings_update(data: dict, s: Session = Depends(session_dep)):
    try:
        templates = data.get("templates") if isinstance(data.get("templates"), dict) else data
        normalized_templates = {
            str(key): str(value)
            for key, value in dict(templates or {}).items()
        }
        candidates = create_prompt_candidates(s, normalized_templates)
        return {
            "items": list_prompt_templates(s),
            "candidates": candidates,
            "requires_evaluation": True,
        }
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompts/reset")
def api_ai_prompt_settings_reset(data: dict, s: Session = Depends(session_dep)):
    try:
        keys = data.get("keys")
        if keys is not None and not isinstance(keys, list):
            raise AiPromptValidationError("keys 必须是字符串数组。")
        candidates = create_reset_candidates(
            s,
            keys=[str(key) for key in keys] if keys else None,
        )
        return {
            "items": list_prompt_templates(s),
            "candidates": candidates,
            "requires_evaluation": True,
        }
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings/ai-prompts/{prompt_key}/versions")
def api_ai_prompt_versions(prompt_key: str, s: Session = Depends(session_dep)):
    try:
        return {"items": list_prompt_versions(s, prompt_key)}
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-prompts/{prompt_key}/versions/{version_id}/activate")
def api_ai_prompt_version_activate(
    prompt_key: str,
    version_id: str,
    s: Session = Depends(session_dep),
):
    try:
        return activate_prompt_version(s, prompt_key, version_id)
    except AiPromptValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/settings/ai-evals/runs")
def api_ai_eval_run(data: dict, s: Session = Depends(session_dep)):
    try:
        return run_prompt_eval(
            s,
            str(data.get("prompt_key") or ""),
            str(data.get("candidate_version_id") or ""),
        )
    except (AiPromptValidationError, AiGatewayError, KeyError) as exc:
        detail: dict[str, object] = {
            "message": str(exc),
            "code": "ai_eval_failed",
        }
        if isinstance(exc, AiGatewayError):
            detail.update({"kind": exc.kind.value, "retryable": exc.retryable})
        raise HTTPException(status_code=400, detail=detail) from exc


@router.get("/settings/ai-evals/runs/{run_id}")
def api_ai_eval_run_detail(run_id: str, s: Session = Depends(session_dep)):
    payload = get_eval_run(s, run_id)
    if not payload:
        raise HTTPException(status_code=404, detail="评测运行不存在。")
    return payload


@router.get("/settings/ai-quality/summary")
def api_ai_quality_summary(
    days: int = 7,
    scene: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    s: Session = Depends(session_dep),
):
    return build_ai_quality_summary(
        s,
        days=days,
        scene=scene,
        provider=provider,
        model=model,
    )


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
