# -*- coding: utf-8 -*-
"""处理 7 组「同题两套答案」：逐组核对后修答案或删重复。

逐组结论：
  b03-11  10419/10923/12249 三题答案都正确，正确选项考的是不同事实（论战意义 / 2023 真题 /
          肖 1000 论战内容），不算同一道题 → 不动。
  b08-25  10794 答案 BCD 错：C「事物运动的主观联想」是唯心主义，解析原文也说该选不该选，
          正确为 ABD（A 测量尺度、B 存在形式、D 不可分割）。解析里「选项 A 表述错误」
          是导入错位，应为「选项 C」。9498 是同一道题且答案正确 → 保留 10794（真题+解析），
          软删 9498。
  b09-38  10027 答案 ABD 漏了 C：解析自己把「确保锚定奋斗目标行稳致远」列为正确，
          四项均对 → 改为 ABCD。11978 答案 ABCD 本来就对，两题选项集合不同 → 都保留。
  b10-28  10514 与 10910 答案都是 C，但正确项内容不同（东方主战场 / 进入全民族抗战阶段），
          两句话都对 → 都保留。
  b10-35  10556 与 12203 答案都是 A，正确项内容不同（确立新型政党制度 / 中共居于领导地位），
          都对 → 都保留。
  b11-16  12467 的 D「思想道德和法律在调节领域上保持完全一致」是错的（法治与德治调整范围不同），
          正确为 ABC；它与 10750 同题，10750 答案 ABCD 正确 → 软删 12467。10778 是另一题，不动。
  b01-18  5014 正确（教育性教学 = 掌握知识与进行教育相统一）；5245 的选项里根本没有正确项
          （它把 C 写成「教学是知、情、意统一的过程」）→ 软删 5245。

用法：python fix_conflicts.py [--apply]
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from _local_db import resolve_db_path

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
DB = str(resolve_db_path())

ANSWER_FIXES = [
    {"id": 10794, "ids": ["A", "B", "D"], "why": "C「主观联想」唯心，正确答案 ABD"},
    {"id": 10027, "ids": ["A", "B", "C", "D"], "why": "解析列了四项都对，原答案漏 C"},
]

ANALYSIS_FIXES = [
    {"id": 10794, "old": "因此选项 A 表述错误", "new": "因此选项 C 表述错误"},
    {"id": 10794, "old": "因此，正确答案是 BCD", "new": "因此，正确答案是 ABD"},
]

DELETES = [
    {"id": 9498, "keep": 10794, "why": "同题同答案，保留带解析的 2022 真题"},
    {"id": 12467, "keep": 10750, "why": "同题，D 项错误；10750 答案正确"},
    {"id": 5245, "keep": 5014, "why": "选项里没有正确项（教育性教学≠知情意统一）"},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.apply:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(os.path.dirname(DB), f"memory_palace.before-conflict-fix-{stamp}.db")
        tmp = sqlite3.connect(DB)
        tmp.execute("pragma wal_checkpoint(TRUNCATE)")
        tmp.close()
        shutil.copy2(DB, backup)
        print("备份 ->", backup)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    print("== 答案修正 ==")
    for f in ANSWER_FIXES:
        r = cur.execute("select id,answer_payload_json,deleted_at from palace_quiz_questions where id=?", (f["id"],)).fetchone()
        if r is None or r["deleted_at"] is not None:
            print(f"  跳过 {f['id']}：不存在或已删")
            continue
        old = json.loads(r["answer_payload_json"] or "{}")
        new = {"correct_option_id": f["ids"][0], "correct_option_ids": f["ids"]}
        print(f"  {f['id']}: {old.get('correct_option_ids') or old.get('correct_option_id')} -> {f['ids']}  ({f['why']})")
        if args.apply:
            cur.execute("update palace_quiz_questions set answer_payload_json=?, updated_at=? where id=?",
                        (json.dumps(new, ensure_ascii=False), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), f["id"]))

    print("\n== 解析修正 ==")
    for f in ANALYSIS_FIXES:
        r = cur.execute("select id,analysis from palace_quiz_questions where id=?", (f["id"],)).fetchone()
        if r is None:
            continue
        a = r["analysis"] or ""
        if f["old"] not in a:
            print(f"  跳过 {f['id']}：没找到原文「{f['old']}」")
            continue
        print(f"  {f['id']}: 「{f['old']}」-> 「{f['new']}」")
        if args.apply:
            cur.execute("update palace_quiz_questions set analysis=?, updated_at=? where id=?",
                        (a.replace(f["old"], f["new"], 1), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), f["id"]))

    print("\n== 软删 ==")
    for d in DELETES:
        r = cur.execute("select id,stem,deleted_at from palace_quiz_questions where id=?", (d["id"],)).fetchone()
        if r is None:
            print(f"  跳过 {d['id']}：不存在")
            continue
        if r["deleted_at"] is not None:
            print(f"  跳过 {d['id']}：已删")
            continue
        print(f"  删 {d['id']}（保留 {d['keep']}）：{r['stem'][:46]}  —— {d['why']}")
        if args.apply:
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cur.execute("update palace_quiz_questions set deleted_at=?, updated_at=? where id=?", (now, now, d["id"]))

    if not args.apply:
        print("\n（干跑，未写库）")
        con.close()
        return

    con.commit()
    # 复核
    print("\n== 复核 ==")
    for f in ANSWER_FIXES:
        v = cur.execute("select answer_payload_json from palace_quiz_questions where id=?", (f["id"],)).fetchone()[0]
        print(f"  {f['id']} 答案 = {v}")
    for d in DELETES:
        v = cur.execute("select deleted_at from palace_quiz_questions where id=?", (d["id"],)).fetchone()[0]
        print(f"  {d['id']} deleted_at = {v}")
    print("  在世题数 =", cur.execute("select count(*) from palace_quiz_questions where deleted_at is null").fetchone()[0])
    con.close()


if __name__ == "__main__":
    main()
