# -*- coding: utf-8 -*-
"""Export chapter-6 sections 2-7 mindmaps from DB for format optimization."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(r"D:\BaiduSyncdisk\Memory Anki")
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))

# Resolve vol:MemoryAnki/...
from memory_anki.core.local_config import load_local_runtime_config

cfg = load_local_runtime_config()
os.environ["MEMORY_ANKI_HOME"] = str(cfg.local_app_home)
print("HOME", cfg.local_app_home)

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import engine
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.application.editor_state_service import get_palace_editor_state

OUT = ROOT / "tools" / "_tmp_ch6_vision" / "export_current"
OUT.mkdir(parents=True, exist_ok=True)

SPECS = [
    (40, "第二节 卢梭的教育思想"),
    (41, "第三节 裴斯泰洛齐的教育思想"),
    (42, "第四节 赫尔巴特的教育思想"),
    (43, "第五节 福禄培尔的教育思想"),
    (44, "第六节 马克思和恩格斯的教育思想"),
    (45, "第七节 西欧近代教育思潮"),
]


def editor_to_source(doc: dict) -> dict:
    root = (doc or {}).get("root") or {}

    def node(n: dict) -> dict:
        data = n.get("data") or {}
        text = data.get("text") or data.get("name") or ""
        item: dict = {
            "text": text,
            "children": [node(c) for c in (n.get("children") or [])],
        }
        em = data.get("emphasis_marks")
        if em:
            item["emphasis_marks"] = em
        return item

    return {
        "title": (root.get("data") or {}).get("text") or "",
        "children": [node(c) for c in (root.get("children") or [])],
    }


def count_nodes(tree: dict) -> int:
    total = 0

    def walk(nodes: list) -> None:
        nonlocal total
        for n in nodes or []:
            total += 1
            walk(n.get("children") or [])

    walk(tree.get("children") or [])
    return total


def main() -> None:
    with Session(engine) as session:
        for pid, expected in SPECS:
            palace = session.get(Palace, pid)
            if palace is None:
                print("MISSING", pid)
                continue
            state = get_palace_editor_state(palace)
            src = editor_to_source(state.get("editor_doc") or {})
            path = OUT / f"{pid:02d}_{palace.title}.json"
            path.write_text(json.dumps(src, ensure_ascii=False, indent=2), encoding="utf-8")
            print(
                f"id={pid} title={palace.title!r} nodes={count_nodes(src)} "
                f"top={len(src.get('children') or [])} -> {path.name}"
            )


if __name__ == "__main__":
    main()
