# -*- coding: utf-8 -*-
"""题库去重 第 2 步：候选簇。

口径：
  * 只在同一学科内比（跨学科只在“题干归一化完全相同”时也算，单独标记）
  * 题干归一化（去【来源前缀】、去空白标点）后完全相同 → 必然候选
  * char 2-4 gram TF-IDF 余弦 ≥ 0.78 → 候选
  * 选项集合高度重合（同选项、答案相同）→ 候选
用并查集聚成簇，输出 clusters.json。
"""
import json
import os
import re
import sys
from collections import defaultdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__))
QS = os.path.join(HERE, "questions.jsonl")
OUT = os.path.join(HERE, "clusters.json")
SIM = 0.70

PREFIX = re.compile(r"^【[^】]*】")


def norm_stem(s: str) -> str:
    s = PREFIX.sub("", s or "")
    s = re.sub(r"[\s　]+", "", s)
    return re.sub(r"[，。；：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)


def norm_text(s: str) -> str:
    s = re.sub(r"[\s　]+", "", s or "")
    return re.sub(r"[，。；：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)


def answer_text(q) -> str:
    return norm_text(q["_ans"])


def load():
    out = []
    with open(QS, encoding="utf-8") as f:
        for line in f:
            q = json.loads(line)
            q["_ns"] = norm_stem(q["stem"])
            opts = json.loads(q["options_json"] or "[]")
            ans = json.loads(q["answer_payload_json"] or "{}")
            q["_opts"] = {o.get("id"): norm_text(o.get("text", "")) for o in opts}
            q["_optids"] = [o.get("id") for o in opts]
            q["_ans_ids"] = sorted(ans.get("correct_option_ids") or ([ans["correct_option_id"]] if ans.get("correct_option_id") else []))
            q["_ref"] = norm_text(ans.get("reference_answer") or "")
            q["_ans"] = "".join(q["_opts"].get(i, "") for i in q["_ans_ids"]) or q["_ref"]
            out.append(q)
    return out


def main():
    qs = load()
    print("题目", len(qs))
    parent = {q["id"]: q["id"] for q in qs}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_id = {q["id"]: q for q in qs}
    reasons = defaultdict(set)      # cluster key -> reasons
    pair_sims = {}

    # 1) 归一化同题干
    by_stem = defaultdict(list)
    for q in qs:
        by_stem[q["_ns"]].append(q["id"])
    exact = 0
    for stem, ids in by_stem.items():
        if len(ids) > 1:
            exact += 1
            for other in ids[1:]:
                union(ids[0], other)
            for i in ids:
                reasons[i].add("exact_stem")

    # 2) 相似度（同科目分块）
    by_subject = defaultdict(list)
    for q in qs:
        by_subject[q["subject_id"]].append(q)
    near = 0
    for sid, items in by_subject.items():
        texts = [q["_ns"] for q in items]
        ok = [i for i, t in enumerate(texts) if len(t) >= 8]
        if len(ok) < 2:
            continue
        idx_items = [items[i] for i in ok]
        texts = [texts[i] for i in ok]
        X = normalize(TfidfVectorizer(analyzer="char", ngram_range=(2, 4), sublinear_tf=True).fit_transform(texts))
        S = (X @ X.T).toarray()
        np.fill_diagonal(S, 0)
        ii, jj = np.where(np.triu(S, k=1) >= SIM)
        for i, j in zip(ii, jj):
            a, b = idx_items[i], idx_items[j]
            union(a["id"], b["id"])
            near += 1
            reasons[a["id"]].add("near_stem")
            reasons[b["id"]].add("near_stem")
            pair_sims[(min(a["id"], b["id"]), max(a["id"], b["id"]))] = round(float(S[i, j]), 4)

    # 3) 选项集合相同 + 答案相同（题型都为选择题）
    by_opt = defaultdict(list)
    for q in qs:
        if len(q["_opts"]) >= 3 and q["_ans_ids"]:
            key = "|".join(sorted(q["_opts"].values())) + "#" + ",".join(q["_ans_ids"])
            by_opt[key].append(q["id"])
    for key, ids in by_opt.items():
        if len(ids) > 1:
            for other in ids[1:]:
                union(ids[0], other)
            for i in ids:
                reasons[i].add("same_options_answer")

    clusters = defaultdict(list)
    for q in qs:
        clusters[find(q["id"])].append(q["id"])

    out = []
    for root, ids in clusters.items():
        if len(ids) < 2:
            continue
        members = sorted(ids)
        rs = sorted({r for i in members for r in reasons.get(i, ())})
        out.append({"ids": members, "reasons": rs})
    out.sort(key=lambda c: -len(c["ids"]))

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"clusters": out, "pair_sims": {f"{k[0]}-{k[1]}": v for k, v in pair_sims.items()}}, f, ensure_ascii=False, indent=1)

    sizes = defaultdict(int)
    for c in out:
        sizes[len(c["ids"])] += 1
    print("候选簇", len(out), "覆盖题目", sum(len(c["ids"]) for c in out))
    print("簇大小分布", dict(sorted(sizes.items())))
    print("完全同题干组", exact, "近重复对", near)


if __name__ == "__main__":
    main()
