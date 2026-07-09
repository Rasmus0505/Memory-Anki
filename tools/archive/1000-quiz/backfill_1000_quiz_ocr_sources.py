from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from repair_1000_quiz_bank_local import (  # noqa: E402
    APPROVED_SUPPLEMENTAL_QUESTIONS,
    CURRENT_PALACE_RULES,
    REPAIR_BATCH,
)

DEFAULT_DB = Path(r"D:\BaiduSyncdisk\MemoryAnki-Sync\app-home\data\memory_palace.db")
DEFAULT_OCR_ROOT = REPO_ROOT / ".audit" / "1000-quiz-local-repair" / "ocr"
DEFAULT_BACKUP_ROOT = REPO_ROOT / ".audit" / "1000-quiz-local-repair" / "backups"


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS palace_quiz_ocr_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            palace_id INTEGER NOT NULL REFERENCES palaces(id) ON DELETE CASCADE,
            source_kind VARCHAR(40) NOT NULL DEFAULT 'ocr',
            source_set VARCHAR(120) NOT NULL DEFAULT '',
            page_key VARCHAR(160) NOT NULL DEFAULT '',
            page_number INTEGER,
            image_path TEXT NOT NULL DEFAULT '',
            raw_text TEXT NOT NULL DEFAULT '',
            lines_json TEXT NOT NULL DEFAULT '[]',
            source_meta_json TEXT NOT NULL DEFAULT '{}',
            import_batch VARCHAR(120) NOT NULL DEFAULT '',
            created_at DATETIME,
            updated_at DATETIME,
            CONSTRAINT uq_palace_quiz_ocr_sources_page_batch
                UNIQUE (palace_id, source_set, page_key, import_batch)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_palace_quiz_ocr_sources_palace "
        "ON palace_quiz_ocr_sources (palace_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_palace_quiz_ocr_sources_palace_source "
        "ON palace_quiz_ocr_sources (palace_id, source_set, page_number)"
    )


def _page_ref(source_set: str, page: int) -> str:
    return f"{source_set}/page_{int(page):03d}"


def _collect_palace_refs() -> dict[int, set[str]]:
    refs_by_palace: dict[int, set[str]] = {}
    for palace_id, rule in CURRENT_PALACE_RULES.items():
        subject = str(rule.get("subject") or "")
        if subject not in {"zhongjiao", "waijiao"}:
            continue
        refs = refs_by_palace.setdefault(int(palace_id), set())
        for page in sorted(rule.get("pages") or []):
            refs.add(_page_ref(f"{subject}_questions", int(page)))
    for item in APPROVED_SUPPLEMENTAL_QUESTIONS:
        palace_id = int(item["palace_id"])
        refs = refs_by_palace.setdefault(palace_id, set())
        source_pages = item.get("source_pages") if isinstance(item, dict) else None
        if not isinstance(source_pages, dict):
            continue
        for values in source_pages.values():
            if not isinstance(values, list):
                continue
            for value in values:
                normalized = str(value or "").strip()
                if normalized:
                    refs.add(normalized)
    return refs_by_palace


def _read_ocr_page(ocr_root: Path, page_ref: str) -> dict[str, Any]:
    source_set, page_key = page_ref.split("/", 1)
    path = ocr_root / source_set / f"{page_key}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "source_set": source_set,
        "page_key": page_key,
        "json_path": str(path),
        "data": data,
    }


def _backup_db(db_path: Path, backup_root: Path) -> Path:
    backup_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_root / f"{timestamp}-before-ocr-source-backfill-memory_palace.db"
    shutil.copy2(db_path, backup_path)
    return backup_path


def backfill(db_path: Path, ocr_root: Path, *, backup: bool = True) -> dict[str, Any]:
    if not db_path.exists():
        raise FileNotFoundError(db_path)
    if not ocr_root.exists():
        raise FileNotFoundError(ocr_root)
    backup_path = _backup_db(db_path, DEFAULT_BACKUP_ROOT) if backup else None
    refs_by_palace = _collect_palace_refs()
    now = datetime.now().isoformat(timespec="seconds")
    inserted = 0
    updated = 0
    missing: list[dict[str, Any]] = []
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        for palace_id, refs in sorted(refs_by_palace.items()):
            for page_ref in sorted(refs):
                try:
                    page = _read_ocr_page(ocr_root, page_ref)
                except FileNotFoundError:
                    missing.append({"palace_id": palace_id, "page_ref": page_ref})
                    continue
                data = page["data"]
                source_set = page["source_set"]
                page_key = page["page_key"]
                raw_text = str(data.get("text") or "")
                lines = data.get("lines") if isinstance(data.get("lines"), list) else []
                source_meta = {
                    "repair_batch": REPAIR_BATCH,
                    "ocr_json_path": page["json_path"],
                    "width": data.get("width"),
                    "height": data.get("height"),
                    "line_count": data.get("line_count"),
                    "wall_seconds": data.get("wall_seconds"),
                }
                row = conn.execute(
                    """
                    SELECT id FROM palace_quiz_ocr_sources
                    WHERE palace_id = ? AND source_set = ? AND page_key = ? AND import_batch = ?
                    """,
                    (palace_id, source_set, page_key, REPAIR_BATCH),
                ).fetchone()
                params = (
                    "ocr",
                    source_set,
                    page_key,
                    data.get("page"),
                    str(data.get("image_path") or ""),
                    raw_text,
                    json.dumps(lines, ensure_ascii=False),
                    json.dumps(source_meta, ensure_ascii=False),
                    REPAIR_BATCH,
                    now,
                )
                if row is None:
                    conn.execute(
                        """
                        INSERT INTO palace_quiz_ocr_sources (
                            palace_id, source_kind, source_set, page_key, page_number,
                            image_path, raw_text, lines_json, source_meta_json,
                            import_batch, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (palace_id, *params, now),
                    )
                    inserted += 1
                else:
                    conn.execute(
                        """
                        UPDATE palace_quiz_ocr_sources
                        SET source_kind = ?, source_set = ?, page_key = ?, page_number = ?,
                            image_path = ?, raw_text = ?, lines_json = ?,
                            source_meta_json = ?, import_batch = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (*params, int(row[0])),
                    )
                    updated += 1
        conn.commit()
        total = conn.execute("SELECT count(*) FROM palace_quiz_ocr_sources").fetchone()[0]
    finally:
        conn.close()
    return {
        "db_path": str(db_path),
        "ocr_root": str(ocr_root),
        "backup_path": str(backup_path) if backup_path else None,
        "palace_count": len(refs_by_palace),
        "inserted": inserted,
        "updated": updated,
        "missing": missing,
        "total_ocr_sources": total,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--ocr-root", type=Path, default=DEFAULT_OCR_ROOT)
    parser.add_argument("--no-backup", action="store_true")
    args = parser.parse_args()
    result = backfill(args.db, args.ocr_root, backup=not args.no_backup)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
