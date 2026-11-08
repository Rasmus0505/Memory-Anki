# -*- coding: utf-8 -*-
"""把指定学科的永久标记统一成「每座宫殿只有根节点一个」。

背景：一个宫殿里每个 permanentSplitMark 都会切出一个复习单元。教育学原理 /
教育心理学里很多宫殿被切成了 1~5 个单元，用户希望每座宫殿只按整宫复习一次。

做法：对两学科的全部活跃宫殿，清除所有后代节点上的 permanentSplitMark，
再给根节点打上 permanentSplitMark，然后走正常的 editor save 流程
（版本快照 + 树同步 + 复习单元 reconcile）。合并不会重置已学进度：
reconcile 会带走贡献单元里最弱的一份 FSRS 记忆状态，展示档位为 0
（到期日被提前过）也不会把整宫读成「首学」。

用法：
    python tools/normalize_permanent_marks.py            # 只审计，不写库
    python tools/normalize_permanent_marks.py --apply    # 备份后写库

数据库路径：``MEMORY_ANKI_DB`` 优先，否则读 local-config 的 local_app_home。
写库前用 sqlite3 在线备份整库到同目录 ``memory_palace.before-*-<时间>.db``。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
TARGET_SUBJECTS = ("教育学原理", "教育心理学")
MARK_KEYS = ("permanentSplitMark", "permanent_split_mark")


def resolve_db_path(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    override = os.environ.get("MEMORY_ANKI_DB")
    if override:
        return Path(override).expanduser()
    if str(API_SRC) not in sys.path:
        sys.path.insert(0, str(API_SRC))
    from memory_anki.core.local_config import load_local_runtime_config

    config = load_local_runtime_config(repo_root=REPO_ROOT)
    return config.local_app_home / "学习数据" / "memory_palace.db"


def parse_doc(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        doc = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def walk_nodes(node: Any):
    """Yield (node, depth, is_root) in depth-first order."""
    stack = [(node, 0, True)]
    while stack:
        current, depth, is_root = stack.pop()
        if not isinstance(current, dict):
            continue
        yield current, depth, is_root
        children = current.get("children")
        if isinstance(children, list):
            for child in reversed(children):
                stack.append((child, depth + 1, False))


def marked_count(doc: dict[str, Any]) -> int:
    count = 0
    root = doc.get("root")
    for node, _depth, _is_root in walk_nodes(root):
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        if any(data.get(key) is True for key in MARK_KEYS):
            count += 1
    return count


def clear_marks(node: Any) -> int:
    """Delete every non-root permanent mark; root marks are handled separately."""
    removed = 0
    root = node
    for current, _depth, is_root in walk_nodes(root):
        if is_root:
            continue
        data = current.get("data")
        if not isinstance(data, dict):
            continue
        for key in MARK_KEYS:
            if data.get(key) is True:
                data.pop(key, None)
                removed += 1
        current["data"] = data
    return removed


def set_root_mark(doc: dict[str, Any]) -> None:
    root = doc.get("root")
    assert isinstance(root, dict)
    data = root.get("data")
    data = data if isinstance(data, dict) else {}
    data["permanentSplitMark"] = True
    root["data"] = data


def backup_database(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = db_path.with_name(f"memory_palace.before-mark-normalize-{stamp}.db")
    source = sqlite3.connect(str(db_path))
    dest = sqlite3.connect(str(target))
    try:
        source.backup(dest)
    finally:
        dest.close()
        source.close()
    return target


def load_target_palaces(db_path: Path) -> list[dict[str, Any]]:
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            """
            select p.id, p.title, p.editor_doc
            from palaces p
            join palace_subjects ps on ps.palace_id = p.id
            join subjects s on s.id = ps.subject_id
            where s.name in (?, ?)
              and p.deleted_at is null
              and p.archived = 0
            order by p.id
            """,
            TARGET_SUBJECTS,
        ).fetchall()
    finally:
        con.close()
    return [
        {"id": int(pid), "title": title or "", "editor_doc": parse_doc(doc)}
        for pid, title, doc in rows
    ]


def active_unit_count(db_path: Path, palace_id: int) -> int:
    con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    try:
        return int(
            con.execute(
                "select count(*) from review_unit_states where palace_id = ? and active = 1",
                (palace_id,),
            ).fetchone()[0]
        )
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--db")
    args = parser.parse_args()

    db_path = resolve_db_path(args.db).resolve()
    print(f"db: {db_path}")
    if not db_path.exists():
        print("database not found")
        return 1

    if str(API_SRC) not in sys.path:
        sys.path.insert(0, str(API_SRC))
    from sqlalchemy.orm import Session

    from memory_anki.core.config import DB_PATH
    from memory_anki.infrastructure.db._tables._base import engine
    from memory_anki.modules.content.application.editor_state_service import (
        EDITOR_FINGERPRINT_KEY,
        get_palace_editor_state,
        save_palace_editor_state,
    )
    from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

    if Path(DB_PATH).resolve() != db_path:
        print(f"warning: app engine points at {DB_PATH}, expected {db_path}")
        print("set MEMORY_ANKI_HOME / local-config so both point at the same file")
        return 1

    targets = load_target_palaces(db_path)
    print(f"palaces: {len(targets)}")
    plan = []
    skipped = []
    for item in targets:
        doc = item["editor_doc"]
        root = doc.get("root")
        children = root.get("children") if isinstance(root, dict) else None
        before = marked_count(doc)
        nodes = sum(1 for _ in walk_nodes(root))
        if not isinstance(root, dict) or not isinstance(children, list) or not children:
            skipped.append((item["id"], item["title"], "empty palace"))
            continue
        plan.append({**item, "before": before, "nodes": nodes})

    print(f"will normalize: {len(plan)}  |  skip: {len(skipped)}")
    for pid, title, reason in skipped:
        print(f"  SKIP {pid} {title!r}: {reason}")

    if not args.apply:
        for item in plan:
            print(
                f"  {item['id']:>4} marks={item['before']} nodes={item['nodes']} "
                f"-> root-only  {item['title']}"
            )
        return 0

    backup = backup_database(db_path)
    print(f"backup: {backup}")

    session = Session(engine)
    failures: list[tuple[int, str]] = []
    normalized = 0
    try:
        for item in plan:
            from memory_anki.infrastructure.db._tables.palaces import Palace

            palace = session.get(Palace, item["id"])
            if palace is None or palace.deleted_at is not None or palace.archived:
                failures.append((item["id"], "palace no longer editable"))
                continue
            state = get_palace_editor_state(palace)
            doc = state.get("editor_doc")
            if not isinstance(doc, dict) or not isinstance(doc.get("root"), dict):
                failures.append((item["id"], "editor doc missing root"))
                continue
            removed = clear_marks(doc["root"])
            set_root_mark(doc)
            try:
                save_palace_editor_state(
                    session,
                    palace,
                    {
                        "editor_doc": doc,
                        "editor_config": state.get("editor_config"),
                        "editor_local_config": state.get("editor_local_config"),
                        "lang": state.get("lang"),
                        "expected_editor_fingerprint": state.get(EDITOR_FINGERPRINT_KEY),
                        "editor_source": "palace_mark_root",
                        "sync_reason": "mark_change",
                        "reconcile_units": True,
                        "response_mode": "ack",
                    },
                    uow=SqlAlchemyUnitOfWork(session),
                )
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                session.rollback()
                failures.append((item["id"], f"{type(exc).__name__}: {exc}"))
                continue
            session.expire_all()
            units = active_unit_count(db_path, item["id"])
            normalized += 1
            print(
                f"  OK {item['id']:>4} removed={removed} marks={item['before']}->1 "
                f"active_units={units}  {item['title']}"
            )
    finally:
        session.close()

    print(f"\nnormalized: {normalized}  failed: {len(failures)}")
    for pid, reason in failures:
        print(f"  FAIL {pid}: {reason}")
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
