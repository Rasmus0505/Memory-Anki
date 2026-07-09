from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_PLAN = REPO_ROOT / ".audit" / "1000-quiz" / "rerun_plan_with_located_pages.json"
DEFAULT_RESULT_DIR = REPO_ROOT / ".audit" / "1000-quiz" / "rerun-results"
DEFAULT_WORK_HOME = REPO_ROOT / ".audit" / "1000-quiz" / "app-home"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Save QA'ed 1000-question preview result files into the audit app-home DB."
    )
    parser.add_argument("--plan", default=str(DEFAULT_PLAN))
    parser.add_argument("--result-dir", default=str(DEFAULT_RESULT_DIR))
    parser.add_argument("--work-home", default=str(DEFAULT_WORK_HOME))
    parser.add_argument("--palace-id", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    os.environ["MEMORY_ANKI_HOME"] = str(Path(args.work_home))

    from memory_anki.infrastructure.db.models import get_session
    from memory_anki.infrastructure.db.models import PalaceQuizQuestion
    from memory_anki.modules.palace_quiz.application.question_creation_commands import (
        batch_create_chapter_questions,
    )

    plan = _read_json(Path(args.plan))
    tasks = list(plan.get("tasks") or [])
    if args.palace_id:
        tasks = [task for task in tasks if int(task.get("palace_id") or 0) == args.palace_id]

    saved_summary: list[dict[str, Any]] = []
    with get_session() as session:
        for task in tasks:
            palace_id = int(task.get("palace_id") or 0)
            chapter_id = int(task.get("selected_chapter_id") or 0)
            if palace_id <= 0 or chapter_id <= 0:
                saved_summary.append(
                    {"palace_id": palace_id, "ok": False, "error": "missing selected_chapter_id"}
                )
                continue
            result_path = Path(args.result_dir) / f"palace-{palace_id}.json"
            record = _read_json(result_path)
            if not record.get("ok"):
                saved_summary.append(
                    {"palace_id": palace_id, "ok": False, "error": record.get("error") or "no ok result"}
                )
                continue
            questions = record.get("result", {}).get("preview", {}).get("questions", [])
            if not isinstance(questions, list) or not questions:
                saved_summary.append(
                    {"palace_id": palace_id, "ok": False, "error": "empty questions"}
                )
                continue
            if args.dry_run:
                saved_count = 0
            else:
                bound_chapter_ids = {
                    int(item.get("chapter_id") or 0)
                    for item in (task.get("bound_chapters") or [])
                    if int(item.get("chapter_id") or 0) > 0
                }
                for question in (
                    session.query(PalaceQuizQuestion)
                    .filter_by(palace_id=palace_id)
                    .all()
                ):
                    session.delete(question)
                if bound_chapter_ids:
                    for question in (
                        session.query(PalaceQuizQuestion)
                        .filter(PalaceQuizQuestion.source_chapter_id.in_(bound_chapter_ids))
                        .all()
                    ):
                        session.delete(question)
                saved = batch_create_chapter_questions(
                    session,
                    chapter_id,
                    questions,
                    save_mode=str(task.get("save_mode") or "overwrite"),
                )
                saved_count = len(saved)
            saved_summary.append(
                {
                    "palace_id": palace_id,
                    "chapter_id": chapter_id,
                    "ok": True,
                    "question_count": len(questions),
                    "saved_count": saved_count,
                    "result_path": str(result_path),
                }
            )
    print(json.dumps(saved_summary, ensure_ascii=False, indent=2))
    return 0 if all(item.get("ok") for item in saved_summary) else 1


if __name__ == "__main__":
    raise SystemExit(main())
