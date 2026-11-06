# -*- coding: utf-8 -*-
"""清理选项/题干尾部粘着的下一题文字、页码与题型标签（OCR 分页错位）。

只做高置信度的四件事：
  1. 去掉「（接第 …）」这类跨页提示
  2. 从「页码,下一题开头」处截断（选项里）
  3. 去掉尾部的「页码 科目，题型」标签（可重复出现）
  4. 去掉紧贴汉字末尾的 2-3 位页码

题干只处理显式清单（3 道），不做通用截断——材料题里本来就有「材料 1，」这种写法。

默认干跑；--apply 先备份整库。
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.environ.get("MEMORY_ANKI_DB", r"C:\MemoryAnki\memory anki data\学习数据\memory_palace.db")

CJK = r"\u4e00-\u9fa5"
PAREN_CROSSPAGE = re.compile(r"[（(]\s*接第[^）)]*[）)]")
GLUED_NEXT = re.compile(rf"\s+\d{{1,3}}\s*[,，、]\s*(?=[{CJK}“\"(（])")
# 题型标签必须带分隔符或页码，避免把「具体问题具体分析」这类正常选项当标签
TAIL_LABEL = re.compile(rf"\s+(?:\d{{1,3}}\s*)?[，,、\-·]\s*(?:[{CJK}]{{0,8}}\s*[，,、\-·]\s*)?(单选|多选|分析)\s*$|\s+\d{{1,3}}\s*[{CJK}]{{0,8}}\s*[，,、\-·]\s*(单选|多选|分析)\s*$")
TAIL_PAGE = re.compile(rf"(?<=[{CJK}])(\d{{2,3}})$")
MIN_OPT_LEN = 2
# 选项里粘进下一题的选项标记（如「…科学依据 D、剩余价值全部是…」）
NEXT_OPTION = re.compile(rf"\s+[A-D][、.．]\s*(?=[{CJK}])")
# 末尾粘「思法·单选」这类不带前置分隔符的标签
TAIL_LABEL2 = re.compile(rf"\s+[{CJK}]{{0,6}}[·\-]\s*(单选|多选|分析)\s*$")

# 通用规则够不到的个别选项：显式给出清洗后的文本（逐条核对过）
EXPLICIT_OPTIONS = {
    11497: {"D": "人工智能不仅可以模拟，而且能够扩展人脑的某些活动"},
    11585: {"D": "利润转化为平均利润"},
    11755: {"D": "社会意识具有相对独立性"},
    11872: {"D": "《关于正确处理人民内部矛盾的问题》"},
    12056: {"D": "坚持统筹推进国内法治和涉外法治"},
    12087: {"D": "决定党的事业成败和国家命运兴衰"},
    12126: {"D": "为实现中华民族伟大复兴提供充满新的活力的体制保证和快速发展的物质条件"},
    12209: {"D": "国际上苏联、美国等都表示希望中国能够实行和平建国"},
}

STEM_CUTS = {
    11598: " 19 马原，单选",
    11646: " 49 马原，多选",
    12518: "\n毛中特，分析",
}


def clean_option(text: str):
    t = text
    t = PAREN_CROSSPAGE.sub("", t)
    m = GLUED_NEXT.search(t)
    if m:
        t = t[: m.start()]
    m = NEXT_OPTION.search(t)
    if m and m.start() > 2:
        t = t[: m.start()]
    for _ in range(4):
        new = TAIL_LABEL2.sub("", TAIL_LABEL.sub("", t))
        if new == t:
            break
        t = new
    m = TAIL_PAGE.search(t)
    if m and 20 <= int(m.group(1)) <= 400:
        t = t[: m.start()]
    return t.strip(), t.strip() != text.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    rows = cur.execute("select id,stem,options_json from palace_quiz_questions where deleted_at is null").fetchall()

    changes, bad = [], []
    for r in rows:
        stem = r["stem"] or ""
        new_stem = stem
        for qid, marker in STEM_CUTS.items():
            if r["id"] == qid and marker in new_stem:
                new_stem = new_stem[: new_stem.index(marker)].rstrip()

        opts = json.loads(r["options_json"] or "[]")
        new_opts, opt_changed = [], False
        explicit = EXPLICIT_OPTIONS.get(r["id"], {})
        for o in opts:
            if o["id"] in explicit:
                t, ch = explicit[o["id"]], True
            else:
                t, ch = clean_option(o.get("text", ""))
            if ch:
                opt_changed = True
                if len(t) < MIN_OPT_LEN:
                    bad.append((r["id"], o["id"], o.get("text", ""), t))
                new_opts.append({**o, "text": t})
            else:
                new_opts.append(o)

        if new_stem != stem or opt_changed:
            changes.append({
                "id": r["id"], "stem_before": stem, "stem_after": new_stem,
                "opts_before": opts, "opts_after": new_opts,
            })

    print(f"将清理 {len(changes)} 道；可疑（清洗后过短）{len(bad)} 处")
    for c in changes:
        if c["stem_before"] != c["stem_after"]:
            print(f"\n--- {c['id']} 题干")
            print("  前:", repr(c["stem_before"][-70:]))
            print("  后:", repr(c["stem_after"][-70:]))
        for a, b in zip(c["opts_before"], c["opts_after"]):
            if a != b:
                print(f"--- {c['id']} 选项{a['id']}")
                print("  前:", repr(a["text"][:100]))
                print("  后:", repr(b["text"][:100]))
    for b in bad:
        print("!! 过短:", b)

    json.dump(changes, open(os.path.join(HERE, "ocr-clean-plan.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    if not args.apply:
        print("\n（干跑，未写库）")
        con.close()
        return
    if bad:
        print("有可疑清洗结果，拒绝写入。")
        con.close()
        return

    con.close()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(os.path.dirname(DB), f"memory_palace.before-ocr-clean-{stamp}.db")
    tmp = sqlite3.connect(DB)
    tmp.execute("pragma wal_checkpoint(TRUNCATE)")
    tmp.close()
    shutil.copy2(DB, backup)
    print("备份 ->", backup)

    con = sqlite3.connect(DB)
    cur = con.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for c in changes:
        cur.execute("update palace_quiz_questions set stem=?, options_json=?, updated_at=? where id=?",
                    (c["stem_after"], json.dumps(c["opts_after"], ensure_ascii=False), now, c["id"]))
    con.commit()
    print(f"已清理 {len(changes)} 道")
    con.close()


if __name__ == "__main__":
    main()
