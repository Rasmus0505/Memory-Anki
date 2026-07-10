from __future__ import annotations

import math
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import AiEvalRun, AiPromptVersion, ExternalAiCallLog


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return ordered[index]


def build_ai_quality_summary(
    session: Session,
    *,
    days: int = 7,
    scene: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    since = utc_now_naive() - timedelta(days=max(1, min(int(days or 7), 365)))
    query = session.query(ExternalAiCallLog).filter(ExternalAiCallLog.created_at >= since)
    if scene:
        query = query.filter(ExternalAiCallLog.scene == scene)
    if provider:
        query = query.filter(ExternalAiCallLog.provider == provider)
    if model:
        query = query.filter(ExternalAiCallLog.model == model)
    rows = query.all()
    total = len(rows)
    success = sum(1 for row in rows if row.status == "success")
    structured = [row for row in rows if row.structured_output_mode]
    structure_failures = sum(1 for row in rows if row.error_kind == "structure_validation")
    repaired = sum(1 for row in rows if row.repaired_from_log_id)
    durations = [int(row.duration_ms) for row in rows if row.duration_ms is not None]
    error_counts: dict[str, int] = {}
    for row in rows:
        if row.error_kind:
            error_counts[row.error_kind] = error_counts.get(row.error_kind, 0) + 1
    recent_evals = (
        session.query(AiEvalRun).order_by(AiEvalRun.created_at.desc()).limit(10).all()
    )
    candidates = (
        session.query(AiPromptVersion)
        .filter(AiPromptVersion.status.in_(("candidate", "passed", "failed")))
        .order_by(AiPromptVersion.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "range_days": days,
        "filters": {"scene": scene, "provider": provider, "model": model},
        "metrics": {
            "total_calls": total,
            "success_rate": success / total if total else 0.0,
            "structured_success_rate": (
                (len(structured) - structure_failures) / len(structured) if structured else 0.0
            ),
            "repair_rate": repaired / len(structured) if structured else 0.0,
            "p50_duration_ms": _percentile(durations, 0.5),
            "p95_duration_ms": _percentile(durations, 0.95),
            "input_tokens": sum(row.input_tokens for row in rows),
            "output_tokens": sum(row.output_tokens for row in rows),
            "cached_input_tokens": sum(row.cached_input_tokens for row in rows),
            "estimated_cost": sum(row.estimated_cost or 0.0 for row in rows),
            "has_estimated_cost": any(row.estimated_cost is not None for row in rows),
        },
        "errors": [{"kind": key, "count": value} for key, value in sorted(error_counts.items())],
        "recent_evals": [
            {
                "id": row.id,
                "prompt_key": row.prompt_key,
                "status": row.status,
                "case_count": row.case_count,
                "assertion_success_rate": row.assertion_success_rate,
                "gate_passed": row.gate_passed,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in recent_evals
        ],
        "prompt_candidates": [
            {
                "id": row.id,
                "prompt_key": row.prompt_key,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in candidates
        ],
    }
