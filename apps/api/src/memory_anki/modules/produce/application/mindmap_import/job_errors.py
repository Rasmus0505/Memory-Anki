from __future__ import annotations

from typing import Any

from memory_anki.core.request_context import get_request_id
from memory_anki.infrastructure.db._tables.misc import MindMapImportJob


def build_structured_error(
    exc: Exception,
    *,
    stage: str,
    job: MindMapImportJob | None = None,
    summarize_model_output_fn,
    error_snippet_limit: int,
) -> dict[str, Any]:
    message = str(exc).strip() or "识别失败，请稍后重试。"
    lower_message = message.lower()
    if "不是有效的脑图 json" in message or "json" in lower_message:
        code = "invalid_json"
    elif "http " in lower_message or "internal server error" in lower_message:
        code = "provider_http_error"
    elif "网络异常" in message or "连接被拒绝" in message or "timed out" in lower_message:
        code = "provider_network_error"
    else:
        code = "import_failed"
    details: dict[str, Any] = {}
    if job is not None:
        details = {
            "job_id": job.id,
            "source_kind": job.source_kind,
            "mode": job.mode,
            "stage": stage,
        }
    return {
        "code": code,
        "stage": stage,
        "message": message,
        "retryable": True,
        "raw_snippet": truncate_snippet(
            message,
            summarize_model_output_fn=summarize_model_output_fn,
            limit=error_snippet_limit,
        ),
        "request_id": get_request_id(),
        "details": details,
    }


def truncate_snippet(
    value: str,
    *,
    summarize_model_output_fn,
    limit: int,
) -> str:
    normalized = summarize_model_output_fn(value)
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."
