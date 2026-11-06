# -*- coding: utf-8 -*-
"""题库去重 第 3 步：分拣 + 生成大模型判定批次。

簇分成两类：
  A 机械重复：簇内题干归一化完全相同，且答案文本一致 → 不必问模型，直接留“信息更全”的一条
  B 待判定：题干措辞不同（语义近重复），或同题干但答案不一致 → 交大模型判语义
"""
import json
import os
import sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__))
QS = os.path.join(HERE, "questions.jsonl")
CL = os.path.join(HERE, "clusters.json")
BATCH_DIR = os.path.join(HERE, "llm_batches")
PER_BATCH = 40

q = {}
with open(QS, encoding="utf-8") as f:
    for line in f:
        d = json.loads(line)
        q[d["id"]] = d
clusters = json.load(open(CL, encoding="utf-8"))["clusters"]


def ans_text(d):
    opts = {o["id"]: o["text"] for o in json.loads(d["options_json"] or "[]")}
    a = json.loads(d["answer_payload_json"] or "{}")
    ids = a.get("correct_option_ids") or ([a["correct_option_id"]] if a.get("correct_option_id") else [])
    return "".join(opts.get(i, "") for i in ids) or (a.get("reference_answer") or "")


def rich_score(d):
    """保留优先级：作答记录 > 有解析 > 有选项 > 创建更早。"""
    return (
        d["answered"] > 0,
        bool((d["analysis"] or "").strip()),
        len(json.loads(d["options_json"] or "[]")),
        -d["id"],
    )


auto, need = [], []
for c in clusters:
    ids = c["ids"]
    stems = {q[i]["_ns"] if "_ns" in q[i] else None for i in ids}
    # questions.jsonl 里没有 _ns，这里现场算
    import re
    PREFIX = re.compile(r"^【[^】]*】")
    def ns(s):
        s = PREFIX.sub("", s or "")
        s = re.sub(r"[\s　]+", "", s)
        return re.sub(r"[，。；：、？！,.;:?!\"'“”‘’（）()《》〈〉\[\]【】—\-…·~·]", "", s)
    stems = {ns(q[i]["stem"]) for i in ids}
    ans = {i: ans_text(q[i]) for i in ids}
    ans_norm = {i: re.sub(r"[\s，。；、！？,.;!?（）()《》\"'“”‘’]", "", v) for i, v in ans.items()}
    same_ans = len(set(ans_norm.values())) == 1
    if len(stems) == 1 and same_ans and all(ans_norm.values()):
        best = max(ids, key=lambda i: rich_score(q[i]))
        auto.append({
            "kind": "机械重复",
            "ids": ids,
            "keep": best,
            "drop": [i for i in ids if i != best],
            "note": "题干完全相同、答案一致",
        })
    else:
        need.append(c)

print("机械重复簇", len(auto), "涉及删题", sum(len(a['drop']) for a in auto))
print("待模型判定簇", len(need), "涉及题", sum(len(c['ids']) for c in need))

json.dump(auto, open(os.path.join(HERE, "auto_groups.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# 生成批次
os.makedirs(BATCH_DIR, exist_ok=True)
for f in os.listdir(BATCH_DIR):
    os.remove(os.path.join(BATCH_DIR, f))

batches = [need[i:i + PER_BATCH] for i in range(0, len(need), PER_BATCH)]
for bi, batch in enumerate(batches):
    payload = []
    for gi, c in enumerate(batch):
        payload.append({
            "g": f"b{bi:02d}-{gi:02d}",
            "ids": c["ids"],
            "qs": [
                {
                    "id": i,
                    "科目": q[i]["subject_name"],
                    "宫殿": q[i]["palace_title"][:20],
                    "题型": q[i]["question_type"],
                    "题干": q[i]["stem"][:400],
                    "选项": [f'{o["id"]}.{o["text"]}' for o in json.loads(q[i]["options_json"] or "[]")][:6],
                    "答案": ans_text(q[i])[:200],
                    "作答次数": q[i]["answered"],
                }
                for i in c["ids"]
            ],
            "原因": c["reasons"],
        })
    json.dump(payload, open(os.path.join(BATCH_DIR, f"batch-{bi:02d}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("批次数", len(batches), "->", BATCH_DIR)

cnt = Counter()
for c in need:
    for r in c["reasons"]:
        cnt[r] += 1
print("待判定簇原因分布", dict(cnt))
