from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import AiEvalRun, AiPromptVersion, Config
from memory_anki.infrastructure.llm import AiRequest, OpenAICompatibleChatConfig, execute_ai_request
from memory_anki.modules.settings.application.ai_model_registry import resolve_scenario_runtime

from .ai_prompts import (
    PROMPT_DEFINITIONS,
    PROMPT_KEY_ALIASES,
    AiPromptValidationError,
    get_prompt_template,
    validate_prompt_template,
)

GOLDEN_DATASET_PATH = Path(__file__).with_name("ai_eval_fixtures") / "golden_cases.json"


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _json_load(value: str | None, default: Any) -> Any:
    try:
        parsed = json.loads(value or "")
    except json.JSONDecodeError:
        return default
    return parsed if parsed is not None else default


def _canonical_key(key: str) -> str:
    normalized = PROMPT_KEY_ALIASES.get(str(key or "").strip(), str(key or "").strip())
    if normalized not in PROMPT_DEFINITIONS:
        raise AiPromptValidationError(f"未知的提示词键：{key}")
    return normalized


def ensure_prompt_versions(session: Session) -> None:
    changed = False
    for key in PROMPT_DEFINITIONS:
        active = (
            session.query(AiPromptVersion)
            .filter_by(prompt_key=key, status="active")
            .order_by(AiPromptVersion.created_at.desc())
            .first()
        )
        if active:
            continue
        config_row = session.query(Config).filter_by(key=key).first()
        template = get_prompt_template(session, key)
        source = "custom" if config_row and config_row.value.strip() else "builtin"
        session.add(
            AiPromptVersion(
                id=uuid.uuid4().hex,
                prompt_key=key,
                template=template,
                status="active",
                source=source,
                eval_summary_json=_json_dump({"migrated": True, "gate_passed": True}),
                activated_at=utc_now_naive(),
            )
        )
        changed = True
    if changed:
        session.commit()


def _serialize_version(row: AiPromptVersion) -> dict[str, Any]:
    return {
        "id": row.id,
        "prompt_key": row.prompt_key,
        "template": row.template,
        "status": row.status,
        "source": row.source,
        "eval_summary": _json_load(row.eval_summary_json, {}),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "activated_at": row.activated_at.isoformat() if row.activated_at else None,
    }


def list_prompt_versions(session: Session, key: str) -> list[dict[str, Any]]:
    ensure_prompt_versions(session)
    prompt_key = _canonical_key(key)
    rows = (
        session.query(AiPromptVersion)
        .filter_by(prompt_key=prompt_key)
        .order_by(AiPromptVersion.created_at.desc())
        .all()
    )
    return [_serialize_version(row) for row in rows]


def create_prompt_candidates(
    session: Session,
    templates: dict[str, str],
    *,
    source: str = "custom",
) -> list[dict[str, Any]]:
    ensure_prompt_versions(session)
    created: list[AiPromptVersion] = []
    for raw_key, template in templates.items():
        key = _canonical_key(raw_key)
        normalized = validate_prompt_template(key, template)
        row = AiPromptVersion(
            id=uuid.uuid4().hex,
            prompt_key=key,
            template=normalized,
            status="candidate",
            source=source,
            eval_summary_json="{}",
        )
        session.add(row)
        created.append(row)
    session.commit()
    return [_serialize_version(row) for row in created]


def create_reset_candidates(session: Session, keys: list[str] | None = None) -> list[dict[str, Any]]:
    target_keys = keys or list(PROMPT_DEFINITIONS)
    templates = {
        _canonical_key(key): PROMPT_DEFINITIONS[_canonical_key(key)].default_template
        for key in target_keys
    }
    return create_prompt_candidates(session, templates, source="builtin")


def _load_golden_cases(prompt_key: str) -> list[dict[str, Any]]:
    if not GOLDEN_DATASET_PATH.exists():
        return []
    payload = _json_load(GOLDEN_DATASET_PATH.read_text(encoding="utf-8"), [])
    return [item for item in payload if item.get("prompt_key") == prompt_key and item.get("approved")]


