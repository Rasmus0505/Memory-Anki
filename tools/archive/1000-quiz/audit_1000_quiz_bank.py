from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SYNC_ROOT = Path(r"D:\BaiduSyncdisk\MemoryAnki-Sync")
REPORT_ROOT = REPO_ROOT / ".audit" / "1000-quiz"


@dataclass(frozen=True, slots=True)
class SnapshotDb:
    db_path: Path
    snapshot_name: str
    extracted: bool


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(
        str.maketrans(
            {
                "“": '"',
                "”": '"',
                "‘": '"',
                "’": '"',
                "（": "(",
                "）": ")",
                "，": ",",
                "。": ".",
                "；": ";",
                "：": ":",
                "？": "?",
                "！": "!",
            }
        )
    )
    text = text.replace('"', "").replace("'", "")
    text = re.sub(r"^\s*\d+\s*[.、．]\s*", "", text)
    text = re.sub(r"\s+", "", text)
    return text.strip().lower()


def _question_identity(row: sqlite3.Row) -> str:
    options = _json_load(row["options_json"], [])
    option_text = ""
    if isinstance(options, list):
        option_text = "|".join(
            f"{_normalize_text(item.get('id') if isinstance(item, dict) else '')}:"
            f"{_normalize_text(item.get('text') if isinstance(item, dict) else item)}"
            for item in options
        )
    return "|".join([str(row["question_type"] or ""), _normalize_text(row["stem"]), option_text])


def extract_latest_snapshot_db(sync_root: Path, report_root: Path) -> SnapshotDb:
    state = _read_json(sync_root / "state.json")
    snapshot_name = str(state.get("snapshot_name") or "").strip()
    if not snapshot_name:
        raise RuntimeError(f"{sync_root / 'state.json'} 缺少 snapshot_name")
    zip_path = sync_root / "snapshots" / snapshot_name
    if not zip_path.exists():
        raise RuntimeError(f"同步快照不存在: {zip_path}")
    target = report_root / "snapshot" / "data" / "memory_palace.db"
    manifest = report_root / "snapshot" / "sync-manifest.json"
    if target.exists() and target.stat().st_mtime >= zip_path.stat().st_mtime:
        return SnapshotDb(target, snapshot_name, False)
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for name, output in (
            ("data/memory_palace.db", target),
            ("sync-manifest.json", manifest),
        ):
            entry = archive.getinfo(name)
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, output.open("wb") as dest:
                dest.write(source.read())
    return SnapshotDb(target, snapshot_name, True)


def _chapter_path(chapters: dict[int, sqlite3.Row], chapter_id: int | None) -> list[str]:
    if chapter_id is None or chapter_id not in chapters:
        return []
    path: list[str] = []
    current = chapters.get(chapter_id)
    while current is not None:
        path.append(str(current["name"] or ""))
        parent_id = current["parent_id"]
        current = chapters.get(int(parent_id)) if parent_id is not None else None
    return list(reversed(path))


