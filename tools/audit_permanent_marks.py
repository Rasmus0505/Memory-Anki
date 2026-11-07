# -*- coding: utf-8 -*-
"""审计宫殿脑图上的永久标记（permanentSplitMark）。

只读：按学科列出每座宫殿，以及哪些节点带着永久标记。

用法：
    python tools/audit_permanent_marks.py                        # 默认审计教育学原理、教育心理学
    python tools/audit_permanent_marks.py 教育学原理 教育心理学   # 指定学科
    python tools/audit_permanent_marks.py --db path/to.db        # 指定数据库

数据库路径：``MEMORY_ANKI_DB`` 优先，否则读 local-config 的 local_app_home。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUBJECTS = ("教育学原理", "教育心理学")


def resolve_db_path(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    override = os.environ.get("MEMORY_ANKI_DB")
    if override:
        return Path(override).expanduser()
    api_src = REPO_ROOT / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))
    from memory_anki.core.local_config import load_local_runtime_config

    config = load_local_runtime_config(repo_root=REPO_ROOT)
    return config.local_app_home / "学习数据" / "memory_palace.db"


def marked_nodes(editor_doc: Any) -> list[dict[str, Any]]:
    doc = json.loads(editor_doc or "{}") if isinstance(editor_doc, str) else editor_doc
    root = doc.get("root") if isinstance(doc, dict) else None
    if not isinstance(root, dict):
        return []
    rows: list[dict[str, Any]] = []

    def walk(node: dict[str, Any], depth: int, is_root: bool) -> None:
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        marked = data.get("permanentSplitMark") is True or data.get("permanent_split_mark") is True
        if marked:
            rows.append(
                {
                    "uid": data.get("uid") or data.get("memoryAnkiId"),
                    "text": (data.get("text") or "").strip()[:40],
                    "depth": depth,
                    "is_root": is_root,
                }
            )
        for child in node.get("children") or []:
            if isinstance(child, dict):
                walk(child, depth + 1, False)

    walk(root, 0, True)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="审计宫殿脑图永久标记（只读）")
    parser.add_argument("subjects", nargs="*", default=list(DEFAULT_SUBJECTS), help="学科名；默认教育学原理、教育心理学")
    parser.add_argument("--db", default=None, help="数据库路径；默认读 local-config")
    args = parser.parse_args()

    db_path = resolve_db_path(args.db)
    if not db_path.exists():
        print(f"database not found: {db_path}", file=sys.stderr)
        return 1

    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    cur = con.cursor()
    subjects = cur.execute("select id, name from subjects").fetchall()
    print("subjects:", subjects)
    target_ids = [sid for sid, name in subjects if name in args.subjects]
    if not target_ids:
        print("target subjects not found")
        return 1
    q = """
        select p.id, p.title, p.archived, p.deleted_at, p.editor_doc
        from palaces p
        join palace_subjects ps on ps.palace_id = p.id
        where ps.subject_id in ({})
        order by p.id
    """.format(",".join("?" * len(target_ids)))
    total = 0
    for pid, title, archived, deleted, doc in cur.execute(q, target_ids):
        marks = marked_nodes(doc)
        total += len(marks)
        print(f"\npalace {pid} | {title!r} archived={archived} deleted={bool(deleted)} marks={len(marks)}")
        for m in marks:
            print("   ", m)
    print(f"\nTOTAL marks: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