def _assert_output(case: dict[str, Any], output: Any) -> dict[str, Any]:
    expected = case.get("expected") if isinstance(case.get("expected"), dict) else {}
    schema_passed = isinstance(output, dict | list)
    assertions: list[dict[str, Any]] = []
    if expected.get("required_keys") and isinstance(output, dict):
        missing = [key for key in expected["required_keys"] if key not in output]
        assertions.append({"name": "required_keys", "passed": not missing, "details": missing})
    if expected.get("min_items") is not None and isinstance(output, list):
        assertions.append(
            {
                "name": "min_items",
                "passed": len(output) >= int(expected["min_items"]),
                "details": {"actual": len(output), "minimum": int(expected["min_items"])},
            }
        )
    if expected.get("max_items") is not None and isinstance(output, list):
        assertions.append(
            {
                "name": "max_items",
                "passed": len(output) <= int(expected["max_items"]),
                "details": {"actual": len(output), "maximum": int(expected["max_items"])},
            }
        )
    assertion_passed = schema_passed and all(item["passed"] for item in assertions)
    return {"schema_passed": schema_passed, "assertion_passed": assertion_passed, "assertions": assertions}


def _evaluate_case(
    session: Session,
    *,
    case: dict[str, Any],
    template: str,
    version_id: str,
) -> dict[str, Any]:
    scenario_key = str(case.get("scenario_key") or "").strip()
    runtime = resolve_scenario_runtime(session, scenario_key)
    raw_messages = case.get("messages") if isinstance(case.get("messages"), list) else []
    messages = [{"role": "system", "content": template}]
    messages.extend(item for item in raw_messages if isinstance(item, dict))
    result = execute_ai_request(
        AiRequest(
            scene=f"prompt_eval:{scenario_key}",
            provider=runtime.provider,
            config=OpenAICompatibleChatConfig(
                api_key=runtime.api_key,
                base_url=runtime.base_url,
                model=runtime.model,
                temperature=(0.0 if runtime.supports_temperature else None),
            ),
            messages=messages,
            prompt_version_id=version_id,
            extra_payload=runtime.extra_payload,
        )
    )
    try:
        output = json.loads(result.text)
    except json.JSONDecodeError:
        output = result.text
    asserted = _assert_output(case, output)
    return {
        "case_id": case.get("id"),
        "critical": bool(case.get("critical")),
        "source_log_id": case.get("source_log_id"),
        "response_text": result.text,
        "usage": {
            "input_tokens": result.usage.input_tokens,
            "output_tokens": result.usage.output_tokens,
            "cached_input_tokens": result.usage.cached_input_tokens,
        },
        **asserted,
    }


def _evaluate_version(
    session: Session,
    *,
    cases: list[dict[str, Any]],
    version: AiPromptVersion,
) -> tuple[list[dict[str, Any]], float, float, bool]:
    results = [
        _evaluate_case(session, case=case, template=version.template, version_id=version.id)
        for case in cases
    ]
    case_count = len(results)
    schema_rate = sum(1 for item in results if item["schema_passed"]) / case_count if case_count else 0.0
    assertion_rate = sum(1 for item in results if item["assertion_passed"]) / case_count if case_count else 0.0
    critical = [item for item in results if item["critical"]]
    critical_passed = bool(critical) and all(item["assertion_passed"] for item in critical)
    return results, schema_rate, assertion_rate, critical_passed


