# -*- coding: utf-8 -*-
"""校验模型判定文件：组数/g 对齐、keep/drop 自洽、跨组不冲突。"""
import glob
import json
import os
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.environ.get("DEDUP_WORK") or os.path.dirname(os.path.abspath(__file__))


def check(batch_dir, verdict_dir):
    ok = True
    dropped = Counter()
    kept = set()
    total_dup = total_drop = total_conflict = 0
    for bf in sorted(glob.glob(os.path.join(batch_dir, "batch-*.json"))):
        name = os.path.basename(bf)
        vf = os.path.join(verdict_dir, name)
        if not os.path.exists(vf):
            print(f"缺判定: {name}")
            ok = False
            continue
        src = {g["g"]: g for g in json.load(open(bf, encoding="utf-8"))}
        ver = json.load(open(vf, encoding="utf-8"))
        gs = {v.get("g") for v in ver}
        if gs != set(src):
            print(f"{name}: g 不齐，缺 {sorted(set(src)-gs)[:5]} 多 {sorted(gs-set(src))[:5]}")
            ok = False
        for v in ver:
            if v.get("g") not in src:
                continue
            ids = set(src[v["g"]]["ids"])
            if not v.get("dup"):
                continue
            total_dup += 1
            k = v.get("keep")
            dr = v.get("drop") or []
            if v.get("conflict"):
                total_conflict += 1
                continue
            if k not in ids or not dr or not set(dr) <= ids - {k}:
                print(f"{name} {v['g']}: keep/drop 越界 keep={k} drop={dr} ids={sorted(ids)}")
                ok = False
                continue
            total_drop += len(dr)
            dropped.update(dr)
            kept.add(k)
    dup = [i for i, c in dropped.items() if c > 1]
    clash = sorted(set(dropped) & kept)
    if dup:
        print("同一题被判删多次:", dup[:10])
        ok = False
    if clash:
        print("被判删同时被判保留:", clash[:10])
        ok = False
    print(f"判重组 {total_dup}｜删除 {total_drop}｜conflict {total_conflict}｜自洽 {'OK' if ok else 'FAIL'}")
    return ok


if __name__ == "__main__":
    if len(sys.argv) == 3:
        bd, vd = sys.argv[1], sys.argv[2]
    else:
        bd, vd = os.path.join(HERE, "llm_batches"), os.path.join(HERE, "verdicts")
    sys.exit(0 if check(bd, vd) else 1)
