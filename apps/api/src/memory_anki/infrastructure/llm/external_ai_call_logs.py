from __future__ import annotations

import json
import logging
import mimetypes
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from memory_anki.core.config import AI_CALL_LOGS_DIR
from memory_anki.core.request_context import get_request_id
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables._base import engine
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog

logger = logging.getLogger(__name__)

# SQLite 内只保留短预览，完整 payload 写在 ai_call_logs/<id>/ 磁盘文件。
_DB_JSON_MAX_CHARS = 32_768
_AI_CALL_LOG_FILE_RETENTION_DAYS = 14


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _json_for_db(value: Any) -> str:
    """Serialize for SQLite columns; truncate large payloads to protect DB size."""
    raw = _json_dump(value)
    if len(raw) <= _DB_JSON_MAX_CHARS:
        return raw
    preview = raw[: max(0, _DB_JSON_MAX_CHARS - 200)]
    return _json_dump(
        {
            "_truncated": True,
            "bytes": len(raw.encode("utf-8")),
            "chars": len(raw),
            "preview": preview,
            "file_hint": "see ai_call_logs/<log_id>/ for full JSON",
        }
    )


def prune_old_ai_call_log_files(
    *,
    retention_days: int = _AI_CALL_LOG_FILE_RETENTION_DAYS,
    now_ts: float | None = None,
) -> int:
    """Delete ai_call_logs subdirs older than retention_days. Returns removed count."""
    if retention_days <= 0 or not AI_CALL_LOGS_DIR.exists():
        return 0
    cutoff = (now_ts if now_ts is not None else time.time()) - retention_days * 86400
    removed = 0
    try:
        children = list(AI_CALL_LOGS_DIR.iterdir())
    except OSError:
        return 0
    for child in children:
        if not child.is_dir():
            continue
        try:
            mtime = child.stat().st_mtime
        except OSError:
            continue
        if mtime >= cutoff:
            continue
        try:
            shutil.rmtree(child)
            removed += 1
        except OSError:
            logger.warning("failed to prune ai_call_log dir: %s", child, exc_info=True)
    return removed


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return parsed if parsed is not None else default


def _infer_artifact_name(index: int, filename: str | None) -> str:
    suffix = Path(filename or "").suffix or ".png"
    return f"input-{index}{suffix}"


def _artifact_manifest_path(log_id: str) -> Path:
    return AI_CALL_LOGS_DIR / log_id / "artifacts.json"


def _request_json_path(log_id: str) -> Path:
    return AI_CALL_LOGS_DIR / log_id / "request.json"


def _response_json_path(log_id: str) -> Path:
    return AI_CALL_LOGS_DIR / log_id / "response.json"


def _error_json_path(log_id: str) -> Path:
    return AI_CALL_LOGS_DIR / log_id / "error.json"


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json_dump(payload), encoding="utf-8")


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return _json_load(path.read_text(encoding="utf-8"), default)


def _normalize_artifact_refs(
    *,
    log_id: str,
    artifact_refs: list[dict[str, Any]] | None,
    image_items: list[tuple[bytes, str | None]] | None,
) -> list[dict[str, Any]]:
    artifact_dir = AI_CALL_LOGS_DIR / log_id
    normalized: list[dict[str, Any]] = []
    if artifact_refs:
        for index, item in enumerate(artifact_refs, start=1):
            source_path = str(item.get("source_path") or "").strip()
            if not source_path:
                continue
            normalized.append(
                {
                    "name": str(item.get("name") or Path(source_path).name or f"artifact-{index}"),
                    "label": str(item.get("label") or f"输入 {index}"),
                    "mime_type": str(item.get("mime_type") or mimetypes.guess_type(source_path)[0] or "application/octet-stream"),
                    "source_kind": str(item.get("source_kind") or "external"),
                    "source_path": source_path,
                }
            )
    elif image_items:
        for index, (image_bytes, filename) in enumerate(image_items, start=1):
            artifact_name = _infer_artifact_name(index - 1, filename)
            target_path = artifact_dir / artifact_name
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(image_bytes)
            normalized.append(
                {
                    "name": artifact_name,
                    "label": f"第 {index} 张图片",
                    "mime_type": mimetypes.guess_type(filename or "")[0] or "image/png",
                    "source_kind": "ai_call_log",
                    "source_path": str(target_path),
                }
            )
    return normalized


