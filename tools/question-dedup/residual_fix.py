# -*- coding: utf-8 -*-
"""补漏：第一轮因跨宫殿合并没有落到的“选择/简答双胞胎”。

规则（同一宫殿内）：
  R1 题干归一化完全相同、答案文本一致 → 重复
  R2 一条选择 + 一条简答，简答答案 = 该选择题某个选项，且题干相似度 ≥0.85 → 重复
  R3 显式清单（人工核对过的个别对）
冲突/不同选项集的不动。

默认干跑；--apply 先整库备份再软删除。
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from _local_db import resolve_db_path

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__))
DB = str(resolve_db_path())
PREFIX = re.compile(r"^【[^】]*】")

EXPLICIT = [
    # 同一“定义”问了两次：12557 干净，12562 带 OCR 错字且是残缺超集
    {"keep": 12557, "drop": [12562], "why": "同一定义重复，保留无错字的一条"},
]


def ns(s):
    s = PREFIX.sub("", s or "")
    s = re.sub(r"[\s　]+", "", s)
    return re.sub(r"[，。；：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)


def nt(s):
    s = re.sub(r"[\s　]+", "", s or "")
    return re.sub(r"[，。；：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)


def ans_text(r):
    opts = {o["id"]: o["text"] for o in json.loads(r["options_json"] or "[]")}
    a = json.loads(r["answer_payload_json"] or "{}")
    ids = a.get("correct_option_ids") or ([a["correct_option_id"]] if a.get("correct_option_id") else [])
    return "".join(opts.get(i, "") for i in ids) or (a.get("reference_answer") or "")


def rich_score(r):
    return (r["answered"] > 0, len(json.loads(r["options_json"] or "[]")),
            bool((r["analysis"] or "").strip()), -r["id"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        """select id,palace_id,question_type,stem,options_json,answer_payload_json,analysis,
                  correct_count+incorrect_count as answered
           from palace_quiz_questions where deleted_at is null""")]
    con.close()
    by_id = {r["id"]: r for r in rows}
    by_palace = defaultdict(list)
    for r in rows:
        by_palace[r["palace_id"]].append(r)

    pairs = []  # (keep, drop, why)

    for pid, items in by_palace.items():
        # R1 同题干同答案
        groups = defaultdict(list)
        for r in items:
            groups[ns(r["stem"])].append(r)
        for stem, g in groups.items():
            if len(g) < 2:
                continue
            if len({nt(ans_text(r)) for r in g}) != 1:
                continue
            best = max(g, key=rich_score)
            for r in g:
                if r["id"] != best["id"]:
                    pairs.append((best["id"], r["id"], "同题干同答案"))

        # R2 简答答案 = 选择题选项 + 题干 ≥0.85
        mc = [r for r in items if r["question_type"] == "multiple_choice"]
        sa = [r for r in items if r["question_type"] == "short_answer"]
        if not mc or not sa:
            continue
        optmap = defaultdict(list)
        for m in mc:
            for o in json.loads(m["options_json"] or "[]"):
                t = nt(o["text"])
                if len(t) >= 2:
                    optmap[t].append(m)
        cand = [(s, m) for s in sa for m in optmap.get(nt(ans_text(s)), [])]
        if not cand:
            continue
        texts = [ns(x["stem"]) for x in mc] + [ns(x["stem"]) for x in sa]
        X = normalize(TfidfVectorizer(analyzer="char", ngram_range=(2, 4), sublinear_tf=True).fit_transform(texts))
        idx = {r["id"]: i for i, r in enumerate(mc + sa)}
        for s, m in cand:
            sim = float((X[idx[s["id"]]] @ X[idx[m["id"]]].T).toarray().ravel()[0])
            if sim >= 0.85:
                keep, drop = (m, s) if rich_score(m) >= rich_score(s) else (s, m)
                pairs.append((keep["id"], drop["id"], f"简答是选择题副本 sim={sim:.2f}"))

    for e in EXPLICIT:
        pairs.append((e["keep"], e["drop"][0], e["why"]))

    # 去重 + 排除冲突
    # 先按“同一题只能有一个幸存者”合并：成对关系求连通分量，分量内按优先级选唯一保留
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

    for k, d, w in pairs:
        union(k, d)
    comps = {}
    for x in list(parent):
        comps.setdefault(find(x), set()).add(x)
    why_of = {}
    for k, d, w in pairs:
        why_of.setdefault(d, w)

    seen = {}
    for root, ids in comps.items():
        if len(ids) < 2:
            continue
        surv = max(ids, key=lambda i: rich_score(by_id[i]))
        for i in ids:
            if i != surv:
                seen[i] = surv

    why_of = {}
    for k, d, w in pairs:
        why_of.setdefault(d, w)
    print(f"补漏将删 {len(seen)} 条")
    for d, k in list(seen.items())[:20]:
        print(f"  留 {k}｜删 {d}｜{why_of.get(d,'')}｜{by_id[d]['stem'][:46]}")
    if args.apply:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(os.path.dirname(DB), f"memory_palace.before-dedup-residual-{stamp}.db")
        con = sqlite3.connect(DB)
        con.execute("pragma wal_checkpoint(TRUNCATE)")
        con.close()
        shutil.copy2(DB, backup)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        drop = sorted(seen)
        con = sqlite3.connect(DB)
        cur = con.cursor()
        ph = ",".join("?" * len(drop))
        n = cur.execute(f"update palace_quiz_questions set deleted_at=?, updated_at=? where deleted_at is null and id in ({ph})", [now, now, *drop]).rowcount
        con.commit()
        left = cur.execute("select count(*) from palace_quiz_questions where deleted_at is null").fetchone()[0]
        con.close()
        print(f"备份 -> {backup}")
        print(f"软删 {n} 条；题库现存 {left} 题")
        json.dump({"created_at": now, "backup": backup, "drop_ids": drop},
                  open(os.path.join(HERE, f"rollback-residual-{stamp}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
    else:
        print("（干跑，未写库）")


if __name__ == "__main__":
    main()
