# -*- coding: utf-8 -*-
"""Write hand-decided question<->node bindings for one palace's questions.

Input JSON:
    {"palace_id": 15,
     "bindings": [
       {"question_id": 401, "node_uids": ["uid-a"], "reason": "考查X"},
       {"question_id": 402, "node_uids": ["uid-b"], "reason": "知识点在第三节",
        "target_palace_id": 18}
     ],
     "unbound": [403]}

Replaces every binding belonging to this palace's questions -- including edges
that point at another palace's mindmap -- and leaves other palaces' questions
alone even when they bind into this palace.

`target_palace_id` defaults to `palace_id`; set it to bind a question onto a
node that lives in a different palace's mindmap.

Validates that each question belongs to the palace and each uid exists in the
target palace's mindmap, and refuses to write anything if validation fails.

    MEMORY_ANKI_HOME="F:\\memory anki data" python tools/write_palace_bindings.py plan.json
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from dump_palace_for_binding import connect, walk_nodes  # noqa: E402

RUN_ID = "hand-bind-2026-07-26"
MAX_NODES_PER_QUESTION = 8


def main() -> None:
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    palace_id = int(plan["palace_id"])
    con = connect()

    palace = con.execute(
        "select id, title, manual_title from palaces where id=? and deleted_at is null",
        (palace_id,),
    ).fetchone()
    if palace is None:
        raise SystemExit(f"palace {palace_id} not found")

    uid_cache: dict[int, set[str]] = {}

    def known_uids(target_id: int) -> set[str]:
        if target_id not in uid_cache:
            row = con.execute(
                "select editor_doc from palaces where id=? and deleted_at is null", (target_id,)
            ).fetchone()
            if row is None:
                uid_cache[target_id] = set()
            else:
                uid_cache[target_id] = {uid for uid, _t, _n, _d in walk_nodes(row["editor_doc"])}
        return uid_cache[target_id]

    active_qids = {
        int(r["id"])
        for r in con.execute(
            "select id from palace_quiz_questions where palace_id=? and deleted_at is null",
            (palace_id,),
        )
    }

    errors: list[str] = []
    rows: list[tuple] = []
    seen: set[tuple[int, int, str]] = set()
    bound_qids: set[int] = set()
    now = datetime.now(UTC).replace(tzinfo=None).isoformat(sep=" ")

    for item in plan.get("bindings") or []:
        qid = int(item["question_id"])
        if qid not in active_qids:
            errors.append(f"Q{qid} 不属于宫殿 {palace_id}（或已删除）")
            continue
        target_id = int(item.get("target_palace_id") or palace_id)
        if not known_uids(target_id):
            errors.append(f"Q{qid} 的目标宫殿 {target_id} 不存在或导图为空")
            continue
        uids = [str(u).strip() for u in item.get("node_uids") or [] if str(u).strip()]
        if not uids:
            errors.append(f"Q{qid} 没有给节点")
            continue
        reason = str(item.get("reason") or "").strip()[:500]
        if not reason:
            errors.append(f"Q{qid} 没写理由")
            continue
        for uid in uids:
            if uid not in known_uids(target_id):
                errors.append(f"Q{qid} 引用了宫殿 {target_id} 中不存在的节点 {uid}")
                continue
            if (qid, target_id, uid) in seen:
                continue
            seen.add((qid, target_id, uid))
            bound_qids.add(qid)
            rows.append((target_id, qid, uid, item.get("confidence"), reason, "ai", RUN_ID, now, now))

    for qid in sorted(bound_qids):
        count = sum(1 for q, _p, _u in seen if q == qid)
        if count > MAX_NODES_PER_QUESTION:
            errors.append(f"Q{qid} 共绑了 {count} 个节点，上限 {MAX_NODES_PER_QUESTION}")

    declared_unbound = {int(q) for q in plan.get("unbound") or []}
    missing = active_qids - bound_qids - declared_unbound
    if missing:
        errors.append(f"这些题既没绑定也没列进 unbound：{sorted(missing)}")
    overlap = declared_unbound & bound_qids
    if overlap:
        errors.append(f"这些题同时出现在 bindings 和 unbound：{sorted(overlap)}")

    if errors:
        print("!! 校验失败，未写入：")
        for line in errors:
            print("  -", line)
        raise SystemExit(1)

    # Scope the wipe to THIS palace's questions, wherever their edges point.
    removed = con.execute(
        """delete from palace_quiz_question_node_bindings
           where question_id in (
             select id from palace_quiz_questions where palace_id=? and deleted_at is null
           )""",
        (palace_id,),
    ).rowcount
    con.executemany(
        """insert into palace_quiz_question_node_bindings
           (palace_id, question_id, node_uid, confidence, reason, source, run_id, created_at, updated_at)
           values (?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    con.commit()
    cross = sum(1 for r in rows if r[0] != palace_id)
    print(
        f"宫殿 {palace_id}《{palace['manual_title'] or palace['title']}》："
        f"清掉旧绑定 {removed} 条，写入 {len(rows)} 条"
        + (f"（其中跨宫 {cross} 条）" if cross else "")
        + f"，覆盖 {len(bound_qids)}/{len(active_qids)} 道题，未绑定 {len(declared_unbound)} 道"
    )


if __name__ == "__main__":
    main()
