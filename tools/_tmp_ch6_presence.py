# -*- coding: utf-8 -*-
import sqlite3
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
snippets = [
    "量力性原则的教育家",
    "开设在村庄的学校",
    "自然人",
    "作为道德教育",
    "女子教育",
    "理性睡眠",
    "算术教学应该从",
    "设置督学",
    "双重理论基础",
    "中间学校",
    "全面发展的基础",
    "没有书本的学校",
    "无所不包的艺术",
    "自然后果法",
    "感性知识开始",
    "综合教学",
    "开创性实践",
    "独立的学科",
    "进化",
    "国家主义教育思潮",
    "内心自由",
    "道德教育最基本的要素",
    "指导性原则",
    "都必须经历的四个阶段",
    "首先提出",
    "都应该进学校",
    "金科玉律",
    "接受的教育分为三类",
    "母育学校比喻",
    "最简单的要素",
    "最简单要素",
    "必要的目的",
    "公共游戏场所",
    "兴趣表现为注意",
    "直观性教学，其依据",
    "直观理性教学",
    "两项基本原则",
    "付诸实践",
    "泛智教育思想",
    "自我教育者",
    "人力完全不能控制",
    "相结合是",
    "联想阶段对应",
    "恩物",
    "幼儿园课程内容",
    "近期的",
    "各方教育力量",
    "要素教育指导",
    "造物主",
    "心、脑、手",
    "发现了儿童",
    "精神生产",
    "自然、物理、化学",
    "幼儿园教育的看法",
    "作业与恩物",
    "所有学科的中心",
    "自然主义教育思潮的发展",
    "前后衔接的三个部分",
    "斥责或鞭",
    "职业选择",
    "消极教育",
    "外部肢体活动",
    "才智屠宰场",
    "无目的",
    "目的—手段",
    "无法控制或决定",
    "趋同",
    "泛智",
    "课程内容选择",
    "幼儿教育思想上的不同",
    "提高到科学的水平",
    "自然后果法",
    "综合技术教育",
    "心理胚胎期",
]
con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
rows = con.execute(
    """
    SELECT id, stem, options_json, answer_payload_json
    FROM palace_quiz_questions
    WHERE deleted_at IS NULL AND palace_id BETWEEN 39 AND 45
    """
).fetchall()
blob = "\n".join((r[1] or "") + "\n" + (r[2] or "") for r in rows)
missing = []
for snippet in snippets:
    if snippet not in blob:
        missing.append(snippet)
print("MISSING SNIPPETS")
for item in missing:
    print(" -", item)
print("active", len(rows))
