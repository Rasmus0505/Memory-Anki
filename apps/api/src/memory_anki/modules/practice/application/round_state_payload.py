"""Serialization and read-only payload projection for persisted round state."""

from __future__ import annotations

import json
from typing import Any

from memory_anki.core.time import to_api_datetime
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.practice.domain.round_plan import normalize_plan
from memory_anki.modules.practice.domain.workspace import normalize_workspace


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_dump(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True)


def _json_load_object(raw: str | None) -> dict[str, Any]:
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _plan_of(row: FreestyleRoundState) -> dict[str, Any]:
    return normalize_plan(_json_load_object(row.plan_json))


def _fingerprint(row: FreestyleRoundState, plan: dict[str, Any] | None = None) -> str:
    return _json_dump(
        {
            "status": row.status,
            "config": _json_load_object(row.config_json),
            "plan": plan if plan is not None else _plan_of(row),
            "current_card_id": row.current_card_id,
            "scope_key": row.scope_key,
        }
    )


def _payload(
    row: FreestyleRoundState,
    *,
    conflict: bool = False,
    duplicate: bool = False,
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = _json_load_object(row.config_json)
    resolved_plan = normalize_plan(plan if plan is not None else _json_load_object(row.plan_json))
    version = int(row.version or 1)
    current = resolved_plan.get("current_card_id")
    if current is None:
        current = row.current_card_id
    return {
        "round_id": row.round_id,
        "workspace": normalize_workspace(getattr(row, "workspace", None)),
        "scope_key": row.scope_key,
        "status": row.status,
        "version": version,
        "plan_version": version,
        "config": _json_object(config),
        "plan": resolved_plan,
        "current_card_id": current,
        "last_operation_id": row.last_operation_id,
        "updated_at": to_api_datetime(row.updated_at) if row.updated_at else None,
        "conflict": conflict,
        "duplicate": duplicate,
    }


