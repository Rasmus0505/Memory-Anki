from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / ".audit" / "1000-quiz" / "snapshot" / "data" / "memory_palace.db"
DEFAULT_AUDIT = REPO_ROOT / ".audit" / "1000-quiz" / "quiz_bank_audit.json"
DEFAULT_OUT = REPO_ROOT / ".audit" / "1000-quiz" / "rerun_plan.json"


LOW_COST_AI_OPTIONS_BY_SCENARIO = {
    "quiz_pdf_generation": {"model": "qwen3-vl-flash", "thinking_enabled": False},
    "quiz_pdf_pairing": {"model": "qwen3.6-flash", "thinking_enabled": False},
    "quiz_pdf_review": {"model": "qwen3.6-flash", "thinking_enabled": False},
}


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return default
    return parsed if parsed is not None else default


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _scope_key(palace_id: int | None, source_chapter_id: int | None) -> str:
    if palace_id is not None:
        return f"palace:{palace_id}"
    return f"chapter:{source_chapter_id}"


def _clean_scope_title(value: Any) -> str:
    title = str(value or "").strip()
    title = re.sub(r"\s*/\s*\d+\s*$", "", title)
    return title.strip() or str(value or "").strip()


def _merge_page_sources(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, str], dict[str, Any]] = {}
    for source in items:
        try:
            document_id = int(source.get("subject_document_id") or 0)
        except (TypeError, ValueError):
            continue
        if document_id <= 0:
            continue
        role_hint = str(source.get("role_hint") or "").strip() or "reference"
        key = (document_id, role_hint)
        target = grouped.setdefault(
            key,
            {
                "subject_document_id": document_id,
                "document_name": source.get("document_name"),
                "role_hint": role_hint,
                "page_selection": set(),
            },
        )
        for page in source.get("page_numbers") or source.get("page_selection") or []:
            try:
                page_number = int(page)
            except (TypeError, ValueError):
                continue
            if page_number > 0:
                target["page_selection"].add(page_number)
    result = []
    for item in grouped.values():
        pages = sorted(item.pop("page_selection"))
        if pages:
            result.append({**item, "page_selection": pages})
    return sorted(result, key=lambda item: (item["subject_document_id"], item["role_hint"]))


