from typing import NoReturn

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.application.calibration_service import (
    diagnose_palace,
    preview_or_apply_calibration,
    undo_calibration,
)
from memory_anki.modules.memory.application.formal_review_service import (
    clear_formal_review_progress,
    complete_formal_review,
    formal_review_completion_summary,
    formal_review_session_payload,
    get_formal_review_progress,
    get_fsrs_completion,
    get_fsrs_load_forecast,
    get_fsrs_queue_payload,
    rate_out_of_scope_due_formal_review_nodes,
    rate_unrated_formal_review_nodes,
    resolve_formal_review_session,
    save_formal_review_progress,
    start_or_resume_formal_review,
)
from memory_anki.modules.memory.application.node_memory_service import (
    get_completion_summary,
    get_palace_mastery_trend,
    get_palace_memory_projection,
    rate_nodes,
    undo_rating_operation,
)
from memory_anki.modules.memory.application.review_metrics_service import (
    get_weekly_stats,
    list_recent_review_notes,
)
from memory_anki.modules.memory.application.wave_service import (
    get_wave_detail,
    list_palace_waves,
    merge_new_due_into_wave,
    pause_formal_wave,
    resume_formal_wave,
    start_reinforcement_wave_session,
)
from memory_anki.modules.memory.presentation.response_models import (
    MasteryTrendResponse,
    OverdueCountResponse,
    ReviewQueueResponse,
    SubmitReviewResponse,
)
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["review"])


def raise_not_found(message: str = "not found") -> NoReturn:
    raise HTTPException(status_code=404, detail=message)


@router.get("/review/overdue-count", response_model=OverdueCountResponse)
def api_overdue(session: Session = Depends(session_dep)):
    return {"count": get_fsrs_queue_payload(session)["overdue_count"]}


@router.get("/review/stats/weekly")
def api_stats(session: Session = Depends(session_dep)):
    return get_weekly_stats(session)


@router.get("/review/notes")
def api_review_notes(limit: int = 20, session: Session = Depends(session_dep)):
    return {"items": list_recent_review_notes(session, limit)}


@router.get("/review/load-forecast")
def api_load_forecast(days: int = 7, session: Session = Depends(session_dep)):
    return get_fsrs_load_forecast(session, days)


