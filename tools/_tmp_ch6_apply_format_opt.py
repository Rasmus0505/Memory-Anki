# -*- coding: utf-8 -*-
"""Apply format-optimized mindmaps for ch6 sections 2-7 (palaces 40-45)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))

from memory_anki.core.local_config import load_local_runtime_config

cfg = load_local_runtime_config()
os.environ["MEMORY_ANKI_HOME"] = str(cfg.local_app_home)
print("HOME", cfg.local_app_home)

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import engine
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
)
from memory_anki.modules.produce.application.mindmap_import.normalization import (
    build_editor_doc,
    normalize_source_tree,
)

OPT_DIR = ROOT / "tools" / "_tmp_ch6_vision" / "optimized"

SPECS = [
    (40, "40_卢梭.json", "第二节 卢梭的教育思想"),
    (41, "41_裴斯泰洛齐.json", "第三节 裴斯泰洛齐的教育思想"),
    (42, "42_赫尔巴特.json", "第四节 赫尔巴特的教育思想"),
    (43, "43_福禄培尔.json", "第五节 福禄培尔的教育思想"),
    (44, "44_马克思恩格斯.json", "第六节 马克思和恩格斯的教育思想"),
    (45, "45_教育思潮.json", "第七节 西欧近代教育思潮"),
]


def count_nodes(doc: dict) -> int:
    root = (doc or {}).get("root") or {}
    total = 0

    def walk(nodes: list) -> None:
        nonlocal total
        for n in nodes or []:
            total += 1
            walk(n.get("children") or [])

    walk(root.get("children") or [])
    return total


def apply_mindmap(session: Session, palace: Palace, mindmap: dict) -> int:
    source = normalize_source_tree(
        {
            "title": mindmap.get("title") or palace.title,
            "children": mindmap.get("children") or [],
        },
        disable_rebalance=True,
    )
    editor_doc = build_editor_doc(
        source,
        fallback_title=palace.title,
        preserve_line_breaks=True,
    )
    root_data = (editor_doc.get("root") or {}).setdefault("data", {})
    root_data["text"] = palace.title
    root_data["memoryAnkiRootKind"] = "palace"
    root_data["uid"] = root_data.get("uid") or "palace-root"
    root_data["expand"] = True

    state = get_palace_editor_state(palace)
    result = save_palace_editor_state(
        session,
        palace,
        {
            "editor_doc": editor_doc,
            "expected_editor_fingerprint": state.get("editor_fingerprint") or "",
            "editor_source": "import_apply",
            "confirm_dangerous_change": True,
            "allow_stale_overwrite": True,
        },
    )
    return count_nodes(result.get("editor_doc") or {})


def main() -> None:
    report = []
    with Session(engine) as session:
        for palace_id, filename, expected_title in SPECS:
            path = OPT_DIR / filename
            if not path.exists():
                raise SystemExit(f"missing optimized file: {path}")
            mindmap = json.loads(path.read_text(encoding="utf-8"))
            palace = session.get(Palace, palace_id)
            if palace is None:
                raise SystemExit(f"palace {palace_id} missing")
            if palace.deleted_at is not None:
                raise SystemExit(f"palace {palace_id} deleted")

            print(f"\n== palace {palace_id} {palace.title!r} ==")
            print(f"  source file: {filename}")
            print(f"  mindmap title: {mindmap.get('title')!r}")
            nodes = apply_mindmap(session, palace, mindmap)
            # keep stable manual title
            if expected_title and palace.title != expected_title:
                palace.title = expected_title
                palace.manual_title = expected_title
                palace.title_mode = "manual"
            session.flush()
            print(f"  nodes written: {nodes}")
            report.append(
                {
                    "palace_id": palace_id,
                    "title": palace.title,
                    "nodes": nodes,
                    "source": filename,
                }
            )
        session.commit()
        print("\nCOMMIT OK")

    out = OPT_DIR / "apply_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("report ->", out)
    for row in report:
        print(row)


if __name__ == "__main__":
    main()
