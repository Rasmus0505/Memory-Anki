# -*- coding: utf-8 -*-
"""题库去重 第 2 轮：低相似度补充候选（同宫殿 0.55–0.70），排除第一轮已判删的题。"""
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
BATCH2 = os.path.join(HERE, "llm_batches2")
PER_BATCH = 40
LO, HI = 0.55, 0.70

PREFIX = re.compile(r"^【[^】]*】")


def ns(s):
    s = PREFIX.sub("", s or "")
    s = re.sub(r"[\s　]+", "", s)
    return re.sub(r"[，。；:：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)


def ans_text(d):
    opts = {o["id"]: o["text"] for o in json.loads(d["options_json"] or "[]")}
    a = json.loads(d["answer_payload_json"] or "{}")
    ids = a.get("correct_option_ids") or ([a["correct_option_id"]] if a.get("correct_option_id") else [])
    return "".join(opts.get(i, "") for i in ids) or (a.get("reference_answer") or "")


qs = {}
for line in open(os.path.join(HERE, "questions.jsonl"), encoding="utf-8"):
    d = json.loads(line)
    qs[d["id"]] = d

# 第一轮已经判删的题
gone = set()
auto = json.load(open(os.path.join(HERE, "auto_groups.json"), encoding="utf-8"))
for g in auto:
    gone.update(g["drop"])
vd = os.path.join(HERE, "verdicts")
if os.path.isdir(vd):
    for fn in os.listdir(vd):
        if fn.endswith(".json"):
            for v in json.load(open(os.path.join(vd, fn), encoding="utf-8")):
                if v.get("dup"):
                    gone.update(v.get("drop") or [])

alive = [d for d in qs.values() if d["id"] not in gone]
print("第一轮后仍在候选池的题", len(alive), "（已判删", len(gone), "）")

by_palace = defaultdict(list)
for d in alive:
    by_palace[d["palace_id"]].append(d)

parent = {d["id"]: d["id"] for d in alive}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


pairs = 0
for pid, items in by_palace.items():
    texts = [ns(d["stem"]) for d in items]
    ok = [i for i, t in enumerate(texts) if len(t) >= 10]
    if len(ok) < 2:
        continue
    X = normalize(TfidfVectorizer(analyzer="char", ngram_range=(2, 4), sublinear_tf=True).fit_transform([texts[i] for i in ok]))
    S = (X @ X.T).toarray()
    np.fill_diagonal(S, 0)
    ii, jj = np.where(np.triu(S, k=1) >= LO)
    for i, j in zip(ii, jj):
        s = S[i, j]
        if s >= HI:
            continue
        a, b = items[ok[i]], items[ok[j]]
        union(a["id"], b["id"])
        pairs += 1

clusters = defaultdict(list)
for d in alive:
    clusters[find(d["id"])].append(d["id"])
groups = sorted((sorted(v) for v in clusters.values() if len(v) > 1), key=lambda x: -len(x))
print("补充候选对", pairs, "簇", len(groups), "涉及题", sum(len(g) for g in groups))

os.makedirs(BATCH2, exist_ok=True)
for f in os.listdir(BATCH2):
    os.remove(os.path.join(BATCH2, f))
batches = [groups[i:i + PER_BATCH] for i in range(0, len(groups), PER_BATCH)]
for bi, batch in enumerate(batches):
    payload = []
    for gi, ids in enumerate(batch):
        payload.append({
            "g": f"c{bi:02d}-{gi:02d}",
            "ids": ids,
            "qs": [{
                "id": i,
                "科目": qs[i]["subject_name"],
                "宫殿": qs[i]["palace_title"][:20],
                "题型": qs[i]["question_type"],
                "题干": qs[i]["stem"][:400],
                "选项": [f'{o["id"]}.{o["text"]}' for o in json.loads(qs[i]["options_json"] or "[]")][:6],
                "答案": ans_text(qs[i])[:200],
                "作答次数": qs[i]["answered"],
            } for i in ids],
            "原因": ["low_similarity_band"],
        })
    json.dump(payload, open(os.path.join(BATCH2, f"batch-{bi:02d}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("补充批次", len(batches), "->", BATCH2)
