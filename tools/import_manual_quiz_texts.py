from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_RUNTIME_HOME = Path(os.environ.get("LOCALAPPDATA", "")) / "MemoryAnki"
if (DEFAULT_RUNTIME_HOME / "data" / "memory_palace.db").exists():
    os.environ["MEMORY_ANKI_HOME"] = str(DEFAULT_RUNTIME_HOME)

from memory_anki.core.config import DB_PATH  # noqa: E402
from memory_anki.infrastructure.db.models import Chapter, Palace, get_session  # noqa: E402
from memory_anki.modules.palace_quiz.application.manual_text_quiz_parser import (  # noqa: E402
    parse_manual_text_quiz_pairs,
)
from memory_anki.modules.palace_quiz.application.service import (  # noqa: E402
    batch_create_chapter_questions,
)


@dataclass(slots=True)
class ImportStats:
    parsed: int = 0
    saved: int = 0
    duplicate_or_skipped: int = 0
    missing_palace: int = 0
    ambiguous_palace: int = 0
    parse_failed: int = 0


@dataclass(frozen=True, slots=True)
class ChapterTarget:
    chapter_id: int
    chapter_name: str
    palace_id: int
    palace_title: str


@dataclass(slots=True)
class ImportReport:
    stats: ImportStats
    matched: dict[str, int]
    missing: dict[str, int]
    ambiguous: dict[str, int]
    warnings: list[str]


def _normalize_title(value: str) -> str:
    text = str(value or "")
    text = text.replace("“", "").replace("”", "").replace('"', "")
    text = text.replace(" ", "").replace("\t", "")
    text = text.replace("/", "")
    while text and text[-1].isdigit():
        text = text[:-1]
    return text.strip()


def _load_existing_chapter_map(session) -> tuple[dict[str, ChapterTarget], set[str]]:
    rows = (
        session.query(Chapter.id, Chapter.name, Palace.id, Palace.title)
        .join(Chapter.palaces)
        .filter(Palace.archived == False)  # noqa: E712
        .all()
    )
    grouped: dict[str, list[ChapterTarget]] = defaultdict(list)
    for chapter_id, chapter_name, palace_id, palace_title in rows:
        target = ChapterTarget(
            chapter_id=int(chapter_id),
            chapter_name=str(chapter_name or ""),
            palace_id=int(palace_id),
            palace_title=str(palace_title or ""),
        )
        grouped[_normalize_title(chapter_name)].append(target)

    mapping: dict[str, ChapterTarget] = {}
    ambiguous: set[str] = set()
    for key, targets in grouped.items():
        if not key:
            continue
        chapter_ids = {target.chapter_id for target in targets}
        palace_ids = {target.palace_id for target in targets}
        if len(chapter_ids) == 1 and len(palace_ids) == 1:
            mapping[key] = targets[0]
        else:
            ambiguous.add(key)
    return mapping, ambiguous


def _load_existing_chapter_snapshot(session) -> list[dict[str, Any]]:
    rows = (
        session.query(Chapter.id, Chapter.name, Palace.id, Palace.title)
        .join(Chapter.palaces)
        .filter(Palace.archived == False)  # noqa: E712
        .order_by(Palace.id, Chapter.id)
        .all()
    )
    return [
        {
            "chapter_id": int(chapter_id),
            "chapter_name": str(chapter_name or ""),
            "palace_id": int(palace_id),
            "palace_title": str(palace_title or ""),
        }
        for chapter_id, chapter_name, palace_id, palace_title in rows
    ]


def _read_text(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "utf-16"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="ignore")


def _pair_files(root: Path, prefix: str) -> list[tuple[str, str, str]]:
    top_question = root / f"{prefix}_questions.txt"
    top_answer = root / f"{prefix}_answers.txt"
    if top_question.exists() and top_answer.exists():
        return [(_read_text(top_question), _read_text(top_answer), f"{top_question.name} + {top_answer.name}")]
    question_dir = root / f"{prefix}_questions"
    answer_dir = root / f"{prefix}_answers"
    question_files = sorted(question_dir.glob(f"{prefix}_questions_*.txt"))
    answer_files = sorted(answer_dir.glob(f"{prefix}_answers_*.txt"))
    if question_files and answer_files:
        question_text = "\n".join(_read_text(path) for path in question_files)
        answer_text = "\n".join(_read_text(path) for path in answer_files)
        return [
            (
                question_text,
                answer_text,
                f"{question_dir.name}/*.txt + {answer_dir.name}/*.txt",
            )
        ]
    return []


def _backup_database() -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = DB_PATH.parent / "backups" / "full" / f"{timestamp}-manual-quiz-import"
    backup_data_dir = backup_dir / "data"
    backup_data_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_data_dir / DB_PATH.name
    shutil.copy2(DB_PATH, backup_path)
    return backup_path


def _target_chapter(
    question: dict[str, Any],
    chapter_map: dict[str, ChapterTarget],
    ambiguous_keys: set[str],
) -> tuple[ChapterTarget | None, str, str]:
    source_meta = question.get("source_meta") if isinstance(question.get("source_meta"), dict) else {}
    manual_import = (
        source_meta.get("manual_import") if isinstance(source_meta.get("manual_import"), dict) else {}
    )
    section_title = str(manual_import.get("section_title") or "")
    chapter_title = str(manual_import.get("chapter_title") or "")
    # Prefer the concrete section. Only fall back to the chapter title when it
    # uniquely identifies one existing palace-bound chapter.
    for title, scope in ((section_title, "section"), (chapter_title, "chapter")):
        key = _normalize_title(title)
        if key in chapter_map:
            return chapter_map[key], title, scope
        if key in ambiguous_keys:
            return None, title, "ambiguous"
    return None, section_title or chapter_title or "(blank)", "missing"