def begin_external_ai_call_log(
    *,
    feature: str,
    operation: str,
    provider: str,
    base_url: str,
    model: str,
    request_payload: dict[str, Any],
    job_id: str | None = None,
    palace_id: int | None = None,
    artifact_refs: list[dict[str, Any]] | None = None,
    image_items: list[tuple[bytes, str | None]] | None = None,
    scene: str | None = None,
    prompt_version_id: str | None = None,
    structured_output_mode: str | None = None,
    repaired_from_log_id: str | None = None,
) -> str:
    log_id = uuid.uuid4().hex
    request_id = get_request_id() or ""
    artifacts = _normalize_artifact_refs(
        log_id=log_id,
        artifact_refs=artifact_refs,
        image_items=image_items,
    )
    request_payload_with_artifacts = {
        **(request_payload or {}),
        "input_artifacts": artifacts,
    }
    log_dir = AI_CALL_LOGS_DIR / log_id
    log_dir.mkdir(parents=True, exist_ok=True)
    _write_json(_request_json_path(log_id), request_payload_with_artifacts)
    _write_json(_artifact_manifest_path(log_id), artifacts)
    try:
        with Session(engine) as session:
            session.add(
                ExternalAiCallLog(
                    id=log_id,
                    feature=feature,
                    operation=operation,
                    job_id=job_id,
                    palace_id=palace_id,
                    status="started",
                    provider=provider,
                    base_url=base_url,
                    model=model,
                    request_id=request_id,
                    scene=str(scene or feature or ""),
                    prompt_version_id=prompt_version_id,
                    structured_output_mode=str(structured_output_mode or ""),
                    repaired_from_log_id=repaired_from_log_id,
                    request_json=_json_for_db(request_payload_with_artifacts),
                    response_json="{}",
                    error_json="{}",
                )
            )
            session.commit()
    except SQLAlchemyError:
        # AI generation should not fail solely because the observability table is
        # unavailable in a test sandbox or partially initialized runtime.
        pass
    return log_id


def complete_external_ai_call_log(
    log_id: str,
    *,
    response_payload: dict[str, Any],
    request_id: str | None = None,
    finish_reason: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_input_tokens: int = 0,
    estimated_cost: float | None = None,
    first_token_ms: int | None = None,
    duration_ms: int | None = None,
    attempt_count: int = 1,
    structured_output_mode: str | None = None,
) -> None:
    _write_json(_response_json_path(log_id), response_payload)
    try:
        with Session(engine) as session:
            row = session.query(ExternalAiCallLog).filter_by(id=log_id).first()
            if not row:
                return
            row.status = "success"
            row.response_json = _json_for_db(response_payload)
            row.error_json = "{}"
            row.request_id = str(request_id or row.request_id or "")
            row.finish_reason = str(finish_reason or "")
            row.input_tokens = max(0, int(input_tokens or 0))
            row.output_tokens = max(0, int(output_tokens or 0))
            row.cached_input_tokens = max(0, int(cached_input_tokens or 0))
            row.estimated_cost = estimated_cost
            row.first_token_ms = first_token_ms
            row.duration_ms = duration_ms
            row.attempt_count = max(1, int(attempt_count or 1))
            if structured_output_mode:
                row.structured_output_mode = structured_output_mode
            row.updated_at = utc_now_naive()
            session.commit()
    except SQLAlchemyError:
        pass