@router.get("/review/today-plan")
def api_today_plan(session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.insight_service import (
        today_plan_payload,
    )

    payload = today_plan_payload(session)
    session.commit()  # 幂等放出的新学卡需要落库
    return {"item": payload}


@router.post("/review/preview-intervals")
def api_preview_intervals(data: dict, session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.insight_service import (
        preview_intervals_payload,
    )

    items = data.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items must be a list")
    return {"items": preview_intervals_payload(session, items=items)}


@router.get("/review/palaces/{palace_id}/nodes/{node_uid}/schedule-detail")
def api_schedule_detail(
    palace_id: int, node_uid: str, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.insight_service import (
        schedule_detail_payload,
    )

    return {"item": schedule_detail_payload(session, palace_id=palace_id, node_uid=node_uid)}


@router.post("/review/simulate-load")
def api_simulate_load(data: dict, session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.insight_service import (
        simulate_load_payload,
    )

    try:
        retention = float(data.get("desired_retention"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="desired_retention required") from exc
    days = int(data.get("days") or 30)
    return {"item": simulate_load_payload(session, desired_retention=retention, days=days)}


@router.get("/review/palaces/{palace_id}/settings")
def api_get_palace_review_settings(
    palace_id: int, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        get_palace_review_settings,
    )

    row = get_palace_review_settings(session, palace_id)
    return {
        "item": {
            "palace_id": palace_id,
            "aggregation_enabled": bool(row.aggregation_enabled) if row else False,
            "aggregation_max_pull_days": row.aggregation_max_pull_days if row else None,
            "aggregation_max_push_days": row.aggregation_max_push_days if row else None,
            "daily_new_limit_override": row.daily_new_limit_override if row else None,
            "daily_review_limit_override": row.daily_review_limit_override if row else None,
        }
    }


@router.put("/review/palaces/{palace_id}/settings")
def api_put_palace_review_settings(
    palace_id: int, data: dict, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        clear_aggregation,
        upsert_palace_review_settings,
    )

    def _opt_int(key: str):
        if key not in data:
            return ...
        value = data.get(key)
        return None if value is None else int(value)

    row = upsert_palace_review_settings(
        session,
        palace_id,
        aggregation_enabled=(
            bool(data["aggregation_enabled"]) if "aggregation_enabled" in data else None
        ),
        aggregation_max_pull_days=_opt_int("aggregation_max_pull_days"),
        aggregation_max_push_days=_opt_int("aggregation_max_push_days"),
        daily_new_limit_override=_opt_int("daily_new_limit_override"),
        daily_review_limit_override=_opt_int("daily_review_limit_override"),
    )
    cleared = 0
    if data.get("aggregation_enabled") is False:
        cleared = clear_aggregation(session, palace_id=palace_id)
    session.commit()
    return {
        "item": {
            "palace_id": palace_id,
            "aggregation_enabled": bool(row.aggregation_enabled),
            "aggregation_max_pull_days": row.aggregation_max_pull_days,
            "aggregation_max_push_days": row.aggregation_max_push_days,
            "daily_new_limit_override": row.daily_new_limit_override,
            "daily_review_limit_override": row.daily_review_limit_override,
            "aggregation_cleared_count": cleared,
        }
    }


def _aggregation_move_payload(move) -> dict:
    return {
        "node_uid": move.node_uid,
        "raw_due_local": move.raw_due_local.isoformat(),
        "target_local": move.target_local.isoformat(),
        "retention_drop_pp": move.retention_drop_pp,
    }


@router.post("/review/palaces/{palace_id}/aggregation/preview")
def api_aggregation_preview(
    palace_id: int, data: dict | None = None, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        compute_aggregation,
    )

    horizon = int((data or {}).get("horizon_days") or 30)
    preview = compute_aggregation(session, palace_id=palace_id, horizon_days=horizon)
    return {
        "item": {
            "palace_id": palace_id,
            "horizon_days": preview.horizon_days,
            "moves": [_aggregation_move_payload(m) for m in preview.moves],
            "day_counts_before": preview.day_counts_before,
            "day_counts_after": preview.day_counts_after,
        }
    }


@router.post("/review/palaces/{palace_id}/aggregation/apply")
def api_aggregation_apply(
    palace_id: int, data: dict | None = None, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        apply_aggregation,
        compute_aggregation,
    )

    horizon = int((data or {}).get("horizon_days") or 30)
    preview = compute_aggregation(session, palace_id=palace_id, horizon_days=horizon)
    applied = apply_aggregation(session, palace_id=palace_id, preview=preview)
    session.commit()
    return {
        "item": {
            "palace_id": palace_id,
            "applied_count": applied,
            "moves": [_aggregation_move_payload(m) for m in preview.moves],
        }
    }


@router.post("/review/palaces/{palace_id}/aggregation/clear")
def api_aggregation_clear(palace_id: int, session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        clear_aggregation,
    )

    cleared = clear_aggregation(session, palace_id=palace_id)
    session.commit()
    return {"item": {"palace_id": palace_id, "cleared_count": cleared}}


@router.post("/review/fsrs/optimize")
def api_fsrs_optimize(
    background_tasks: BackgroundTasks, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.optimizer_service import (
        run_optimization,
        start_optimization,
    )

    try:
        result = start_optimization(session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    background_tasks.add_task(run_optimization, result["parameter_set_id"])
    return {"item": result}


@router.get("/review/fsrs/optimize/status")
def api_fsrs_optimize_status(session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.optimizer_service import (
        optimization_status,
    )

    return {"item": optimization_status(session)}


@router.post("/review/fsrs/parameter-sets/{set_id}/activate")
def api_fsrs_activate_parameter_set(
    set_id: str, session: Session = Depends(session_dep)
):
    from memory_anki.modules.memory.application.scheduling.optimizer_service import (
        activate_parameter_set,
    )

    try:
        payload = activate_parameter_set(session, set_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return {"item": payload}


@router.post("/review/fsrs/parameter-sets/rollback")
def api_fsrs_rollback_parameter_set(session: Session = Depends(session_dep)):
    from memory_anki.modules.memory.application.scheduling.optimizer_service import (
        rollback_active_parameter_set,
    )

    try:
        payload = rollback_active_parameter_set(session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return {"item": payload}


@router.get("/review/palaces/{palace_id}/memory")
def api_palace_memory(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return {"item": get_palace_memory_projection(session, palace_id)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.get("/review/palaces/{palace_id}/waves")
def api_palace_waves(palace_id: int, session: Session = Depends(session_dep)):
    return {"items": list_palace_waves(session, palace_id)}


@router.get("/review/waves/{wave_id}")
def api_wave_detail(wave_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": get_wave_detail(session, wave_id)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.post("/review/waves/{wave_id}/sessions")
def api_start_wave_session(
    wave_id: str,
    data: dict | None = None,
    session: Session = Depends(session_dep),
):
    payload = data or {}
    client_source = payload.get("client_source") or payload.get("clientSource")
    try:
        row = start_reinforcement_wave_session(
            session,
            wave_id,
            client_source=str(client_source) if client_source is not None else None,
        )
        session.commit()
        session.refresh(row)
        return formal_review_session_payload(session, row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/waves/{wave_id}/pause")
def api_pause_wave(wave_id: str, session: Session = Depends(session_dep)):
    try:
        wave = pause_formal_wave(session, wave_id)
        session.commit()
        return {"item": get_wave_detail(session, wave.id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/waves/{wave_id}/resume")
def api_resume_wave(
    wave_id: str, data: dict | None = None, session: Session = Depends(session_dep)
):
    try:
        result = resume_formal_wave(
            session,
            wave_id,
            session_id=str((data or {}).get("session_id") or "") or None,
        )
        session.commit()
        return {"item": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/waves/{wave_id}/merge-new-due")
def api_merge_new_due(
    wave_id: str, data: dict | None = None, session: Session = Depends(session_dep)
):
    try:
        node_uids = (data or {}).get("node_uids")
        wave = merge_new_due_into_wave(
            session,
            wave_id,
            node_uids=[str(uid) for uid in node_uids] if isinstance(node_uids, list) else None,
        )
        session.commit()
        return {"item": get_wave_detail(session, wave.id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/palaces/{palace_id}/calibration/diagnose")
def api_calibration_diagnose(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return {"item": diagnose_palace(session, palace_id)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.post("/review/palaces/{palace_id}/calibration/preview")
def api_calibration_preview(
    palace_id: int, data: dict, session: Session = Depends(session_dep)
):
    try:
        return {
            "item": preview_or_apply_calibration(
                session,
                palace_id=palace_id,
                operation_id=str(data.get("operation_id") or "").strip(),
                mode=str(data.get("mode") or ""),
                scope_kind=str(data.get("scope_kind") or "palace"),
                scope=data.get("scope") if isinstance(data.get("scope"), dict) else {},
                baseline_tier=data.get("baseline_tier"),
                target_local_date=data.get("target_local_date"),
                source_node_uid=data.get("source_node_uid"),
                palace_revision=data.get("palace_revision"),
                confirm=False,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/palaces/{palace_id}/calibration/apply")
def api_calibration_apply(
    palace_id: int, data: dict, session: Session = Depends(session_dep)
):
    try:
        return {
            "item": preview_or_apply_calibration(
                session,
                palace_id=palace_id,
                operation_id=str(data.get("operation_id") or "").strip(),
                mode=str(data.get("mode") or ""),
                scope_kind=str(data.get("scope_kind") or "palace"),
                scope=data.get("scope") if isinstance(data.get("scope"), dict) else {},
                baseline_tier=data.get("baseline_tier"),
                target_local_date=data.get("target_local_date"),
                source_node_uid=data.get("source_node_uid"),
                palace_revision=data.get("palace_revision"),
                confirm=True,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/palaces/{palace_id}/calibration/{operation_id}/undo")
def api_calibration_undo(
    palace_id: int, operation_id: str, session: Session = Depends(session_dep)
):
    try:
        return {"item": undo_calibration(session, operation_id=operation_id, palace_id=palace_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/palaces/{palace_id}/memory/trend", response_model=MasteryTrendResponse)
def api_palace_mastery_trend(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return get_palace_mastery_trend(session, palace_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/review/palaces/{palace_id}/completion-summary")
def api_palace_completion_summary(
    palace_id: int,
    node_uids: str | None = None,
    session: Session = Depends(session_dep),
):
    try:
        selected = [item for item in (node_uids or "").split(",") if item]
        return {"item": get_completion_summary(session, palace_id, node_uids=selected or None)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.post("/review/palaces/{palace_id}/ratings")
def api_rate_palace_nodes(
    palace_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    operation_id = str(data.get("operation_id") or "").strip()
    study_session_id = str(data.get("study_session_id") or f"rating-{operation_id}").strip()
    try:
        return {
            "item": rate_nodes(
                session,
                palace_id=palace_id,
                node_uid=str(data.get("node_uid") or ""),
                rating=int(str(data.get("rating") or "")),
                study_session_id=study_session_id,
                operation_id=operation_id,
                rating_scope=str(data.get("rating_scope") or "subtree"),
                conflict_policy=str(data.get("conflict_policy") or "overwrite"),
                source_scene=str(data.get("source_scene") or "formal_review"),
                recall_round=str(data.get("recall_round") or "first"),
                rating_source=str(data.get("rating_source") or "manual"),
                inference_confidence=data.get("inference_confidence"),
                response_ms=data.get("response_ms"),
                hint_count=int(data.get("hint_count") or 0),
                retry_count=int(data.get("retry_count") or 0),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/palaces/{palace_id}/ratings/{operation_id}/undo")
def api_undo_palace_rating(
    palace_id: int,
    operation_id: str,
    data: dict | None = None,
    session: Session = Depends(session_dep),
):
    try:
        result = undo_rating_operation(
            session,
            operation_id=operation_id,
            study_session_id=str((data or {}).get("study_session_id") or ""),
        )
        return {"item": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/queue", response_model=ReviewQueueResponse)
def api_queue(session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session)


@router.get("/review/chapter/{chapter_id}/queue", response_model=ReviewQueueResponse)
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session, chapter_id)


@router.post("/review/palaces/{palace_id}/sessions")
def api_start_formal_review_session(palace_id: int, data: dict | None = None, session: Session = Depends(session_dep)):
    payload = data or {}
    raw_scope = payload.get("scope_node_uids")
    scope_node_uids: list[str] | None = None
    if isinstance(raw_scope, list):
        scope_node_uids = [str(item) for item in raw_scope if str(item or "").strip()]
    client_source = payload.get("client_source") or payload.get("clientSource")
    try:
        row = start_or_resume_formal_review(
            session,
            palace_id,
            chapter_id=int(payload["chapter_id"]) if payload.get("chapter_id") is not None else None,
            entry_mode=str(payload.get("entry_mode") or "") or None,
            branch_uid=str(payload.get("branch_uid") or "") or None,
            scope_node_uids=scope_node_uids,
            client_source=str(client_source) if client_source is not None else None,
        )
        return formal_review_session_payload(session, row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/session/{session_id}")
def api_review_session(session_id: str, session: Session = Depends(session_dep)):
    try:
        return formal_review_session_payload(
            session, resolve_formal_review_session(session, session_id)
        )
    except ValueError as exc:
        raise_not_found(str(exc))


@router.get("/review/session/{session_id}/progress")
def api_review_progress(session_id: str, session: Session = Depends(session_dep)):
    try:
        return get_formal_review_progress(resolve_formal_review_session(session, session_id))
    except ValueError as exc:
        raise_not_found(str(exc))


@router.put("/review/session/{session_id}/progress")
def api_upsert_review_progress(
    session_id: str, data: dict, session: Session = Depends(session_dep)
):
    try:
        return save_formal_review_progress(
            session, resolve_formal_review_session(session, session_id), data
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/review/session/{session_id}/progress")
def api_delete_review_progress(session_id: str, session: Session = Depends(session_dep)):
    try:
        return clear_formal_review_progress(
            session, resolve_formal_review_session(session, session_id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/review/session/{session_id}/completion-summary")
def api_formal_review_completion_summary(session_id: str, session: Session = Depends(session_dep)):
    try:
        return {
            "item": formal_review_completion_summary(
                session, resolve_formal_review_session(session, session_id)
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/rate-unrated")
def api_rate_unrated_formal_review_nodes(
    session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    """One-tap settlement scoring for still-unrated frozen-due nodes only."""
    try:
        return {
            "item": rate_unrated_formal_review_nodes(
                session,
                resolve_formal_review_session(session, session_id),
                rating=int(str(data.get("rating") or "")),
                operation_id=str(data.get("operation_id") or "").strip(),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/rate-out-of-scope-due")
def api_rate_out_of_scope_due_formal_review_nodes(
    session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    """One-tap rate palace due nodes outside this session's frozen scope (confirmed)."""
    try:
        return {
            "item": rate_out_of_scope_due_formal_review_nodes(
                session,
                resolve_formal_review_session(session, session_id),
                rating=int(str(data.get("rating") or "")),
                operation_id=str(data.get("operation_id") or "").strip(),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/submit", response_model=SubmitReviewResponse)
def api_submit_session(
    session_id: str, data: dict, request: Request, session: Session = Depends(session_dep)
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        response = complete_formal_review(
            session,
            resolve_formal_review_session(session, session_id),
            duration_seconds=int(data.get("duration_seconds", 0)),
            completion_mode=str(data.get("completion_mode") or "manual_complete"),
            note=str(data.get("note") or ""),
            chapter_id=int(data["chapter_id"]) if data.get("chapter_id") is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    mutation_store.save(mutation_identity, response)
    SqlAlchemyUnitOfWork(session).commit()
    return response


@router.get("/review/completions/{review_log_id}", response_model=SubmitReviewResponse)
def api_review_completion(review_log_id: int, session: Session = Depends(session_dep)):
    response = get_fsrs_completion(session, review_log_id)
    if response is None:
        raise_not_found("复习完成记录不存在。")
    return response


@router.get("/review", response_model=ReviewQueueResponse)
def api_reviews(session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session)


@router.get("/review/{session_id}")
def api_review_item(session_id: str, session: Session = Depends(session_dep)):
    return api_review_session(session_id, session)


@router.post("/review/{session_id}/submit", response_model=SubmitReviewResponse)
def api_submit(
    session_id: str,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    return api_submit_session(session_id, data, request, session)