def import_source(
    root: Path,
    prefix: str,
    chapter_map: dict[str, ChapterTarget],
    ambiguous_keys: set[str],
    *,
    dry_run: bool = False,
) -> ImportReport:
    stats = ImportStats()
    grouped_payloads: dict[int, list[dict[str, Any]]] = defaultdict(list)
    warnings: list[str] = []
    matched: dict[str, int] = defaultdict(int)
    missing: dict[str, int] = defaultdict(int)
    ambiguous: dict[str, int] = defaultdict(int)
    for question_text, answer_text, source_filename in _pair_files(root, prefix):
        parsed, parse_warnings = parse_manual_text_quiz_pairs(
            question_text=question_text,
            answer_text=answer_text,
            source_filename=source_filename,
        )
        warnings.extend(parse_warnings)
        if not parsed:
            stats.parse_failed += 1
            continue
        for parsed_question in parsed:
            payload = parsed_question.to_payload()
            stats.parsed += 1
            target, title, scope = _target_chapter(payload, chapter_map, ambiguous_keys)
            if target is None:
                if scope == "ambiguous":
                    stats.ambiguous_palace += 1
                    ambiguous[title] += 1
                else:
                    stats.missing_palace += 1
                    missing[title] += 1
                continue
            matched[f"{target.palace_title} -> {target.chapter_name}"] += 1
            grouped_payloads[target.chapter_id].append(payload)

    if not dry_run:
        with get_session() as session:
            for chapter_id, payloads in grouped_payloads.items():
                before = len(payloads)
                saved_items = batch_create_chapter_questions(session, chapter_id, payloads)
                stats.saved += len(saved_items)
                stats.duplicate_or_skipped += before - len(saved_items)
    return ImportReport(
        stats=stats,
        matched=dict(sorted(matched.items())),
        missing=dict(sorted(missing.items())),
        ambiguous=dict(sorted(ambiguous.items())),
        warnings=warnings,
    )


def _write_report(
    *,
    results: dict[str, ImportReport],
    backup_path: Path | None,
    dry_run: bool,
    chapter_snapshot: list[dict[str, Any]],
) -> Path:
    report_dir = REPO_ROOT / "output"
    report_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = report_dir / f"manual_quiz_import_report_{timestamp}.json"
    payload = {
        "dry_run": dry_run,
        "database": str(DB_PATH),
        "backup": str(backup_path) if backup_path is not None else None,
        "existing_chapters": chapter_snapshot,
        "sources": {
            name: {
                "stats": {
                    "parsed": report.stats.parsed,
                    "saved": report.stats.saved,
                    "duplicate_or_skipped": report.stats.duplicate_or_skipped,
                    "missing_palace": report.stats.missing_palace,
                    "ambiguous_palace": report.stats.ambiguous_palace,
                    "parse_failed": report.stats.parse_failed,
                },
                "matched": report.matched,
                "missing": report.missing,
                "ambiguous": report.ambiguous,
                "warnings": report.warnings,
            }
            for name, report in results.items()
        },
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Import OCR textbook quiz text into Memory Anki.")
    parser.add_argument(
        "--waijiao",
        default=r"C:\Users\Administrator\Desktop\Qwen vl ocr\waijiao",
    )
    parser.add_argument(
        "--zhongjiao",
        default=r"C:\Users\Administrator\Desktop\Qwen vl ocr\zhongjiao",
    )
    parser.add_argument("--dry-run", action="store_true", help="Parse and report without writing questions.")
    args = parser.parse_args()

    backup_path = None if args.dry_run else _backup_database()
    with get_session() as session:
        chapter_map, ambiguous_keys = _load_existing_chapter_map(session)
        chapter_snapshot = _load_existing_chapter_snapshot(session)

    results = {
        "waijiao": import_source(
            Path(args.waijiao),
            "waijiao",
            chapter_map,
            ambiguous_keys,
            dry_run=args.dry_run,
        ),
        "zhongjiao": import_source(
            Path(args.zhongjiao),
            "zhongjiao",
            chapter_map,
            ambiguous_keys,
            dry_run=args.dry_run,
        ),
    }
    report_path = _write_report(
        results=results,
        backup_path=backup_path,
        dry_run=args.dry_run,
        chapter_snapshot=chapter_snapshot,
    )
    print(f"database={DB_PATH}")
    print(f"backup={backup_path}")
    print(f"report={report_path}")
    for name, stats in results.items():
        source_stats = stats.stats
        print(
            f"{name}: parsed={source_stats.parsed} saved={source_stats.saved} "
            f"duplicate_or_skipped={source_stats.duplicate_or_skipped} "
            f"missing_palace={source_stats.missing_palace} "
            f"ambiguous_palace={source_stats.ambiguous_palace} "
            f"parse_failed={source_stats.parse_failed} warnings={len(stats.warnings)}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
