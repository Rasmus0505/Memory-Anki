# -*- coding: utf-8 -*-
"""修正「源标签写单选、却存了多个正确答案」的 13 道肖 1000 题。

这些题导入时 correct_option_id 被默认写成 A，真正的答案塞进了 correct_option_ids，
导致按集合判分时永远答不对。逐题按解析与知识点判定唯一正确答案。

用法：python fix_single_choice.py [--apply]
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
DB = os.environ.get("MEMORY_ANKI_DB", r"C:\MemoryAnki\memory anki data\学习数据\memory_palace.db")

# id -> (正确答案, 依据)
FIXES = {
    11574: ("B", "劳动生产率=劳动者生产使用价值的效率"),
    11661: ("A", "金融资本通过金融联系、资本参与、人事参与形成"),
    11664: ("C", "国家垄断资本主义实质=私人垄断资本利用国家机器"),
    11875: ("B", "政治生活主题=正确处理人民内部矛盾"),
    11893: ("B", "右倾错误=二次革命论"),
    11898: ("C", "民族的（内容）=反对帝国主义压迫、民族尊严独立"),
    11946: ("D", "四个自信说到底=文化自信"),
    11985: ("B", "高质量发展战略基点=构建新发展格局（解析明说选 B）"),
    12141: ("C", "整风最主要任务=反对主观主义整顿学风"),
    12142: ("D", "抗战完全胜利标志=台湾及澎湖列岛回归"),
    12171: ("A", "民主革命遗留任务=新解放区土改"),
    12173: ("D", "社会主义性质形式=全行业公私合营"),
    12222: ("B", "三湾改编确立支部建在连上"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.apply:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(os.path.dirname(DB), f"memory_palace.before-single-choice-fix-{stamp}.db")
        tmp = sqlite3.connect(DB)
        tmp.execute("pragma wal_checkpoint(TRUNCATE)")
        tmp.close()
        shutil.copy2(DB, backup)
        print("备份 ->", backup)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    ok = 0
    for qid, (ans, why) in FIXES.items():
        r = cur.execute(
            "select id,stem,options_json,answer_payload_json,deleted_at from palace_quiz_questions where id=?",
            (qid,),
        ).fetchone()
        if r is None or r["deleted_at"] is not None:
            print(f"  跳过 {qid}：不存在或已删")
            continue
        opts = {o["id"] for o in json.loads(r["options_json"] or "[]")}
        if ans not in opts:
            print(f"  跳过 {qid}：选项里没有 {ans}")
            continue
        old = json.loads(r["answer_payload_json"] or "{}")
        print(f"  {qid}: {old.get('correct_option_ids') or old.get('correct_option_id')} -> {ans}｜{why}")
        if args.apply:
            cur.execute(
                "update palace_quiz_questions set answer_payload_json=?, updated_at=? where id=?",
                (json.dumps({"correct_option_id": ans}, ensure_ascii=False), now, qid),
            )
        ok += 1

    if args.apply:
        con.commit()
        left = cur.execute(
            """select count(*) from palace_quiz_questions
               where deleted_at is null and question_type='multiple_choice'
                 and json_extract(answer_payload_json,'$.correct_option_ids') is not null
                 and substr(stem,1,instr(stem,'】')) like '%单选%'"""
        ).fetchone()[0]
        print(f"已修 {ok} 道；仍存疑 {left} 道")
    else:
        print(f"\n干跑：将修 {ok} 道（未写库）")
    con.close()


if __name__ == "__main__":
    main()