def run_prompt_eval(session: Session, prompt_key: str, candidate_version_id: str) -> dict[str, Any]:
    ensure_prompt_versions(session)
    key = _canonical_key(prompt_key)
    candidate = session.query(AiPromptVersion).filter_by(id=candidate_version_id, prompt_key=key).first()
    if not candidate:
        raise AiPromptValidationError("候选提示词版本不存在。")
    baseline = (
        session.query(AiPromptVersion)
        .filter_by(prompt_key=key, status="active")
        .order_by(AiPromptVersion.activated_at.desc())
        .first()
    )
    cases = _load_golden_cases(key)
    if len(cases) < 5:
        candidate.status = "failed"
        candidate.eval_summary_json = _json_dump(
            {"case_count": len(cases), "gate_passed": False, "reason": "insufficient_cases"}
        )
        session.commit()
        run = AiEvalRun(
            id=uuid.uuid4().hex,
            prompt_key=key,
            candidate_version_id=candidate.id,
            baseline_version_id=baseline.id if baseline else None,
            status="completed",
            case_count=len(cases),
            schema_success_rate=0.0,
            assertion_success_rate=0.0,
            critical_passed=False,
            gate_passed=False,
            results_json=_json_dump([]),
            completed_at=utc_now_naive(),
        )
        session.add(run)
        session.commit()
        return serialize_eval_run(run)
    results, schema_rate, assertion_rate, critical_passed = _evaluate_version(
        session, cases=cases, version=candidate
    )
    baseline_rate = None
    if baseline:
        _, _, baseline_rate, _ = _evaluate_version(session, cases=cases, version=baseline)
    gate_passed = (
        schema_rate == 1.0
        and assertion_rate >= 0.95
        and critical_passed
        and (baseline_rate is None or assertion_rate >= baseline_rate - 0.02)
    )
    run = AiEvalRun(
        id=uuid.uuid4().hex,
        prompt_key=key,
        candidate_version_id=candidate.id,
        baseline_version_id=baseline.id if baseline else None,
        status="completed",
        case_count=len(cases),
        schema_success_rate=schema_rate,
        assertion_success_rate=assertion_rate,
        baseline_assertion_success_rate=baseline_rate,
        critical_passed=critical_passed,
        gate_passed=gate_passed,
        results_json=_json_dump(results),
        completed_at=utc_now_naive(),
    )
    candidate.eval_summary_json = _json_dump(
        {
            "run_id": run.id,
            "case_count": len(cases),
            "schema_success_rate": schema_rate,
            "assertion_success_rate": assertion_rate,
            "baseline_assertion_success_rate": baseline_rate,
            "critical_passed": critical_passed,
            "gate_passed": gate_passed,
        }
    )
    candidate.status = "passed" if gate_passed else "failed"
    session.add(run)
    session.commit()
    return serialize_eval_run(run)


def serialize_eval_run(row: AiEvalRun) -> dict[str, Any]:
    return {
        "id": row.id,
        "prompt_key": row.prompt_key,
        "candidate_version_id": row.candidate_version_id,
        "baseline_version_id": row.baseline_version_id,
        "status": row.status,
        "case_count": row.case_count,
        "schema_success_rate": row.schema_success_rate,
        "assertion_success_rate": row.assertion_success_rate,
        "baseline_assertion_success_rate": row.baseline_assertion_success_rate,
        "critical_passed": row.critical_passed,
        "gate_passed": row.gate_passed,
        "results": _json_load(row.results_json, []),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def get_eval_run(session: Session, run_id: str) -> dict[str, Any] | None:
    row = session.query(AiEvalRun).filter_by(id=run_id).first()
    return serialize_eval_run(row) if row else None


def activate_prompt_version(session: Session, prompt_key: str, version_id: str) -> dict[str, Any]:
    ensure_prompt_versions(session)
    key = _canonical_key(prompt_key)
    target = session.query(AiPromptVersion).filter_by(id=version_id, prompt_key=key).first()
    if not target:
        raise AiPromptValidationError("提示词版本不存在。")
    summary = _json_load(target.eval_summary_json, {})
    was_active = target.activated_at is not None
    if not was_active and not bool(summary.get("gate_passed")):
        raise AiPromptValidationError("该候选版本尚未通过评测门禁。")
    session.query(AiPromptVersion).filter_by(prompt_key=key, status="active").update(
        {"status": "archived"}, synchronize_session=False
    )
    row = session.query(Config).filter_by(key=key).first()
    default_template = PROMPT_DEFINITIONS[key].default_template.strip()
    if target.template.strip() == default_template:
        if row:
            session.delete(row)
    elif row:
        row.value = target.template
        row.updated_at = utc_now_naive()
    else:
        session.add(Config(key=key, value=target.template))
    target.status = "active"
    target.activated_at = utc_now_naive()
    session.commit()
    return _serialize_version(target)
