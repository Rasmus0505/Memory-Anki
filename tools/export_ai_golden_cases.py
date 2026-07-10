from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables._base import engine
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog

ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:\\|/home/|/Users/)[^\s\"']+")
SECRET_KEYS = {"api_key", "authorization", "headers", "token", "secret"}


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: sanitize(item)
            for key, item in value.items()
            if str(key).lower() not in SECRET_KEYS and key != "input_artifacts"
        }
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return ABSOLUTE_PATH.sub("<LOCAL_PATH>", value)
    return value


def json_load(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value or "")
    except json.JSONDecodeError:
        return default


def main() -> None:
    parser = argparse.ArgumentParser(description="导出待人工审阅的 AI 黄金评测样本。")
    parser.add_argument("--output", default="output/ai-golden-cases.review.json")
    parser.add_argument("--success-per-scene", type=int, default=10)
    parser.add_argument("--failure-per-scene", type=int, default=5)
    args = parser.parse_args()
    with Session(engine) as session:
        rows = session.query(ExternalAiCallLog).order_by(ExternalAiCallLog.created_at.desc()).all()
    selected: dict[tuple[str, str], int] = {}
    cases: list[dict[str, Any]] = []
    for row in rows:
        scene = row.scene or row.feature
        status_group = "success" if row.status == "success" else "failure"
        limit = args.success_per_scene if status_group == "success" else args.failure_per_scene
        key = (scene, status_group)
        if selected.get(key, 0) >= limit:
            continue
        request = sanitize(json_load(row.request_json, {}))
        response = sanitize(json_load(row.response_json, {}))
        cases.append(
            {
                "id": f"{scene}-{row.id[:8]}",
                "prompt_key": request.get("prompt_key") or "REVIEW_REQUIRED",
                "scenario_key": request.get("scenario_key") or scene,
                "source_log_id": row.id,
                "status_group": status_group,
                "messages": request.get("messages") or [],
                "historical_output": response.get("response_text"),
                "expected": {"required_keys": [], "min_items": None},
                "critical": False,
                "approved": False,
            }
        )
        selected[key] = selected.get(key, 0) + 1
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(cases)} review cases to {output}")


if __name__ == "__main__":
    main()