def fail_external_ai_call_log(
    log_id: str,
    *,
    error_payload: dict[str, Any],
    error_kind: str | None = None,
    duration_ms: int | None = None,
    attempt_count: int = 1,
) -> None:
    _write_json(_error_json_path(log_id), error_payload)
    try:
        with Session(engine) as session:
            row = session.query(ExternalAiCallLog).filter_by(id=log_id).first()
            if not row:
                return
            row.status = "error"
            row.error_json = _json_for_db(error_payload)
            row.error_kind = str(error_kind or error_payload.get("kind") or "")
            row.duration_ms = duration_ms
            row.attempt_count = max(1, int(attempt_count or 1))
            row.updated_at = utc_now_naive()
            session.commit()
    except SQLAlchemyError:
        pass


def list_external_ai_call_logs(
    session: Session,
    *,
    job_id: str | None = None,
    palace_id: int | None = None,
    provider: str | None = None,
    model: str | None = None,
    feature: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = session.query(ExternalAiCallLog)
    if job_id:
        query = query.filter(ExternalAiCallLog.job_id == job_id)
    if palace_id is not None:
        query = query.filter(ExternalAiCallLog.palace_id == palace_id)
    if provider:
        query = query.filter(ExternalAiCallLog.provider == str(provider))
    if model:
        query = query.filter(ExternalAiCallLog.model == str(model))
    if feature:
        query = query.filter(ExternalAiCallLog.feature == str(feature))
    if status:
        query = query.filter(ExternalAiCallLog.status == str(status))
    rows = (
        query.order_by(ExternalAiCallLog.created_at.desc(), ExternalAiCallLog.id.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )
    return [serialize_external_ai_call_log(row, include_details=False) for row in rows]


def get_external_ai_call_log(session: Session, log_id: str) -> dict[str, Any] | None:
    row = session.query(ExternalAiCallLog).filter_by(id=log_id).first()
    if not row:
        return None
    return serialize_external_ai_call_log(row, include_details=True)


def serialize_external_ai_call_log(
    row: ExternalAiCallLog,
    *,
    include_details: bool,
) -> dict[str, Any]:
    request_payload = _json_load(row.request_json, {})
    response_payload = _json_load(row.response_json, {})
    error_payload = _json_load(row.error_json, {})
    result: dict[str, Any] = {
        "id": row.id,
        "feature": row.feature,
        "operation": row.operation,
        "job_id": row.job_id,
        "palace_id": row.palace_id,
        "status": row.status,
        "provider": row.provider,
        "base_url": row.base_url,
        "model": row.model,
        "request_id": row.request_id,
        "scene": row.scene,
        "prompt_version_id": row.prompt_version_id,
        "structured_output_mode": row.structured_output_mode,
        "finish_reason": row.finish_reason,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "cached_input_tokens": row.cached_input_tokens,
        "estimated_cost": row.estimated_cost,
        "first_token_ms": row.first_token_ms,
        "duration_ms": row.duration_ms,
        "attempt_count": row.attempt_count,
        "error_kind": row.error_kind,
        "repaired_from_log_id": row.repaired_from_log_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if not include_details:
        return result
    input_artifacts = _read_json(_artifact_manifest_path(row.id), request_payload.get("input_artifacts") or [])
    result.update(
        {
            "request_payload": request_payload,
            "response_payload": response_payload,
            "error_payload": error_payload,
            "prompt_text": str(request_payload.get("prompt") or ""),
            "response_text": str(response_payload.get("response_text") or ""),
            "input_artifacts": [
                {
                    **artifact,
                    "url": f"/api/v1/ai-call-logs/{row.id}/artifacts/{artifact['name']}",
                }
                for artifact in input_artifacts
            ],
        }
    )
    return result


def resolve_external_ai_call_log_artifact(
    log_id: str,
    artifact_name: str,
) -> tuple[Path, str] | None:
    artifacts = _read_json(_artifact_manifest_path(log_id), [])
    for artifact in artifacts:
        if str(artifact.get("name") or "") != artifact_name:
            continue
        source_path = Path(str(artifact.get("source_path") or ""))
        if not source_path.exists():
            return None
        mime_type = str(artifact.get("mime_type") or mimetypes.guess_type(source_path.name)[0] or "application/octet-stream")
        return source_path, mime_type
    return None
