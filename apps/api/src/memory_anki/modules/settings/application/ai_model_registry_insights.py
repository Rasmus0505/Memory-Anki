from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog

from .ai_model_registry_catalog import canonicalize_provider_config_scope
from .ai_model_registry_contracts import AiProviderKey


def _aggregate_provider_insights_by_config_scope(
    provider_insights: dict[str, Any],
) -> dict[AiProviderKey, dict[str, Any]]:
    aggregated: dict[AiProviderKey, dict[str, Any]] = {}
    for provider_key, activity in provider_insights.items():
        canonical_provider = canonicalize_provider_config_scope(provider_key)
        if canonical_provider is None or not isinstance(activity, dict):
            continue
        existing = aggregated.setdefault(
            canonical_provider,
            {
                "last_called_at": None,
                "last_status": None,
                "last_model": None,
                "last_success_at": None,
                "last_error_at": None,
            },
        )
        last_called_at = activity.get("last_called_at")
        if last_called_at and (
            existing["last_called_at"] is None
            or last_called_at > existing["last_called_at"]
        ):
            existing["last_called_at"] = last_called_at
            existing["last_status"] = activity.get("last_status")
            existing["last_model"] = activity.get("last_model")
        last_success_at = activity.get("last_success_at")
        if last_success_at and (
            existing["last_success_at"] is None
            or last_success_at > existing["last_success_at"]
        ):
            existing["last_success_at"] = last_success_at
        last_error_at = activity.get("last_error_at")
        if last_error_at and (
            existing["last_error_at"] is None
            or last_error_at > existing["last_error_at"]
        ):
            existing["last_error_at"] = last_error_at
    return aggregated


def _load_ai_log_insights(session: Session, *, limit: int = 800) -> dict[str, Any]:
    rows = (
        session.query(ExternalAiCallLog)
        .order_by(ExternalAiCallLog.created_at.desc(), ExternalAiCallLog.id.desc())
        .limit(max(1, min(limit, 5000)))
        .all()
    )
    latest_scene_success_runtime: dict[str, dict[str, Any]] = {}
    latest_scene_activity: dict[str, dict[str, Any]] = {}
    latest_provider_activity: dict[str, dict[str, Any]] = {}
    latest_model_activity: dict[str, dict[str, Any]] = {}
    recent_success_count = 0

    for row in rows:
        if row.status == "success":
            recent_success_count += 1
        created_at = row.created_at.isoformat() if row.created_at else None
        provider_entry = latest_provider_activity.setdefault(
            row.provider,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "last_model": row.model,
                "last_success_at": None,
                "last_error_at": None,
            },
        )
        if row.status == "success" and provider_entry["last_success_at"] is None:
            provider_entry["last_success_at"] = created_at
        if row.status == "error" and provider_entry["last_error_at"] is None:
            provider_entry["last_error_at"] = created_at

        model_entry = latest_model_activity.setdefault(
            row.model,
            {
                "last_used_at": created_at,
                "last_status": row.status,
            },
        )
        if model_entry["last_used_at"] is None:
            model_entry["last_used_at"] = created_at
            model_entry["last_status"] = row.status

        try:
            request_payload = json.loads(row.request_json or "{}")
        except json.JSONDecodeError:
            continue
        resolved_ai = request_payload.get("resolved_ai")
        if not isinstance(resolved_ai, dict):
            continue
        scene_key = str(resolved_ai.get("scene_key") or "").strip()
        if not scene_key:
            continue
        latest_scene_activity.setdefault(
            scene_key,
            {
                "last_called_at": created_at,
                "last_status": row.status,
                "resolved_provider": resolved_ai.get("provider"),
                "resolved_model_label": resolved_ai.get("model_label"),
                "latest_resolved_model": resolved_ai,
            },
        )
        if row.status == "success" and scene_key not in latest_scene_success_runtime:
            latest_scene_success_runtime[scene_key] = resolved_ai

    return {
        "recent_success_count": recent_success_count,
        "providers": latest_provider_activity,
        "models": latest_model_activity,
        "scenes": latest_scene_activity,
        "latest_scene_success_runtime": latest_scene_success_runtime,
    }