def audit_database(db_path: Path) -> dict[str, Any]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        chapters = {
            int(row["id"]): row
            for row in con.execute("select id, subject_id, parent_id, name from chapters")
        }
        palaces = {
            int(row["id"]): row
            for row in con.execute(
                "select id, title, primary_chapter_id, archived from palaces where archived = 0"
            )
        }
        questions = list(
            con.execute(
                """
                select id, palace_id, source_chapter_id, classified_chapter_id,
                       question_type, stem, options_json, answer_payload_json,
                       analysis, source_meta_json
                from palace_quiz_questions
                order by id
                """
            )
        )
        by_identity: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in questions:
            by_identity[_question_identity(row)].append(row)

        duplicate_groups = []
        for rows in by_identity.values():
            if len(rows) <= 1:
                continue
            duplicate_groups.append(
                {
                    "count": len(rows),
                    "question_ids": [int(row["id"]) for row in rows],
                    "stem": rows[0]["stem"],
                    "scopes": [
                        {
                            "palace_id": row["palace_id"],
                            "source_chapter_id": row["source_chapter_id"],
                            "classified_chapter_id": row["classified_chapter_id"],
                        }
                        for row in rows
                    ],
                }
            )

        parent_scope_questions = []
        direct_palace_questions = []
        suspicious_type_questions = []
        source_page_coverage: dict[str, Any] = defaultdict(
            lambda: {"question_count": 0, "types": Counter(), "page_sets": Counter()}
        )
        for row in questions:
            meta = _json_load(row["source_meta_json"], {})
            if row["palace_id"] is not None and row["source_chapter_id"] is None:
                palace = palaces.get(int(row["palace_id"]))
                direct_palace_questions.append(
                    {
                        "id": row["id"],
                        "palace_id": row["palace_id"],
                        "palace_title": str(palace["title"] or "") if palace is not None else "",
                        "stem": row["stem"],
                    }
                )
            source_chapter_id = row["source_chapter_id"]
            if source_chapter_id is not None:
                chapter = chapters.get(int(source_chapter_id))
                if chapter is not None and chapter["parent_id"] is None and row["classified_chapter_id"] is None:
                    parent_scope_questions.append(
                        {
                            "id": row["id"],
                            "source_chapter_id": source_chapter_id,
                            "source_chapter_path": _chapter_path(chapters, int(source_chapter_id)),
                            "stem": row["stem"],
                        }
                    )
            stem = str(row["stem"] or "")
            options = _json_load(row["options_json"], [])
            if row["question_type"] == "short_answer" and isinstance(options, list) and options:
                suspicious_type_questions.append(
                    {"id": row["id"], "reason": "short_answer_has_options", "stem": stem}
                )
            if row["question_type"] == "short_answer" and re.search(r"\bA[.．、]\s*.+\bB[.．、]\s*", stem):
                suspicious_type_questions.append(
                    {"id": row["id"], "reason": "short_answer_stem_contains_options", "stem": stem}
                )
            pdf_sources = meta.get("pdf_sources") if isinstance(meta, dict) else None
            if isinstance(pdf_sources, list):
                key = json.dumps(
                    [
                        {
                            "document_name": item.get("document_name"),
                            "role_hint": item.get("role_hint"),
                        }
                        for item in pdf_sources
                        if isinstance(item, dict)
                    ],
                    ensure_ascii=False,
                    sort_keys=True,
                )
                page_key = json.dumps(
                    [
                        item.get("page_numbers")
                        for item in pdf_sources
                        if isinstance(item, dict)
                    ],
                    ensure_ascii=False,
                )
                source_page_coverage[key]["question_count"] += 1
                source_page_coverage[key]["types"][str(row["question_type"])] += 1
                source_page_coverage[key]["page_sets"][page_key] += 1

        return {
            "database": str(db_path),
            "counts": {
                "palaces": len(palaces),
                "chapters": len(chapters),
                "questions": len(questions),
            },
            "duplicate_groups": sorted(
                duplicate_groups,
                key=lambda item: (-item["count"], item["question_ids"]),
            ),
            "direct_palace_questions": direct_palace_questions,
            "parent_scope_questions": parent_scope_questions,
            "suspicious_type_questions": suspicious_type_questions,
            "source_page_coverage": {
                key: {
                    "question_count": value["question_count"],
                    "types": dict(value["types"]),
                    "page_sets": dict(value["page_sets"]),
                }
                for key, value in source_page_coverage.items()
            },
        }
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit 1000-question Memory Anki quiz bank.")
    parser.add_argument("--sync-root", default=str(DEFAULT_SYNC_ROOT))
    parser.add_argument("--db", default="")
    parser.add_argument("--output-dir", default=str(REPORT_ROOT))
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.db:
        snapshot = SnapshotDb(Path(args.db), "manual-db", False)
    else:
        snapshot = extract_latest_snapshot_db(Path(args.sync_root), output_dir)
    report = audit_database(snapshot.db_path)
    report.update(
        {
            "snapshot_name": snapshot.snapshot_name,
            "snapshot_extracted": snapshot.extracted,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    report_path = output_dir / "quiz_bank_audit.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report_path)
    print(json.dumps(report["counts"], ensure_ascii=False))
    print(f"duplicate_groups={len(report['duplicate_groups'])}")
    print(f"direct_palace_questions={len(report['direct_palace_questions'])}")
    print(f"parent_scope_questions={len(report['parent_scope_questions'])}")
    print(f"suspicious_type_questions={len(report['suspicious_type_questions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
