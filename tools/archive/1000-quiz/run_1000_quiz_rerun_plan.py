from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_SYNC_ROOT = Path(r"D:\BaiduSyncdisk\MemoryAnki-Sync")
DEFAULT_WORK_HOME = REPO_ROOT / ".audit" / "1000-quiz" / "app-home"
DEFAULT_PLAN = REPO_ROOT / ".audit" / "1000-quiz" / "rerun_plan.json"
DEFAULT_RESULT_DIR = REPO_ROOT / ".audit" / "1000-quiz" / "rerun-results"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def restore_latest_snapshot(sync_root: Path, work_home: Path, *, force: bool = False) -> dict[str, Any]:
    state = _read_json(sync_root / "state.json")
    snapshot_name = str(state.get("snapshot_name") or "").strip()
    if not snapshot_name:
        raise RuntimeError(f"{sync_root / 'state.json'} 缺少 snapshot_name")
    zip_path = sync_root / "snapshots" / snapshot_name
    if not zip_path.exists():
        raise RuntimeError(f"同步快照不存在: {zip_path}")
    marker = work_home / ".snapshot-name"
    if work_home.exists() and marker.exists() and marker.read_text(encoding="utf-8") == snapshot_name and not force:
        return {"snapshot_name": snapshot_name, "restored": False, "work_home": str(work_home)}
    if work_home.exists():
        shutil.rmtree(work_home)
    work_home.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            target = (work_home / member.filename).resolve()
            if not str(target).startswith(str(work_home.resolve())):
                raise RuntimeError(f"同步快照包含非法路径: {member.filename}")
        archive.extractall(work_home)
    marker.write_text(snapshot_name, encoding="utf-8")
    return {"snapshot_name": snapshot_name, "restored": True, "work_home": str(work_home)}


def _normalize_ai_options(raw: dict[str, Any]) -> dict[str, Any]:
    from memory_anki.modules.settings.application.ai_model_registry import (
        normalize_ai_runtime_options,
    )

    return {
        str(key): normalize_ai_runtime_options(value)
        for key, value in (raw or {}).items()
        if isinstance(value, dict)
    }


def run_task(task: dict[str, Any], *, save: bool) -> dict[str, Any]:
    from memory_anki.infrastructure.db.models import get_session
    from memory_anki.modules.quiz.application.quiz_generation_service import (
        generate_quiz_preview_from_pdf,
    )
    from memory_anki.modules.quiz.application.question_creation_commands import (
        batch_create_chapter_questions,
    )

    pdf_sources = task.get("pdf_sources") or []
    if not pdf_sources:
        raise RuntimeError("任务缺少 pdf_sources，需先定位页码。")
    selected_chapter_id = task.get("selected_chapter_id")
    with get_session() as session:
        preview = generate_quiz_preview_from_pdf(
            session,
            palace_id=int(task["palace_id"]),
            subject_document_id=0,
            page_selection=[],
            extra_prompt=str(task.get("extra_prompt") or ""),
            enable_secondary_review=bool(task.get("enable_secondary_review", False)),
            pdf_sources=pdf_sources,
            classify_by_mini_palace=bool(task.get("classify_by_mini_palace", False)),
            selected_chapter_id=int(selected_chapter_id) if selected_chapter_id else None,
            ai_options_by_scenario=_normalize_ai_options(
                task.get("ai_options_by_scenario") or {}
            ),
        )
        saved_items: list[dict[str, Any]] = []
        if save:
            if not selected_chapter_id:
                raise RuntimeError("保存前必须有 selected_chapter_id。")
            saved_items = batch_create_chapter_questions(
                session,
                int(selected_chapter_id),
                list(preview.get("questions") or []),
                save_mode=str(task.get("save_mode") or "overwrite"),
            )
    return {"preview": preview, "saved_items": saved_items}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run low-cost 1000-question rerun plan in an audit app-home.")
    parser.add_argument("--plan", default=str(DEFAULT_PLAN))
    parser.add_argument("--sync-root", default=str(DEFAULT_SYNC_ROOT))
    parser.add_argument("--work-home", default=str(DEFAULT_WORK_HOME))
    parser.add_argument("--result-dir", default=str(DEFAULT_RESULT_DIR))
    parser.add_argument("--status", default="ready")
    parser.add_argument("--priority", default="")
    parser.add_argument("--palace-id", type=int, default=0)
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--save", action="store_true", help="Write generated questions into the audit work-home database.")
    parser.add_argument("--force-restore", action="store_true")
    args = parser.parse_args()

    work_home = Path(args.work_home)
    restore_info = restore_latest_snapshot(
        Path(args.sync_root),
        work_home,
        force=args.force_restore,
    )
    os.environ["MEMORY_ANKI_HOME"] = str(work_home)

    plan = _read_json(Path(args.plan))
    tasks = list(plan.get("tasks") or [])
    if args.palace_id:
        tasks = [task for task in tasks if int(task.get("palace_id") or 0) == args.palace_id]
    if args.status:
        tasks = [task for task in tasks if str(task.get("status") or "") == args.status]
    if args.priority:
        tasks = [task for task in tasks if str(task.get("priority") or "") == args.priority]
    tasks = tasks[: max(1, args.limit)]

    batch_result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "restore": restore_info,
        "save": bool(args.save),
        "tasks": [],
    }
    result_dir = Path(args.result_dir)
    result_dir.mkdir(parents=True, exist_ok=True)
    for task in tasks:
        task_label = f"palace-{task['palace_id']}"
        try:
            result = run_task(task, save=bool(args.save))
            record = {
                "task": task,
                "ok": True,
                "question_count": len(result["preview"].get("questions") or []),
                "saved_count": len(result["saved_items"]),
                "result": result,
            }
        except Exception as exc:
            record = {"task": task, "ok": False, "error": repr(exc)}
        task_path = result_dir / f"{task_label}.json"
        _write_json(task_path, record)
        batch_result["tasks"].append(
            {
                "palace_id": task.get("palace_id"),
                "palace_title": task.get("palace_title"),
                "ok": record["ok"],
                "question_count": record.get("question_count", 0),
                "saved_count": record.get("saved_count", 0),
                "result_path": str(task_path),
                "error": record.get("error"),
            }
        )
        print(json.dumps(batch_result["tasks"][-1], ensure_ascii=False))
    batch_path = result_dir / "latest_batch.json"
    _write_json(batch_path, batch_result)
    print(batch_path)
    return 0 if all(item["ok"] for item in batch_result["tasks"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
