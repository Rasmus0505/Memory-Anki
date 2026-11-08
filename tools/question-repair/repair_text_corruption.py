# -*- coding: utf-8 -*-
"""修复题库与宫殿脑图里的 OCR / 字体编码乱码。

两类问题：
  1. 题目解析里的 Latin-1 乱码（如 ``ìîíïïïï``），是 PDF 树形图连字符被错误解码；
  2. 选项尾部粘着表格框线（``┐`` / ``│`` / ``┘``），以及页码、漏字等 OCR 残渣。

只处理脚本里逐条核对过的 id，不做猜测式批量替换。默认干跑；
``--apply`` 会先 checkpoint 并整库备份，再写库。

用法：
    python tools/question-repair/repair_text_corruption.py
    python tools/question-repair/repair_text_corruption.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_db_path() -> Path:
    override = os.environ.get("MEMORY_ANKI_DB")
    if override:
        return Path(override).expanduser()
    api_src = REPO_ROOT / "apps" / "api" / "src"
    if str(api_src) not in sys.path:
        sys.path.insert(0, str(api_src))
    from memory_anki.core.local_config import load_local_runtime_config

    config = load_local_runtime_config(repo_root=REPO_ROOT)
    return config.local_app_home / "学习数据" / "memory_palace.db"


DB = resolve_db_path()

# 逐条核对过的解析改写：id -> 新解析。只用于表格/知识树被 OCR 压平、读不出层级的题。
ANALYSIS_REWRITES: dict[int, str] = {
    7372: (
        "理解题 此题考查科尔伯格的道德发展阶段理论。科尔伯格三水平六阶段如下：\n"
        "前习俗水平（道德观念是纯外在的，为了免受惩罚或获得奖励）\n"
        "- 阶段一：惩罚和服从的定向阶段——缺乏是非善恶观念，因恐惧惩罚而服从规范\n"
        "- 阶段二：工具性的相对主义定向阶段——对自己有利就好，对自己不利就是不好\n"
        "习俗水平（认识到团体的行为规范，进而接受并付诸实践）\n"
        "- 阶段三：人际协调的定向阶段（“好孩子”定向阶段）——按照“好孩子”的要求去做，以得到赞许\n"
        "- 阶段四：维护权威或秩序的定向阶段——维护社会秩序，承担社会的义务和职责\n"
        "后习俗水平（完全自律，内化自我价值）\n"
        "- 阶段五：社会契约定向阶段——有责任心与义务感，尊重法制，认为法制不适应社会时理应修正\n"
        "- 阶段六：普遍道德原则的定向阶段——有独立的价值标准，更多地考虑道德的本质，而非具体的原则\n"
        "评价：优点：①从理论上，揭示儿童道德发展规律，加强德育的实效性。②从实践上，创造了新的德育方式（道德两难故事法和公正团体法）。局限：①研究样本的普遍性不足。②对研究阶段有质疑。③过度强调道德认知推理，忽视道德发展的其他特性。\n"
        "题干中，小明是因为害怕受惩罚，所以认为偷东西不对。小明的道德认知发展阶段处于前习俗水平。该时期儿童的道德观念是纯外在的，儿童是为了免受惩罚而顺从权威人物规定的行为准则。因此，答案选A。"
    ),
    7382: (
        "理解题 此题考查认知方式的差异。\n"
        "按“人在知觉时是否受环境信息的影响”分：\n"
        "- 场独立型：独立对事物做出判断，不易受外来因素的影响\n"
        "- 场依存型：对事物做出判断时容易受周围人特别是权威人士的影响\n"
        "按“认知速度”分：\n"
        "- 沉思型：解决问题时往往强调准确性而非速度。速度慢，但准确性高\n"
        "- 冲动型：解决问题时往往强调速度而非准确性。速度快，但缺乏一定的准确性\n"
        "按“认知策略选择”分：\n"
        "- 分析型（发散型）：个人的思维沿着不同的方向扩展，使观念发散到各个有关方面，最终产生多种可能的答案而不是唯一正确的答案\n"
        "- 综合型（辐合型）：个体在解决问题过程中，常表现为搜集、综合信息与知识，运用逻辑规律缩小解答范围，直至找到最适当的唯一正确的答案\n"
        "内控型与外控型：是罗特在动机理论中关于成败归因的分类。因此，答案选C。"
    ),
    8224: (
        "理解题 此题考查目标定向理论。\n"
        "学习目标定向的个体：\n"
        "- 学习是为了提高能力\n"
        "- 能力可随着学习而提高\n"
        "- 喜欢挑战\n"
        "- 坚持性好，不怕困难\n"
        "- 用是否进步来评价学习效果\n"
        "- 将成败归因于努力程度\n"
        "- 控制感强\n"
        "- 自尊感稳定\n"
        "成绩目标定向的个体：\n"
        "- 学习是为了表现能力\n"
        "- 能力不会随着学习而改变\n"
        "- 避免挑战\n"
        "- 坚持性差，遇到困难就退缩\n"
        "- 用是否比别人强来评价学习效果\n"
        "- 将成败归因于能力或运气\n"
        "- 控制感弱\n"
        "- 条件性自尊感\n"
        "题干中，“认为学业求助会对自我价值构成威胁的学生”是典型的成绩目标定向者，因为他的学习不是为了完成任务、解决问题，而是为了表现自己拥有这样的能力，他的自尊感是带有条件性的，遇到困难就会因担心别人说他能力不好而退缩。因此，答案选D。提示：学习目标定向＝掌握目标定向＝任务目标定向＝任务卷入型；表现目标定向＝成绩目标定向＝成绩卷入型。"
    ),
    8226: (
        "理解题 此题考查目标定向理论。\n"
        "学习目标定向（掌握目标定向、任务卷入目标定向）：\n"
        "- 把注意力集中在对任务的把握和理解上，将失败看作寻求解决问题的方法和达到特定目标的有效途径\n"
        "- 面对困难时坚持性强，不会退缩\n"
        "成绩目标定向（表现目标定向）：\n"
        "- 有向他人展示自己才智和能力的意愿，但极力回避或逃避那些可能失败或会表现出自己低能的情境\n"
        "- ①遇到困难之后选择放弃，叫作逃避表现目标取向。②预想到即将遇到的困难就已经退缩，叫作回避表现困难\n"
        "题干中的学生多次失败后选择放弃，就是表现目标取向中的逃避表现目标取向的情况。因此，答案选D。"
    ),
    8482: (
        "理解题 此题考查心智技能的特点。\n"
        "含义：\n"
        "- 操作技能：一系列外部动作以合理的程序组成的操作活动方式（如骑车、做体操、书写等）\n"
        "- 心智技能：借助于内部言语在人脑中进行的认知活动方式（如默读、心算、写作、观察、分析等）\n"
        "区别：\n"
        "- 动作对象：操作技能—物质性（物质的、具体的）；心智技能—观念性（主观性、抽象性）\n"
        "- 动作执行：操作技能—外显性（外显性的肌体运动）；心智技能—内潜性（内部语言）\n"
        "- 动作结构：操作技能—展开性（不可合并、省略）；心智技能—简缩性（可以合并、省略和简缩）\n"
        "联系：相辅相成、相互制约、相互促进。①操作技能是心智技能形成的最初依据和外部体现的标志（外部动作→脱离→内部言语）。②心智技能是操作技能的调节者和必要组成部分（复杂操作，如打字需要手脑并用）。\n"
        "依据上表可知，心智技能区别于运动技能的主要特点是观念性、内潜性和简缩性。因此，答案选D。"
    ),
}

# 解析里的定点替换：id -> [(旧串, 新串)]
ANALYSIS_REPLACEMENTS: dict[int, list[tuple[str, str]]] = {
    # 页码 66 粘进了「北京是亚洲的城市」
    7352: [("北京是亚洲的66城市", "北京是亚洲的城市")],
    # 原文为「4 人合作学习小组」，OCR 漏掉「5」后留下「4人或人」
    4978: [("形成若干个4人或人合作学习小组", "形成若干个4人合作学习小组")],
}

# 选项尾部粘着表格框线的题：逐题削掉行尾的框线符号
OPTION_TRAILING_GLYPHS: dict[int, str] = {
    10838: "┐│┘",
}

# 脑图节点名称乱码：pegs.id -> (旧串, 新串)
PEG_NAME_FIXES: dict[int, tuple[str, str]] = {
    80627: ("在面对有关国家、社会、���人的政策议题时", "在面对有关国家、社会、个人的政策议题时"),
    81065: ("即掌握扎实的专业知识、科学的态��与精神", "即掌握扎实的专业知识、科学的态度与精神"),
}

# 宫殿 editor_doc / 版本快照里的同一批乱码：palace_id -> [(旧串, 新串)]
PALACE_DOC_FIXES: dict[int, list[tuple[str, str]]] = {
    261: [("国家、社会、���人的政策议题时", "国家、社会、个人的政策议题时")],
    262: [("科学的态��与精神", "科学的态度与精神")],
}

# 用于收尾自检：这些字符出现在活跃题里就说明还有同类乱码
BAD_SIGNATURE = re.compile(r"[À-ÖØ-öø-ÿ-�]|[│├└─┌┐┘┬┴┼]")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def plan_question_changes(con: sqlite3.Connection) -> list[dict]:
    """返回将要写入的题目变更（不写库）。"""
    con.row_factory = sqlite3.Row
    changes: list[dict] = []

    for qid, new_analysis in ANALYSIS_REWRITES.items():
        row = con.execute(
            "select id,analysis from palace_quiz_questions where id=? and deleted_at is null",
            (qid,),
        ).fetchone()
        if row and row["analysis"] != new_analysis:
            changes.append({"id": qid, "field": "analysis", "before": row["analysis"], "after": new_analysis})

    for qid, pairs in ANALYSIS_REPLACEMENTS.items():
        row = con.execute(
            "select id,analysis from palace_quiz_questions where id=? and deleted_at is null",
            (qid,),
        ).fetchone()
        if not row:
            continue
        text = row["analysis"] or ""
        new_text = text
        for old, new in pairs:
            new_text = new_text.replace(old, new)
        if new_text != text:
            changes.append({"id": qid, "field": "analysis", "before": text, "after": new_text})

    for qid, glyphs in OPTION_TRAILING_GLYPHS.items():
        row = con.execute(
            "select id,options_json from palace_quiz_questions where id=? and deleted_at is null",
            (qid,),
        ).fetchone()
        if not row:
            continue
        options = json.loads(row["options_json"] or "[]")
        changed = False
        new_options = []
        for option in options:
            text = option.get("text", "")
            new_text = text.rstrip().rstrip(glyphs).rstrip()
            if new_text != text:
                changed = True
            new_options.append({**option, "text": new_text})
        if changed:
            changes.append({
                "id": qid,
                "field": "options_json",
                "before": row["options_json"],
                "after": json.dumps(new_options, ensure_ascii=False),
            })

    return changes


def plan_mindmap_changes(con: sqlite3.Connection) -> list[dict]:
    """返回 pegs / editor_doc / 版本快照的变更。"""
    con.row_factory = sqlite3.Row
    changes: list[dict] = []

    for peg_id, (old, new) in PEG_NAME_FIXES.items():
        row = con.execute("select id,name from pegs where id=?", (peg_id,)).fetchone()
        if row and old in (row["name"] or ""):
            changes.append({
                "table": "pegs", "id": peg_id, "field": "name",
                "before": row["name"], "after": row["name"].replace(old, new),
            })

    for palace_id, pairs in PALACE_DOC_FIXES.items():
        row = con.execute(
            "select id,editor_doc from palaces where id=? and deleted_at is null", (palace_id,)
        ).fetchone()
        if row:
            old_doc = row["editor_doc"] or ""
            new_doc = old_doc
            for old, new in pairs:
                new_doc = new_doc.replace(old, new)
            if new_doc != old_doc:
                json.loads(new_doc)  # 结构必须仍然是合法 JSON
                changes.append({
                    "table": "palaces", "id": palace_id, "field": "editor_doc",
                    "before": old_doc, "after": new_doc,
                })

        versions = con.execute(
            "select id,editor_doc,peg_snapshot from palace_versions where palace_id=?",
            (palace_id,),
        ).fetchall()
        for version in versions:
            for field in ("editor_doc", "peg_snapshot"):
                old_text = version[field] or ""
                new_text = old_text
                for old, new in pairs:
                    new_text = new_text.replace(old, new)
                if new_text != old_text:
                    if field == "editor_doc":
                        json.loads(new_text)
                    changes.append({
                        "table": "palace_versions", "id": version["id"], "field": field,
                        "before": old_text, "after": new_text,
                    })

    return changes


def audit_active_questions(con: sqlite3.Connection) -> list[tuple]:
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "select id,palace_id,stem,options_json,analysis from palace_quiz_questions where deleted_at is null"
    ).fetchall()
    issues = []
    for row in rows:
        for field in ("stem", "options_json", "analysis"):
            text = row[field] or ""
            match = BAD_SIGNATURE.search(text)
            if match:
                issues.append((row["id"], row["palace_id"], field, match.group()))
    return issues


def apply_changes(con: sqlite3.Connection, question_changes: list[dict], mindmap_changes: list[dict]) -> None:
    now = _now()
    cur = con.cursor()
    for change in question_changes:
        cur.execute(
            f"update palace_quiz_questions set {change['field']}=?, updated_at=? where id=?",
            (change["after"], now, change["id"]),
        )
    for change in mindmap_changes:
        if change["table"] == "pegs":
            cur.execute("update pegs set name=? where id=?", (change["after"], change["id"]))
        elif change["table"] == "palaces":
            cur.execute(
                "update palaces set editor_doc=?, updated_at=? where id=?",
                (change["after"], now, change["id"]),
            )
        elif change["table"] == "palace_versions":
            cur.execute(
                f"update palace_versions set {change['field']}=? where id=?",
                (change["after"], change["id"]),
            )
    con.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="写库；默认只干跑")
    args = parser.parse_args()

    if not DB.exists():
        raise SystemExit(f"数据库不存在：{DB}")

    con = sqlite3.connect(DB)
    try:
        question_changes = plan_question_changes(con)
        mindmap_changes = plan_mindmap_changes(con)

        print(f"数据库：{DB}")
        print(f"题目变更 {len(question_changes)} 处，脑图变更 {len(mindmap_changes)} 处")
        for change in question_changes:
            print("-" * 70)
            print(f"q{change['id']} {change['field']}")
            print("  前:", repr(change["before"][:220]))
            print("  后:", repr(change["after"][:220]))
        for change in mindmap_changes:
            print("-" * 70)
            print(f"{change['table']}#{change['id']} {change['field']}")
            print("  前:", repr(change["before"][:160]))
            print("  后:", repr(change["after"][:160]))

        remaining = audit_active_questions(con)
        print(f"\n活跃题目同类乱码自检：{len(remaining)} 处")
        for item in remaining[:20]:
            print("  !", item)

        if not args.apply:
            print("\n（干跑，未写库）")
            return
        if not question_changes and not mindmap_changes:
            print("没有需要写入的变更。")
            return

        con.execute("pragma wal_checkpoint(TRUNCATE)")
        con.close()

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = DB.with_name(f"memory_palace.before-text-repair-{stamp}.db")
        shutil.copy2(DB, backup)
        print("备份 ->", backup)

        con = sqlite3.connect(DB)
        apply_changes(con, question_changes, mindmap_changes)
        print(f"已写入：题目 {len(question_changes)} 处，脑图 {len(mindmap_changes)} 处")

        remaining = audit_active_questions(con)
        print(f"写入后活跃题目同类乱码：{len(remaining)} 处")
        for item in remaining[:20]:
            print("  !", item)
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
