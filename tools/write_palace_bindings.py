# -*- coding: utf-8 -*-
"""Write hand-decided question<->node bindings for one palace's questions.

Input JSON:
    {"palace_id": 15,
     "question_ids": [401, 402],
     "run_id": "manual-bind-2026-08-03",
     "source": "manual",
     "bindings": [
       {"question_id": 401, "node_uids": ["uid-a"], "reason": "考查X"},
       {"question_id": 402, "node_uids": ["uid-b"], "reason": "知识点在第三节",
        "target_palace_id": 18}
     ],
     "unbound": [403]}

By default, question_ids is required and only those questions are replaced.
To intentionally replace every active question in a palace, omit question_ids
and set replace_scope to palace. This explicit opt-in prevents a chapter plan
from deleting bindings belonging to other chapters in the same palace.

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

DEFAULT_RUN_ID = "hand-bind-manual"
ALLOWED_SOURCES = {"manual", "vision", "import"}
MAX_NODES_PER_QUESTION = 8


def main() -> None:
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    palace_id = int(plan["palace_id"])
    run_id = str(plan.get("run_id") or DEFAULT_RUN_ID).strip()
    source = str(plan.get("source") or "manual").strip()
    if not run_id:
        raise SystemExit("run_id 不能为空")
    if source not in ALLOWED_SOURCES:
        raise SystemExit(f"source 必须是 {sorted(ALLOWED_SOURCES)} 之一")
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

    palace_active_qids = {
        int(r["id"])
        for r in con.execute(
            "select id from palace_quiz_questions where palace_id=? and deleted_at is null",
            (palace_id,),
        )
    }
    declared_question_ids = plan.get("question_ids")
    if declared_question_ids is None:
        if plan.get("replace_scope") != "palace":
            raise SystemExit(
                "为防止误删其他章节绑定，必须提供 question_ids；"
                "若确实要覆盖整座宫殿，请显式设置 replace_scope='palace'"
            )
        active_qids = palace_active_qids
    else:
        try:
            active_qids = {int(qid) for qid in declared_question_ids}
        except (TypeError, ValueError) as exc:
            raise SystemExit("question_ids 必须是整数数组") from exc
        invalid_qids = active_qids - palace_active_qids
        if invalid_qids:
            raise SystemExit(
                f"question_ids 中存在不属于宫殿 {palace_id} 或已删除的题目："
                f"{sorted(invalid_qids)}"
            )
        if not active_qids:
            raise SystemExit("question_ids 不能为空")

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
            rows.append(
                (
                    target_id,
                    qid,
                    uid,
                    item.get("confidence"),
                    reason,
                    source,
                    run_id,
                    now,
                    now,
                )
            )

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

    # Scope the wipe to the explicit question set, wherever their edges point.
    placeholders = ",".join("?" for _ in active_qids)
    try:
        removed = con.execute(
            f"delete from palace_quiz_question_node_bindings "
            f"where question_id in ({placeholders})",
            tuple(sorted(active_qids)),
        ).rowcount
        con.executemany(
            """insert into palace_quiz_question_node_bindings
               (palace_id, question_id, node_uid, confidence, reason, source, run_id, created_at, updated_at)
               values (?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        con.commit()
    except Exception:
        con.rollback()
        raise
    cross = sum(1 for r in rows if r[0] != palace_id)
    print(
        f"宫殿 {palace_id}《{palace['manual_title'] or palace['title']}》："
        f"清掉旧绑定 {removed} 条，写入 {len(rows)} 条"
        + (f"（其中跨宫 {cross} 条）" if cross else "")
        + f"，覆盖 {len(bound_qids)}/{len(active_qids)} 道题，未绑定 {len(declared_unbound)} 道"
    )


if __name__ == "__main__":
    main()
