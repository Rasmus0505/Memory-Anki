from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from memory_anki.platform.application import (
    AiRuntimeOptions,
    PersistedAiRuntime,
    ResolvedAiRuntime,
    persist_ai_runtime,
    serialize_resolved_ai_runtime,
)

from .ai_dependencies import EnglishAiDependencies


def load_task_asr_ai_options(task_path: Path) -> AiRuntimeOptions:
    options_path = task_path / "runtime_options.json"
    if not options_path.exists():
        return AiRuntimeOptions()
    try:
        payload = json.loads(options_path.read_text(encoding="utf-8"))
    except Exception:
        return AiRuntimeOptions()
    asr_payload = payload.get("asr") if isinstance(payload, dict) else None
    if not isinstance(asr_payload, dict):
        return AiRuntimeOptions()
    return AiRuntimeOptions(
        model=str(asr_payload.get("model") or "").strip() or None,
        thinking_enabled=(
            None
            if asr_payload.get("thinking_enabled") is None
            else bool(asr_payload.get("thinking_enabled"))
        ),
    )


TASK_RUNTIME_FILE = "ai_runtime.json"


def write_task_runtime_snapshot(
    task_path: Path,
    *,
    owner_id: str,
    operation_id: str,
    ai_dependencies: EnglishAiDependencies | None,
    asr_ai_options: AiRuntimeOptions | None,
) -> None:
    payload: dict[str, Any] = {
        "schema_version": 1,
        "owner_id": owner_id,
        "operation_id": operation_id,
        "runtimes": {},
        "public_metadata": {},
    }
    if ai_dependencies is not None:
        for name, scenario_key, options in (
            ("asr", "asr_course_transcription", asr_ai_options),
            ("translation", "translation_course_batch", None),
        ):
            runtime = ai_dependencies.runtime.resolve(scenario_key, options=options)
            payload["runtimes"][name] = persisted_runtime_to_payload(persist_ai_runtime(runtime))
            payload["public_metadata"][name] = serialize_resolved_ai_runtime(runtime)
    (task_path / TASK_RUNTIME_FILE).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def persisted_runtime_to_payload(runtime: PersistedAiRuntime) -> dict[str, Any]:
    return {
        "scenario_key": runtime.scenario_key,
        "model": runtime.model,
        "provider": runtime.provider,
        "base_url": runtime.base_url,
        "extra_payload": runtime.extra_payload,
        "prompt_override": runtime.prompt_override,
    }


def persisted_runtime_from_payload(payload: dict[str, Any]) -> PersistedAiRuntime:
    return PersistedAiRuntime(
        scenario_key=str(payload.get("scenario_key") or ""),
        model=str(payload.get("model") or ""),
        provider=str(payload.get("provider") or ""),
        base_url=str(payload.get("base_url") or ""),
        extra_payload=(
            payload.get("extra_payload") if isinstance(payload.get("extra_payload"), dict) else None
        ),
        prompt_override=str(payload.get("prompt_override") or "") or None,
    )


def load_task_runtime_payload(task_path: Path) -> dict[str, Any]:
    snapshot_path = task_path / TASK_RUNTIME_FILE
    if not snapshot_path.exists():
        return {}
    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def load_task_runtime_identity(task_path: Path) -> tuple[str, str]:
    payload = load_task_runtime_payload(task_path)
    return (
        str(payload.get("owner_id") or "").strip(),
        str(payload.get("operation_id") or "").strip(),
    )


def rewrite_task_runtime_identity(
    task_path: Path,
    *,
    owner_id: str,
    operation_id: str,
) -> None:
    payload = load_task_runtime_payload(task_path)
    payload.update(
        {
            "schema_version": 1,
            "owner_id": owner_id,
            "operation_id": operation_id,
        }
    )
    (task_path / TASK_RUNTIME_FILE).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def restore_task_runtime(
    task_path: Path,
    name: str,
    *,
    ai_dependencies: EnglishAiDependencies | None,
) -> ResolvedAiRuntime | None:
    if ai_dependencies is None:
        return None
    payload = load_task_runtime_payload(task_path)
    runtimes = payload.get("runtimes")
    runtime_payload = runtimes.get(name) if isinstance(runtimes, dict) else None
    if not isinstance(runtime_payload, dict):
        return None
    return ai_dependencies.runtime.restore(persisted_runtime_from_payload(runtime_payload))


def load_task_runtime_public_metadata(
    task_path: Path,
    name: str,
) -> dict[str, Any] | None:
    payload = load_task_runtime_payload(task_path)
    public_metadata = payload.get("public_metadata")
    value = public_metadata.get(name) if isinstance(public_metadata, dict) else None
    return value if isinstance(value, dict) else None
