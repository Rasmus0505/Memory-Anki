from __future__ import annotations

import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import AI_CALL_LOGS_DIR
from memory_anki.core.request_context import get_request_id
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import ExternalAiCallLog, engine


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


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
                request_json=_json_dump(request_payload_with_artifacts),
                response_json="{}",
                error_json="{}",
            )
        )
        session.commit()
    return log_id


def complete_external_ai_call_log(log_id: str, *, response_payload: dict[str, Any]) -> None:
    _write_json(_response_json_path(log_id), response_payload)
    with Session(engine) as session:
        row = session.query(ExternalAiCallLog).filter_by(id=log_id).first()
        if not row:
            return
        row.status = "success"
        row.response_json = _json_dump(response_payload)
        row.error_json = "{}"
        row.updated_at = utc_now_naive()
        session.commit()


def fail_external_ai_call_log(log_id: str, *, error_payload: dict[str, Any]) -> None:
    _write_json(_error_json_path(log_id), error_payload)
    with Session(engine) as session:
        row = session.query(ExternalAiCallLog).filter_by(id=log_id).first()
        if not row:
            return
        row.status = "error"
        row.error_json = _json_dump(error_payload)
        row.updated_at = utc_now_naive()
        session.commit()


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
    result = {
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
