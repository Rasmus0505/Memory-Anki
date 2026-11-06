# -*- coding: utf-8 -*-
"""题库去重 第 4 步：合并判定结果 → 计划 → 校验 → （可选）软删除。

用法：
    python apply_plan.py            # 只看计划与校验（不写库）
    python apply_plan.py --apply    # 备份数据库后软删除（deleted_at）

安全：只写 palace_quiz_questions.deleted_at / updated_at，与 API 的
commit_deleted_questions 完全一致；写前整库文件备份，写后输出回滚清单。
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime
from _local_db import resolve_db_path

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__))
DB = str(resolve_db_path())
AUTO = os.path.join(HERE, "auto_groups.json")
VERD = os.path.join(HERE, "verdicts")
PLAN_OUT = os.path.join(HERE, "plan.json")


def _read_round(batch_dir, verdict_dir, kind):
    groups, judged = [], 0
    if not os.path.isdir(verdict_dir):
        return groups, judged
    for fn in sorted(os.listdir(verdict_dir)):
        if not fn.endswith(".json"):
            continue
        src = {}
        bp = os.path.join(batch_dir, fn)
        if os.path.exists(bp):
            src = {g["g"]: g["ids"] for g in json.load(open(bp, encoding="utf-8"))}
        for v in json.load(open(os.path.join(verdict_dir, fn), encoding="utf-8")):
            judged += 1
            if not v.get("dup"):
                continue
            ids = src.get(v.get("g")) or []
            drop = v.get("drop") or []
            if not drop:
                groups.append({"kind": "冲突待人工", "ids": ids, "keep": v.get("keep"),
                               "drop": [], "why": v.get("why", ""), "conflict": True, "g": v["g"]})
                continue
            groups.append({"kind": kind, "ids": ids, "keep": v["keep"], "drop": drop,
                           "why": v.get("why", ""), "conflict": bool(v.get("conflict")), "g": v["g"]})
    return groups, judged


def load_plan():
    groups = []
    for g in json.load(open(AUTO, encoding="utf-8")):
        groups.append({"kind": g["kind"], "ids": g["ids"], "keep": g["keep"], "drop": g["drop"],
                       "why": g.get("note", ""), "conflict": False, "g": "auto"})
    g1, j1 = _read_round(os.path.join(HERE, "llm_batches"), VERD, "模型判定")
    g2, j2 = _read_round(os.path.join(HERE, "llm_batches2"), os.path.join(HERE, "verdicts2"), "模型判定(补充)")
    groups.extend(g1)
    groups.extend(g2)
    return groups, j1 + j2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    meta = {}
    with open(os.path.join(HERE, "questions.jsonl"), encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            meta[d["id"]] = d
    alive = set(meta)

    def rich_score(i):
        m = meta[i]
        return (m["answered"] > 0, bool((m["analysis"] or "").strip()),
                len(json.loads(m["options_json"] or "[]")), -i)

    groups, judged = load_plan()
    problems = []

    # 同一道题可能先被 A 组判为保留、又被 B 组判为删除（第二轮找到更早的孪生题）。
    # 用并查集把这类链合并成一个连通分量，再在每个宫殿内选唯一幸存者。
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    keep_flags = set()
    root_kinds = defaultdict(set)
    root_why = {}
    conflict_groups = []
    for grp in groups:
        if grp["conflict"] or not grp["drop"]:
            if grp["conflict"]:
                conflict_groups.append(grp)
            continue
        keep = grp["keep"]
        if keep not in alive:
            problems.append(f"{grp['g']}: keep={keep} 不在世")
            continue
        keep_flags.add(keep)
        for d in grp["drop"]:
            if d not in alive:
                problems.append(f"{grp['g']}: drop={d} 不在世")
                continue
            union(keep, d)
        root_kinds[find(keep)].add(grp["kind"])
        root_why.setdefault(find(keep), grp.get("why", ""))

    comps = defaultdict(set)
    for x in list(parent):
        comps[find(x)].add(x)

    merged = []
    drop_all = []
    for root, ids in comps.items():
        by_palace = defaultdict(list)
        for i in ids:
            by_palace[meta[i]["palace_id"]].append(i)
        new_drop = []
        for pid, ps in by_palace.items():
            if len(ps) < 2:
                continue
            surv = max(ps, key=lambda i: (i in keep_flags, rich_score(i)))
            new_drop.extend(i for i in ps if i != surv)
        if not new_drop:
            continue
        merged.append({
            "kind": "/".join(sorted(root_kinds.get(root, {"判定"}))),
            "ids": sorted(ids),
            "keep": max((i for i in ids), key=lambda i: (i in keep_flags, rich_score(i))),
            "drop": sorted(new_drop),
            "why": root_why.get(root, ""),
            "conflict": False,
            "g": "merged",
        })
        drop_all.extend(new_drop)
    groups = merged + conflict_groups

    dup_drop = [d for d, c in Counter(drop_all).items() if c > 1]
    if dup_drop:
        problems.append(f"同一题被多个组判删：{dup_drop[:10]}")

    subj = Counter()
    prac_drop = 0
    for grp in groups:
        if not grp["drop"]:
            continue
        for d in grp["drop"]:
            subj[meta[d]["subject_name"]] += 1
            if meta[d]["answered"] > 0:
                prac_drop += 1

    print(f"组数 {len(groups)}｜判定组 {judged}｜将删题 {len(drop_all)}｜作答过的被删 {prac_drop}")
    print("按学科：", dict(subj.most_common()))
    print("冲突待人工组：", sum(1 for g in groups if g["conflict"]))
    print("校验问题：", len(problems))
    for p in problems[:20]:
        print("  !", p)

    plan = {"generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "groups": groups, "drop_all": sorted(drop_all), "problems": problems}
    json.dump(plan, open(PLAN_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("计划 ->", PLAN_OUT)

    if problems:
        print("有校验问题，拒绝写入。")
        return 2
    if not args.apply:
        print("（干跑，未写库）")
        return 0

    # 备份
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(os.path.dirname(DB), f"memory_palace.before-dedup-{stamp}.db")
    con = sqlite3.connect(DB)
    con.execute("pragma wal_checkpoint(TRUNCATE)")
    con.close()
    shutil.copy2(DB, backup)
    print("备份 ->", backup)

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(DB)
    cur = con.cursor()
    ph = ",".join("?" * len(drop_all))
    done = cur.execute(
        f"select count(*) from palace_quiz_questions where deleted_at is null and id in ({ph})", drop_all
    ).fetchone()[0]
    if done != len(drop_all):
        print(f"拒绝：拟删 {len(drop_all)} 条，实际在世 {done} 条")
        con.close()
        return 2
    cur.execute("begin")
    cur.execute(
        f"update palace_quiz_questions set deleted_at=?, updated_at=? where id in ({ph})",
        [now, now, *drop_all],
    )
    changed = cur.rowcount
    con.commit()
    left = cur.execute(
        f"select count(*) from palace_quiz_questions where deleted_at is null and id in ({ph})", drop_all
    ).fetchone()[0]
    total_live = cur.execute("select count(*) from palace_quiz_questions where deleted_at is null").fetchone()[0]
    con.close()
    print(f"软删 {changed} 条；仍存活 {left} 条（应为 0）；题库现存 {total_live} 题")

    rollback = {"created_at": now, "backup": backup, "drop_ids": sorted(drop_all),
                "groups": [g for g in groups if g["drop"]]}
    rbp = os.path.join(HERE, f"rollback-{stamp}.json")
    json.dump(rollback, open(rbp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("回滚清单 ->", rbp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