def build_plan(db_path: Path, audit_path: Path) -> dict[str, Any]:
    audit = _read_json(audit_path)
    duplicate_ids = {
        int(question_id)
        for group in audit.get("duplicate_groups") or []
        for question_id in group.get("question_ids") or []
    }
    direct_ids = {int(item["id"]) for item in audit.get("direct_palace_questions") or []}
    parent_scope_ids = {int(item["id"]) for item in audit.get("parent_scope_questions") or []}
    suspicious_ids = {int(item["id"]) for item in audit.get("suspicious_type_questions") or []}
    high_risk_ids = duplicate_ids | direct_ids | parent_scope_ids | suspicious_ids

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        palaces = {
            int(row["id"]): dict(row)
            for row in con.execute(
                "select id, title, primary_chapter_id from palaces where archived = 0 order by id"
            )
        }
        chapter_palaces = defaultdict(list)
        for row in con.execute(
            """
            select cp.palace_id, cp.chapter_id, cp.is_explicit, c.name
            from chapter_palaces cp
            join chapters c on c.id = cp.chapter_id
            order by cp.palace_id, cp.is_explicit desc, c.sort_order, c.id
            """
        ):
            chapter_palaces[int(row["palace_id"])].append(dict(row))

        source_evidence: dict[str, dict[str, Any]] = {}
        for row in con.execute(
            """
            select id, palace_id, source_chapter_id, classified_chapter_id,
                   question_type, stem, source_meta_json
            from palace_quiz_questions
            order by id
            """
        ):
            meta = _json_load(row["source_meta_json"], {})
            scope = _scope_key(row["palace_id"], row["source_chapter_id"])
            evidence = source_evidence.setdefault(
                scope,
                {
                    "question_ids": [],
                    "high_risk_question_ids": [],
                    "question_types": Counter(),
                    "pdf_sources": [],
                    "extra_prompts": Counter(),
                    "ai_call_log_ids": Counter(),
                },
            )
            question_id = int(row["id"])
            evidence["question_ids"].append(question_id)
            if question_id in high_risk_ids:
                evidence["high_risk_question_ids"].append(question_id)
            evidence["question_types"][str(row["question_type"])] += 1
            if isinstance(meta, dict):
                pdf_sources = meta.get("pdf_sources")
                if isinstance(pdf_sources, list):
                    evidence["pdf_sources"].extend(
                        item for item in pdf_sources if isinstance(item, dict)
                    )
                extra_prompt = str(meta.get("extra_prompt") or "").strip()
                if extra_prompt:
                    evidence["extra_prompts"][extra_prompt] += 1
                log_id = str(meta.get("ai_call_log_id") or "").strip()
                if log_id:
                    evidence["ai_call_log_ids"][log_id] += 1

        tasks = []
        for palace_id, palace in palaces.items():
            primary_chapter_id = palace.get("primary_chapter_id")
            bound_chapters = chapter_palaces.get(palace_id, [])
            selected_chapter_id = _resolve_selected_chapter_id(primary_chapter_id, bound_chapters)
            candidate_scopes = [f"palace:{palace_id}"]
            if primary_chapter_id is not None:
                candidate_scopes.append(f"chapter:{primary_chapter_id}")
            evidence_items = [source_evidence[key] for key in candidate_scopes if key in source_evidence]
            merged_sources = _merge_page_sources(
                [
                    source
                    for evidence in evidence_items
                    for source in evidence.get("pdf_sources") or []
                ]
            )
            high_risk_count = sum(
                len(evidence.get("high_risk_question_ids") or []) for evidence in evidence_items
            )
            total_existing = sum(len(evidence.get("question_ids") or []) for evidence in evidence_items)
            task = {
                "palace_id": palace_id,
                "palace_title": palace.get("title"),
                "selected_chapter_id": selected_chapter_id,
                "bound_chapters": bound_chapters,
                "status": "ready" if len(merged_sources) >= 2 else "needs_page_location",
                "priority": (
                    "high"
                    if high_risk_count
                    else ("medium" if total_existing == 0 else "normal")
                ),
                "existing_question_count": total_existing,
                "high_risk_question_count": high_risk_count,
                "pdf_sources": merged_sources,
                "enable_secondary_review": False,
                "classify_by_mini_palace": False,
                "save_mode": "overwrite",
                "ai_options_by_scenario": LOW_COST_AI_OPTIONS_BY_SCENARIO,
                "extra_prompt": _resolve_extra_prompt(evidence_items, palace),
                "notes": [],
            }
            if task["status"] == "needs_page_location":
                task["notes"].append("No reusable pdf_sources found in existing source_meta.")
            tasks.append(task)

        return {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "database": str(db_path),
            "audit": str(audit_path),
            "model_policy": "low_cost_first",
            "default_ai_options_by_scenario": LOW_COST_AI_OPTIONS_BY_SCENARIO,
            "summary": {
                "task_count": len(tasks),
                "ready_count": sum(1 for task in tasks if task["status"] == "ready"),
                "needs_page_location_count": sum(
                    1 for task in tasks if task["status"] == "needs_page_location"
                ),
                "high_priority_count": sum(1 for task in tasks if task["priority"] == "high"),
            },
            "tasks": tasks,
        }
    finally:
        con.close()


def _resolve_extra_prompt(evidence_items: list[dict[str, Any]], palace: dict[str, Any]) -> str:
    prompts = Counter()
    for evidence in evidence_items:
        prompts.update(evidence.get("extra_prompts") or {})
    if prompts:
        return prompts.most_common(1)[0][0]
    title = _clean_scope_title(palace.get("title"))
    return f"只保留属于「{title}」范围内的题目；题干、选项、答案、解析按原资料保留。"


def _resolve_selected_chapter_id(
    primary_chapter_id: int | None,
    bound_chapters: list[dict[str, Any]],
) -> int | None:
    if primary_chapter_id is not None:
        return primary_chapter_id
    explicit = [item for item in bound_chapters if int(item.get("is_explicit") or 0) == 1]
    if explicit:
        return int(explicit[0]["chapter_id"])
    if bound_chapters:
        return int(bound_chapters[0]["chapter_id"])
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Build low-cost rerun plan for 1000-question quiz imports.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--audit", default=str(DEFAULT_AUDIT))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    plan = build_plan(Path(args.db), Path(args.audit))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out)
    print(json.dumps(plan["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
