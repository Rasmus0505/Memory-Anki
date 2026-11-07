# -*- coding: utf-8 -*-
"""把指向已删除卡片的题目绑定收回根节点。

背景：删除导图卡片后，若绑定还指着已消失的 node_uid，这道题在随心/复习
里就永远不进任何单元——看起来像题目“没了”。本脚本：

1. 找出所有「绑定只指向已删除卡片」的活跃题目，把它们收回宫殿根节点；
2. 找出同一题还有有效绑定、但仍残留悬空边的，只删悬空边，不动有效绑定；
3. 找出完全没有绑定行的活跃题目，补一条根节点绑定。

用法：
    python tools/repair_orphaned_quiz_bindings.py                 # 只审计，不写库
    python tools/repair_orphaned_quiz_bindings.py --apply         # 备份后写库
    python tools/repair_orphaned_quiz_bindings.py --report out.md # 指定报告路径

数据库路径：``MEMORY_ANKI_DB`` 优先，否则读 local-config 的 local_app_home。
写库前用 sqlite3 在线备份整库到同目录 ``memory_palace.before-*-<时间>.db``。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
REMOVED_NODE_ROOT_REASON = "节点删除后归到根节点"
DEFAULT_REPORT = REPO_ROOT / "deliverables" / "题目绑定丢失审计-2026-11-07.md"


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


def _parse_doc(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        doc = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _walk_doc(doc: dict[str, Any]) -> tuple[set[str], dict[str, str], dict[str, str]]:
    """Return (uids, uid→text, uid→parent uid) for one editor document."""
    uids: set[str] = set()
    labels: dict[str, str] = {}
    parents: dict[str, str] = {}

    def walk(node: Any, parent_uid: str | None) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        uid = str(data.get("uid") or "").strip()
        text = str(data.get("text") or "").strip()
        if uid:
            uids.add(uid)
            labels[uid] = text or uid
            if parent_uid:
                parents[uid] = parent_uid
        children = node.get("children") if isinstance(node.get("children"), list) else []
        for child in children:
            walk(child, uid or parent_uid)

    walk(doc.get("root"), None)
    return uids, labels, parents


def _root_uid(doc: dict[str, Any]) -> str | None:
    root = doc.get("root")
    if not isinstance(root, dict):
        return None
    data = root.get("data") if isinstance(root.get("data"), dict) else {}
    uid = str(data.get("uid") or "").strip()
    return uid or None


def _version_node_labels(
    conn: sqlite3.Connection, palace_id: int, wanted_uids: set[str]
) -> dict[str, str]:
    """Recover the text of uids that only exist in saved versions (消失的卡片)."""
    found: dict[str, str] = {}
    if not wanted_uids:
        return found
    rows = conn.execute(
        "SELECT editor_doc FROM palace_versions WHERE palace_id = ? ORDER BY id DESC",
        (palace_id,),
    ).fetchall()
    for (raw,) in rows:
        remaining = wanted_uids - found.keys()
        if not remaining:
            break
        _uids, labels, _parents = _walk_doc(_parse_doc(raw))
        for uid in remaining:
            if uid in labels:
                found[uid] = labels[uid]
    return found


def build_plan(conn: sqlite3.Connection) -> dict[str, Any]:
    palaces = {
        int(row["id"]): row
        for row in conn.execute(
            "SELECT id, title, editor_doc, archived FROM palaces WHERE deleted_at IS NULL"
        ).fetchall()
    }
    doc_cache: dict[int, tuple[set[str], dict[str, str], dict[str, str], str | None]] = {}
    for palace_id, row in palaces.items():
        doc = _parse_doc(row["editor_doc"])
        uids, labels, parents = _walk_doc(doc)
        doc_cache[palace_id] = (uids, labels, parents, _root_uid(doc))

    bindings_by_question: dict[int, list[sqlite3.Row]] = defaultdict(list)
    for row in conn.execute(
        """
        SELECT b.id, b.palace_id, b.question_id, b.node_uid, b.source, b.reason,
               b.created_at, b.updated_at,
               q.palace_id AS owner_palace_id, q.deleted_at AS question_deleted_at,
               q.stem, q.question_type
        FROM palace_quiz_question_node_bindings AS b
        JOIN palace_quiz_questions AS q ON q.id = b.question_id
        WHERE q.deleted_at IS NULL
        """
    ).fetchall():
        bindings_by_question[int(row["question_id"])].append(row)

    active_questions = conn.execute(
        """
        SELECT id, palace_id, stem, question_type FROM palace_quiz_questions
        WHERE deleted_at IS NULL
        """
    ).fetchall()

    items: list[dict[str, Any]] = []
    for question in active_questions:
        question_id = int(question["id"])
        owner_palace_id = int(question["palace_id"]) if question["palace_id"] else 0
        if owner_palace_id not in doc_cache:
            continue
        uids, _labels, _parents, root_uid = doc_cache[owner_palace_id]
        edges = [
            edge
            for edge in bindings_by_question.get(question_id, [])
            if int(edge["palace_id"]) == owner_palace_id
        ]
        live = [edge for edge in edges if str(edge["node_uid"]).strip() in uids]
        stale = [edge for edge in edges if str(edge["node_uid"]).strip() not in uids]
        if not stale:
            continue
        if live:
            action = "drop_stale"
            target_uid = None
        elif root_uid:
            action = "rehome_root"
            target_uid = root_uid
        else:
            continue
        items.append(
            {
                "question_id": question_id,
                "palace_id": owner_palace_id,
                "palace_title": str(palaces[owner_palace_id]["title"] or ""),
                "stem": str(question["stem"] or ""),
                "question_type": str(question["question_type"] or ""),
                "action": action,
                "target_uid": target_uid,
                "live_uids": sorted(str(edge["node_uid"]) for edge in live),
                "stale_uids": sorted(str(edge["node_uid"]) for edge in stale),
                "stale_edge_ids": [int(edge["id"]) for edge in stale],
                "keep_edge_id": int(stale[0]["id"]) if not live else None,
                "stale_sources": sorted({str(edge["source"] or "") for edge in stale}),
                "stale_created_at": min(
                    (str(edge["created_at"] or "") for edge in stale), default=""
                ),
                "stale_updated_at": max(
                    (str(edge["updated_at"] or "") for edge in stale), default=""
                ),
            }
        )

    unbound = []
    for question in active_questions:
        question_id = int(question["id"])
        owner_palace_id = int(question["palace_id"]) if question["palace_id"] else 0
        if owner_palace_id not in doc_cache:
            continue
        if bindings_by_question.get(question_id):
            continue
        _uids, _labels, _parents, root_uid = doc_cache[owner_palace_id]
        if not root_uid:
            continue
        unbound.append(
            {
                "question_id": question_id,
                "palace_id": owner_palace_id,
                "palace_title": str(palaces[owner_palace_id]["title"] or ""),
                "stem": str(question["stem"] or ""),
                "question_type": str(question["question_type"] or ""),
                "action": "bind_root",
                "target_uid": root_uid,
                "live_uids": [],
                "stale_uids": [],
                "stale_edge_ids": [],
                "keep_edge_id": None,
                "stale_sources": [],
                "stale_created_at": "",
                "stale_updated_at": "",
            }
        )

    wanted_by_palace: dict[int, set[str]] = defaultdict(set)
    for item in items:
        wanted_by_palace[item["palace_id"]].update(item["stale_uids"])
    for item in items:
        labels = _version_node_labels(conn, item["palace_id"], wanted_by_palace[item["palace_id"]])
        item["stale_texts"] = {uid: labels.get(uid, "") for uid in item["stale_uids"]}

    return {
        "palaces": {pid: str(row["title"] or "") for pid, row in palaces.items()},
        "items": items,
        "unbound": unbound,
    }


def _backup_database(db_path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = db_path.with_name(f"memory_palace.before-binding-repair-{stamp}.db")
    source = sqlite3.connect(db_path)
    try:
        backup = sqlite3.connect(target)
        try:
            source.backup(backup)
        finally:
            backup.close()
    finally:
        source.close()
    return target


def apply_plan(conn: sqlite3.Connection, plan: dict[str, Any]) -> dict[str, int]:
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    rehomed = dropped = created = 0
    for item in plan["items"]:
        if item["action"] == "rehome_root":
            keep_id = int(item["keep_edge_id"])
            conn.execute(
                "UPDATE palace_quiz_question_node_bindings "
                "SET node_uid = ?, reason = ?, updated_at = ? WHERE id = ?",
                (item["target_uid"], REMOVED_NODE_ROOT_REASON, now, keep_id),
            )
            extra = [edge_id for edge_id in item["stale_edge_ids"] if edge_id != keep_id]
            if extra:
                conn.executemany(
                    "DELETE FROM palace_quiz_question_node_bindings WHERE id = ?",
                    [(edge_id,) for edge_id in extra],
                )
                dropped += len(extra)
            rehomed += 1
        else:
            conn.executemany(
                "DELETE FROM palace_quiz_question_node_bindings WHERE id = ?",
                [(int(edge_id),) for edge_id in item["stale_edge_ids"]],
            )
            dropped += len(item["stale_edge_ids"])
    for item in plan["unbound"]:
        conn.execute(
            "INSERT INTO palace_quiz_question_node_bindings "
            "(palace_id, question_id, node_uid, confidence, reason, source, run_id, "
            " created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 'manual', NULL, ?, ?)",
            (
                item["palace_id"],
                item["question_id"],
                item["target_uid"],
                REMOVED_NODE_ROOT_REASON,
                now,
                now,
            ),
        )
        created += 1
    conn.commit()
    return {"rehomed": rehomed, "dropped": dropped, "created": created}


def render_report(plan: dict[str, Any], *, applied: bool, backup: Path | None) -> str:
    items = plan["items"]
    unbound = plan["unbound"]
    rehome_items = [item for item in items if item["action"] == "rehome_root"]
    drop_items = [item for item in items if item["action"] == "drop_stale"]
    by_palace: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in rehome_items:
        by_palace[item["palace_id"]].append(item)

    lines = [
        "# 卡片删除导致的题目丢失审计（2026-11-07）",
        "",
        "## 结论",
        "",
        f"- 只指向已删除卡片、因而从随心/复习里消失的题目：**{len(rehome_items)} 道**",
        f"- 还有有效绑定、只残留悬空边的题目：{len(drop_items)} 道（只清悬空边）",
        f"- 完全没有绑定行的活跃题目：{len(unbound)} 道（补根节点绑定）",
        f"- 涉及宫殿：{len(by_palace)} 座",
        f"- 已写库：{'是' if applied else '否（只审计）'}",
    ]
    if backup is not None:
        lines.append(f"- 写库前备份：`{backup}`")
    lines += [
        "",
        "根因：导图保存时不校验题目绑定。删卡片后绑定仍指向已消失的 node_uid，",
        "随心按单元过滤题目时匹配不到任何单元，题目就被静默跳过。",
        "修复：保存导图时把悬空绑定收回宫殿根节点；已丢失的题目由本脚本一次性恢复。",
        "",
        "## 按宫殿",
        "",
        "| 宫殿 | 丢失题目 |",
        "| --- | --- |",
    ]
    for palace_id, palace_items in sorted(
        by_palace.items(), key=lambda pair: (-len(pair[1]), pair[0])
    ):
        lines.append(f"| {palace_items[0]['palace_title']}（#{palace_id}） | {len(palace_items)} |")
    lines += ["", "## 逐题清单", ""]
    for palace_id, palace_items in sorted(by_palace.items()):
        lines.append(f"### {palace_items[0]['palace_title']}（#{palace_id}）")
        lines.append("")
        for item in palace_items:
            removed = "、".join(
                f"{uid}「{item['stale_texts'].get(uid) or '版本中未找到'}」"
                for uid in item["stale_uids"]
            )
            stem = item["stem"].replace("\n", " ")[:80]
            lines.append(
                f"- #{item['question_id']} {stem} → 回收至根节点 `{item['target_uid']}`；"
                f"原卡片：{removed}"
            )
        lines.append("")
    if drop_items:
        lines += ["## 只清悬空边", ""]
        for item in drop_items:
            stem = item["stem"].replace("\n", " ")[:60]
            lines.append(
                f"- #{item['question_id']} {stem}（{item['palace_title']}）"
                f"悬空：{', '.join(item['stale_uids'])}；保留：{', '.join(item['live_uids'])}"
            )
        lines.append("")
    if unbound:
        lines += ["## 无绑定题目补根节点", ""]
        for item in unbound:
            stem = item["stem"].replace("\n", " ")[:60]
            lines.append(f"- #{item['question_id']} {stem}（{item['palace_title']}）")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None, help="数据库路径；默认读 local-config")
    parser.add_argument("--apply", action="store_true", help="备份后写库")
    parser.add_argument("--report", default=None, help="Markdown 报告路径（默认 deliverables/…）")
    args = parser.parse_args()

    db_path = resolve_db_path(args.db)
    if not db_path.exists():
        print(f"数据库不存在：{db_path}", file=sys.stderr)
        return 2
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        plan = build_plan(conn)
        backup: Path | None = None
        counts = {"rehomed": 0, "dropped": 0, "created": 0}
        if args.apply:
            backup = _backup_database(db_path)
            counts = apply_plan(conn, plan)
        report_path = Path(args.report or DEFAULT_REPORT)
        # 复跑审计时若已无待修项，不覆盖上一次的审计报告。
        if plan["items"] or plan["unbound"] or args.report:
            report = render_report(plan, applied=args.apply, backup=backup)
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(report, encoding="utf-8")
        summary = {
            "database": str(db_path),
            "applied": args.apply,
            "backup": str(backup) if backup else None,
            "rehome_questions": sum(
                1 for item in plan["items"] if item["action"] == "rehome_root"
            ),
            "drop_stale_questions": sum(
                1 for item in plan["items"] if item["action"] == "drop_stale"
            ),
            "bind_root_questions": len(plan["unbound"]),
            "counts": counts,
            "report": str(report_path),
            "palaces": Counter(
                item["palace_title"]
                for item in plan["items"]
                if item["action"] == "rehome_root"
            ).most_common(),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
