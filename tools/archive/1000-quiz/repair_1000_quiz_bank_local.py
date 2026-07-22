from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

DEFAULT_SOURCE_ROOT = Path(r"D:\考研（丹丹）\1000题")
DEFAULT_DB = Path(r"D:\BaiduSyncdisk\MemoryAnki-Sync\app-home\data\memory_palace.db")
DEFAULT_WORK_ROOT = REPO_ROOT / ".audit" / "1000-quiz-local-repair"

REPAIR_BATCH = "1000-quiz-local-repair-20260706"
OPTION_RE = re.compile(r"^\s*([A-D])\s*[.．、。]\s*(.+)$", re.I)
INLINE_OPTION_RE = re.compile(r"([A-D])\s*[.．、。]\s*", re.I)
QUESTION_START_RE = re.compile(r"^\s*(\d{1,3})\s*[.．、]\s*(.*)$")
ANSWER_START_RE = re.compile(r"^\s*(\d{1,3})\s*[.．、]?\s*[【\[]?\s*答案\s*[】\]]?\s*[:：]?\s*([A-D]*)\s*(.*)$", re.I)
ANSWER_INLINE_RE = re.compile(r"[【\[]?\s*答案\s*[】\]]?\s*[:：]?\s*([A-D])", re.I)
YEAR_TAG_RE = re.compile(r"【\s*\d{4}\s*年?\s*311\s*真题\s*\d*\s*】")
QUESTION_TYPE_LABELS = {
    "单项选择题": "multiple_choice",
    "多项选择题": "multiple_choice",
    "选择题": "multiple_choice",
    "简答题": "short_answer",
    "辨析题": "short_answer",
    "论述题": "short_answer",
    "材料分析题": "short_answer",
    "分析论述题": "short_answer",
}


CURRENT_PALACE_RULES: dict[int, dict[str, Any]] = {
    # 中国教育史：当前数据库只建了第八至第十章的宫殿。
    2: {"subject": "zhongjiao", "chapter_id": 7, "pages": {18, 19}, "keywords": ["蔡元培", "大学院", "大学区", "五育", "思想自由", "兼容并包"]},
    4: {"subject": "zhongjiao", "chapter_id": 8, "pages": {19, 20, 21}, "keywords": ["新文化", "五四", "平民教育", "工读", "教育独立", "职业教育", "科学教育"]},
    6: {"subject": "zhongjiao", "chapter_id": 9, "pages": {21, 22}, "keywords": ["收回教育权", "教会教育", "教会学校", "本土化", "世俗化"]},
    7: {"subject": "zhongjiao", "chapter_id": 11, "pages": {22, 23}, "keywords": ["国民政府", "抗日战争", "训育", "戊辰学制", "西南联合大学", "中学教育"]},
    8: {"subject": "zhongjiao", "chapter_id": 12, "pages": {23}, "keywords": ["共产党", "革命根据地", "抗日根据地", "苏区", "干部教育", "群众教育", "陕北公学"]},
    9: {"subject": "zhongjiao", "chapter_id": 14, "pages": {24}, "keywords": ["杨贤江", "新教育大纲", "全人生指导", "青年"]},
    10: {"subject": "zhongjiao", "chapter_id": 19, "pages": {24, 25}, "keywords": ["黄炎培", "职业教育", "大职业教育主义", "敬业乐群"]},
    11: {"subject": "zhongjiao", "chapter_id": 22, "pages": {25}, "keywords": ["晏阳初", "乡村教育", "四大教育", "三大方式", "平民教育"]},
    12: {"subject": "zhongjiao", "chapter_id": 27, "pages": {25, 26}, "keywords": ["梁漱溟", "乡村建设", "乡农学校", "中国社会"]},
    13: {"subject": "zhongjiao", "chapter_id": 33, "pages": {26}, "keywords": ["陈鹤琴", "活教育", "五指活动", "儿童"]},
    14: {"subject": "zhongjiao", "chapter_id": 36, "pages": {26, 27}, "keywords": ["陶行知", "生活教育", "小先生", "山海工学团", "育才学校"]},
    15: {"subject": "zhongjiao", "chapter_id": 41, "pages": {27}, "keywords": ["恽代英", "李大钊", "早期共产党人", "自学辅导"]},
    # 外国教育史：当前数据库建到第五章前三节。
    16: {"subject": "waijiao", "chapter_id": 44, "pages": {1, 2}, "keywords": ["东方文明", "古埃及", "古印度", "古巴比伦", "希伯来", "婆罗门", "佛教", "泥板书舍", "古儒"]},
    17: {"subject": "waijiao", "chapter_id": 45, "pages": {2, 3}, "keywords": ["古希腊", "斯巴达", "雅典", "希腊化", "智者派", "四艺"]},
    18: {"subject": "waijiao", "chapter_id": 46, "pages": {3, 4}, "keywords": ["苏格拉底", "柏拉图", "亚里士多德", "智者派", "古希腊教育思想"]},
    21: {"subject": "waijiao", "chapter_id": 49, "pages": {4, 5}, "keywords": ["古罗马", "共和时期", "帝国时期", "文法学校", "修辞学校"]},
    22: {"subject": "waijiao", "chapter_id": 50, "pages": {5}, "keywords": ["昆体良", "雄辩家", "古罗马教育思想"]},
    23: {"subject": "waijiao", "chapter_id": 53, "pages": {5, 6}, "keywords": ["中世纪", "骑士教育", "教会学校", "城市学校", "中世纪大学"]},
    24: {"subject": "waijiao", "chapter_id": 57, "pages": {6, 7}, "keywords": ["人文主义", "快乐之家", "维多里诺", "伊拉斯谟", "拉伯雷", "蒙田"]},
    25: {"subject": "waijiao", "chapter_id": 58, "pages": {7}, "keywords": ["新教", "宗教改革", "路德", "加尔文", "梅兰克顿"]},
    26: {"subject": "waijiao", "chapter_id": 59, "pages": {7, 8}, "keywords": ["天主教", "耶稣会", "拉萨尔", "免费学校"]},
    27: {"subject": "waijiao", "chapter_id": 62, "pages": {8, 9}, "keywords": ["英国", "洛克", "斯宾塞", "公学", "福斯特法案", "大学推广", "导生制"]},
    28: {"subject": "waijiao", "chapter_id": 63, "pages": {9, 10}, "keywords": ["法国", "拿破仑", "帝国大学", "基佐法案", "费里法案", "启蒙"]},
    29: {"subject": "waijiao", "chapter_id": 64, "pages": {10, 11}, "keywords": ["德国", "洪堡", "第斯多惠", "泛爱学校", "柏林大学", "实科中学"]},
}


APPROVED_SUPPLEMENTAL_QUESTIONS: list[dict[str, Any]] = [
    {
        "palace_id": 11,
        "source_chapter_id": 22,
        "question_type": "multiple_choice",
        "stem": "【2020年311真题23】在乡村教育运动中，晏阳初提出解决“愚、穷、弱、私”四方面问题的对策是实施“四大教育”，其中最为根本的是（ ）",
        "options": [
            {"id": "A", "text": "文艺教育"},
            {"id": "B", "text": "卫生教育"},
            {"id": "C", "text": "生计教育"},
            {"id": "D", "text": "公民教育"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "晏阳初以文艺教育攻愚、生计教育攻穷、卫生教育攻弱、公民教育攻私，其中公民教育最为根本。",
        "source_pages": {"question": ["zhongjiao_questions/page_025"], "answer": ["zhongjiao_answers/page_034"]},
    },
    {
        "palace_id": 11,
        "source_chapter_id": 22,
        "question_type": "multiple_choice",
        "stem": "在河北定县开展实验，从事过国际平民教育运动的思想家是（ ）",
        "options": [
            {"id": "A", "text": "晏阳初"},
            {"id": "B", "text": "梁漱溟"},
            {"id": "C", "text": "陶行知"},
            {"id": "D", "text": "陈鹤琴"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "晏阳初主持河北定县实验，并从事国际平民教育运动。",
        "source_pages": {"question": ["zhongjiao_questions/page_025"], "answer": ["zhongjiao_answers/page_034"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "【2014年311真题23】“五指活动”是陈鹤琴对其“活教育”课程组织形式的形象表述，它体现了儿童生活的（ ）",
        "options": [
            {"id": "A", "text": "差别性"},
            {"id": "B", "text": "整体性"},
            {"id": "C", "text": "实践性"},
            {"id": "D", "text": "创造性"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "“五指活动”强调儿童生活的整体性和连贯性。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_035"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "【2017年311真题23】陈鹤琴“活教育”教学的四个步骤是实验观察、阅读思考、创作发表和（ ）",
        "options": [
            {"id": "A", "text": "行动实践"},
            {"id": "B", "text": "批评研讨"},
            {"id": "C", "text": "更新改进"},
            {"id": "D", "text": "指导提高"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "陈鹤琴“活教育”的教学步骤包括实验观察、阅读思考、创作发表、批评研讨。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_035"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "【2018年311真题21】下列选项中符合陈鹤琴“活教育”课程思想的是（ ）",
        "options": [
            {"id": "A", "text": "直接的知识要优于书本知识，故书本知识应予以摒弃"},
            {"id": "B", "text": "打破学科组织体系，采取活动中心和活动单元的形式"},
            {"id": "C", "text": "儿童经验虽然是重要的，但学科课程体系也不可破坏"},
            {"id": "D", "text": "打破知识的学科界限，按照儿童的兴趣组织课程内容"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "“活教育”课程论主张“大自然、大社会都是活教材”，课程可打破学科组织体系，采取活动中心和活动单元形式。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_035"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "【2019年311真题23】陈鹤琴提出“活教育”的目的是“做人，做中国人，做现代中国人”，对“现代中国人”的要求除健全的身体、建设的能力、能够合作、服务的精神之外，还包括（ ）",
        "options": [
            {"id": "A", "text": "反思的能力"},
            {"id": "B", "text": "自治的能力"},
            {"id": "C", "text": "创造的能力"},
            {"id": "D", "text": "批判的能力"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "陈鹤琴对现代中国人的要求包括健全的身体、建设的能力、创造的能力、能够合作、服务的精神。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_035"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "陈鹤琴提出的儿童“五指活动”不包括（ ）",
        "options": [
            {"id": "A", "text": "健康活动"},
            {"id": "B", "text": "社会活动"},
            {"id": "C", "text": "科学活动"},
            {"id": "D", "text": "职业活动"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "儿童五指活动包括健康活动、社会活动、科学活动、艺术活动、文学活动，不包括职业活动。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_035", "zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "认为儿童在学习中得到的结论不可能完全正确，需要通过集体和小组讨论的方式共同研究，以便互相启发和鼓励的教育家是（ ）",
        "options": [
            {"id": "A", "text": "黄炎培"},
            {"id": "B", "text": "陶行知"},
            {"id": "C", "text": "陈鹤琴"},
            {"id": "D", "text": "晏阳初"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "陈鹤琴强调通过集体和小组讨论共同研究、批评研讨。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "multiple_choice",
        "stem": "批评传统教育一味注重读书，而不去读大自然、大社会这本“真正的书”的思想家是（ ）",
        "options": [
            {"id": "A", "text": "陈鹤琴"},
            {"id": "B", "text": "梁漱溟"},
            {"id": "C", "text": "陶行知"},
            {"id": "D", "text": "黄炎培"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "陈鹤琴认为大自然、大社会都是活教材，是真正有用的书。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 13,
        "source_chapter_id": 33,
        "question_type": "short_answer",
        "stem": "论述陈鹤琴“活教育”思想及其意义。",
        "options": [],
        "answer_payload": {
            "reference_answer": "陈鹤琴“活教育”思想包括目的论、课程论和教学论。目的论是“做人，做中国人，做现代中国人”，要求具有健全的身体、建设的能力、创造的能力、合作态度和服务精神。课程论强调“大自然、大社会都是活教材”，并不排斥课本和间接经验，而是反对脱离生活的书本中心。教学论强调“做中教，做中学，做中求进步”，重视实验观察、阅读思考、创作发表、批评研讨等步骤。“活教育”批判传统教育脱离儿童、脱离社会生活和实际实践，突出了儿童主体地位，拓展了课程和教学空间，对我国近现代教育改革、幼儿教育和儿童中心教学具有重要启示。"
        },
        "analysis": "参考答案来自陈鹤琴“活教育”论述题解析，按目的论、课程论、教学论和现代意义整理。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "【2011年311真题22】在陶行知看来，教育与生活两者的关系是（ ）",
        "options": [
            {"id": "A", "text": "生活可以取代教育"},
            {"id": "B", "text": "教育是生活的中心"},
            {"id": "C", "text": "教育不能改造生活"},
            {"id": "D", "text": "生活是教育的中心"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "陶行知生活教育理论将生活视为教育的中心。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "【2012年311真题20】陶行知创立“小先生制”的主要目的在于（ ）",
        "options": [
            {"id": "A", "text": "解决普及教育的师资问题"},
            {"id": "B", "text": "培养学生的创造精神"},
            {"id": "C", "text": "发挥优秀学生的帮扶作用"},
            {"id": "D", "text": "尽早完成儿童的社会化"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "“小先生制”是在教师缺乏情况下提出的，主要为解决普及教育的师资问题。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "【2013年311真题23】陶行知为了改变农村教育的落后面貌，探索了乡村师范教育的新模式。他提倡的教师培养模式是（ ）",
        "options": [
            {"id": "A", "text": "艺友制"},
            {"id": "B", "text": "小先生制"},
            {"id": "C", "text": "学徒制"},
            {"id": "D", "text": "实习制"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "陶行知提出的教师培养模式是艺友制。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "【2022年311真题21】称老百姓和儿童为“两位最伟大的老师”的教育家是（ ）",
        "options": [
            {"id": "A", "text": "晏阳初"},
            {"id": "B", "text": "梁漱溟"},
            {"id": "C", "text": "陶行知"},
            {"id": "D", "text": "陈鹤琴"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "陶行知称老百姓和儿童为“两位最伟大的老师”。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "【2024年311真题23】全面抗战时期，人民教育家陶行知为收容战争中流离失所的难童，培养有特殊才能的幼苗，所创办的学校是（ ）",
        "options": [
            {"id": "A", "text": "晓庄学校"},
            {"id": "B", "text": "自然科学园"},
            {"id": "C", "text": "育才学校"},
            {"id": "D", "text": "山海工学团"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "全面抗战期间，陶行知在重庆创办育才学校以收容难童、培养特殊才能幼苗。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_036"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "主张将南京高师全部课程的“教授法”改为“教学法”，以突出教和学的联系和教的服从、服务于学的思想家是（ ）",
        "options": [
            {"id": "A", "text": "陈鹤琴"},
            {"id": "B", "text": "梁漱溟"},
            {"id": "C", "text": "陶行知"},
            {"id": "D", "text": "黄炎培"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "陶行知主张将教授法改为教学法，强调教的方法根据学的方法。",
        "source_pages": {"question": ["zhongjiao_questions/page_026"], "answer": ["zhongjiao_answers/page_037"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "multiple_choice",
        "stem": "开展“科学下嫁”运动的思想家是（ ）",
        "options": [
            {"id": "A", "text": "陈鹤琴"},
            {"id": "B", "text": "梁漱溟"},
            {"id": "C", "text": "陶行知"},
            {"id": "D", "text": "黄炎培"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "开展“科学下嫁”运动的思想家是陶行知。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_037"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "short_answer",
        "stem": "试述陶行知的生活教育理论，结合实际谈谈生活教育的价值和意义。",
        "options": [],
        "answer_payload": {
            "reference_answer": "陶行知生活教育理论的核心包括“生活即教育”“社会即学校”“教学做合一”。生活即教育强调生活含有教育意义，现实生活是教育中心，生活决定教育并能通过教育改造生活。社会即学校要求扩大教育范围，以社会为学校，并使学校具有社会意味。教学做合一强调教的方法根据学的方法，学的方法根据做的方法，做是教和学的中心，反对注入式教学。其价值在于突出教育与生活、学校与社会的联系，重视学生经验和实践，扩大教育对象和学校教育内涵，对平民化、大众化、适应化教育及具有中国特色的教育道路具有启示。"
        },
        "analysis": "参考答案来自陶行知生活教育理论论述题解析，按核心命题和价值意义整理。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_037"]},
    },
    {
        "palace_id": 14,
        "source_chapter_id": 36,
        "question_type": "short_answer",
        "stem": "试述陶行知“生活即教育”和杜威“教育即生活”的基本内涵，并比较其异同。",
        "options": [],
        "answer_payload": {
            "reference_answer": "陶行知“生活即教育”强调生活含有教育意义，现实生活是教育中心，生活决定教育、教育改造生活。杜威“教育即生活”认为教育是生活的过程，学校是社会生活的一种形式，学校生活应与儿童生活和校外社会生活相契合。二者都强调教育与生活、学校与社会不可分离，都反对脱离生活的教育。不同在于：杜威理论产生于美国进步主义教育背景，主要关注儿童生活和学校生活；陶行知立足中国教育改造和社会改造，强调更广阔的社会生活和社会意义上的教育。"
        },
        "analysis": "参考答案来自陶行知与杜威比较题解析，按内涵、相同点和不同点整理。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_037", "zhongjiao_answers/page_038"]},
    },
    {
        "palace_id": 15,
        "source_chapter_id": 41,
        "question_type": "multiple_choice",
        "stem": "以下哪项不属于早期共产党人李大钊的教育思想（ ）",
        "options": [
            {"id": "A", "text": "教育具有阶级性"},
            {"id": "B", "text": "教育不能脱离政治"},
            {"id": "C", "text": "反对尊孔读经"},
            {"id": "D", "text": "主张教育救国"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "李大钊、恽代英、杨贤江等马克思主义教育家主张革命救国，而非教育救国。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_038"]},
    },
    {
        "palace_id": 15,
        "source_chapter_id": 41,
        "question_type": "multiple_choice",
        "stem": "主张在中学阶段推行自学辅导法的是（ ）",
        "options": [
            {"id": "A", "text": "李大钊"},
            {"id": "B", "text": "恽代英"},
            {"id": "C", "text": "杨贤江"},
            {"id": "D", "text": "赵世炎"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "主张在中学阶段推行自学辅导法的是恽代英。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_038"]},
    },
    {
        "palace_id": 15,
        "source_chapter_id": 41,
        "question_type": "short_answer",
        "stem": "早期马克思主义教育家，如杨贤江、李大钊、恽代英等人，教育思想有何共同点？试举例说明。",
        "options": [],
        "answer_payload": {
            "reference_answer": "早期马克思主义教育家的共同点主要包括：第一，都认为教育受经济政治制约并具有阶级性，反对把教育看作超阶级、超政治的活动。第二，都反对教育救国论，强调必须把教育同革命、社会改造和人民解放联系起来。第三，都重视青年和劳动群众的教育，关注教育为革命实践和社会进步服务。杨贤江用马克思主义阐释教育本质，李大钊强调教育不能脱离政治和阶级关系，恽代英则在青年教育、自学辅导和革命实践中体现了这些主张。"
        },
        "analysis": "参考答案来自早期马克思主义教育家共同点论述题解析，按阶级性、反教育救国、服务革命实践整理。",
        "source_pages": {"question": ["zhongjiao_questions/page_027"], "answer": ["zhongjiao_answers/page_038"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2007年311真题21】在西方教育史上，古希腊智者派所确立的“三艺”是（ ）",
        "options": [
            {"id": "A", "text": "音乐、修辞学、几何学"},
            {"id": "B", "text": "文法、辩证法、几何学"},
            {"id": "C", "text": "文法、修辞学、天文学"},
            {"id": "D", "text": "文法、修辞学、辩证法"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "智者派确立了“前三艺”：文法、修辞学、辩证法。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2014年311真题25】古希腊教育家苏格拉底向雅典青年提出的要求和期望是（ ）",
        "options": [
            {"id": "A", "text": "了解自然"},
            {"id": "B", "text": "熟悉社会"},
            {"id": "C", "text": "虔信上帝"},
            {"id": "D", "text": "认识自己"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "苏格拉底向青年提出的要求和期望是“认识自己”。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2015年311真题25】将人的灵魂分为营养的灵魂、感觉的灵魂和理性的灵魂，并据此主张实施体育、德育和智育的古希腊教育思想家是（ ）",
        "options": [
            {"id": "A", "text": "苏格拉底"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "亚里士多德"},
            {"id": "D", "text": "毕达哥拉斯"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "亚里士多德以灵魂论为依据，主张体育、德育和智育。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2018年311真题24】创制文法、修辞、辩证法科目，为后来“七艺”成型奠定基础的是（ ）",
        "options": [
            {"id": "A", "text": "智者派"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "亚里士多德"},
            {"id": "D", "text": "毕达哥拉斯学派"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "“前三艺”由智者派确立，为后来七艺成型奠定基础。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2019年311真题25】亚里士多德将教育分为体育、智育和德育，其依据是（ ）",
        "options": [
            {"id": "A", "text": "灵魂论"},
            {"id": "B", "text": "天性论"},
            {"id": "C", "text": "习惯论"},
            {"id": "D", "text": "理性论"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "亚里士多德从灵魂论出发，将教育分为体育、智育和德育。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "【2021年311真题25】关于雅典城邦教育事务，亚里士多德在《政治学》中所提出的基本主张是（ ）",
        "options": [
            {"id": "A", "text": "青少年教育的顺序是智力训练先于身体训练"},
            {"id": "B", "text": "青少年教育应成为城邦立法者最关心的公共事务"},
            {"id": "C", "text": "家庭教育是城邦最为适宜的教育形式"},
            {"id": "D", "text": "城邦自由民教育要兼顾文化修养与职业技能"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "亚里士多德认为青少年教育应成为城邦立法者最关心的公共事务。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "不满意智者的怀疑论和相对主义，汲取自然哲学家探讨万物本原的思想方法，要求在真理、道德问题上探求普遍有效的“一般”，探究伦理概念的一般定义的思想家是（ ）",
        "options": [
            {"id": "A", "text": "苏格拉底"},
            {"id": "B", "text": "昆体良"},
            {"id": "C", "text": "亚里士多德"},
            {"id": "D", "text": "柏拉图"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "苏格拉底在德育上探求普遍有效的“一般”。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "苏格拉底法中，从各种具体事物中找到事物的共性、本质，通过对具体事物的比较寻求“一般”的过程是（ ）",
        "options": [
            {"id": "A", "text": "定义"},
            {"id": "B", "text": "归纳"},
            {"id": "C", "text": "讥讽"},
            {"id": "D", "text": "助产术"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "苏格拉底法中归纳的过程就是寻找“一般”的过程。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "认为“智慧就是最大的善，正义和其他一切德行都是智慧，因为正义的事和其他一切道德行为都是美而好的”的思想家是（ ）",
        "options": [
            {"id": "A", "text": "苏格拉底"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "亚里士多德"},
            {"id": "D", "text": "昆体良"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "“智慧即德行”“知识即道德”是苏格拉底的观点。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "以下对柏拉图的描述，正确的是（ ）",
        "options": [
            {"id": "A", "text": "是“寓学习于游戏”的最早倡导者"},
            {"id": "B", "text": "第一次将几何、天文、算术列为必须学习的科目"},
            {"id": "C", "text": "主张实践先于理论，身体的训练应先于智力训练"},
            {"id": "D", "text": "提出灵魂由三部分组成，分别是营养的灵魂、感觉的灵魂和理性的灵魂"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "柏拉图是“寓学习于游戏”的最早倡导者。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "苏格拉底认为教育的目的是培养（ ）",
        "options": [
            {"id": "A", "text": "治国人才"},
            {"id": "B", "text": "军事人才"},
            {"id": "C", "text": "商业人才"},
            {"id": "D", "text": "手工业者"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "苏格拉底认为教育的目的是培养治国人才。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "苏格拉底认为，教育的首要任务是（ ）",
        "options": [
            {"id": "A", "text": "培养学问"},
            {"id": "B", "text": "培养道德"},
            {"id": "C", "text": "强健身体"},
            {"id": "D", "text": "维持正义"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "苏格拉底认为教育的首要任务是培养道德。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "第一次将几何、天文、算术列为必须学习的科目的思想家是（ ）",
        "options": [
            {"id": "A", "text": "亚里士多德"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "苏格拉底"},
            {"id": "D", "text": "奥古斯丁"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "第一次将几何、天文、算术列为必修科目的思想家是苏格拉底；若加上音乐则为柏拉图。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "第一次提出以考试作为选拔人才的手段之一的思想家是（ ）",
        "options": [
            {"id": "A", "text": "亚里士多德"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "苏格拉底"},
            {"id": "D", "text": "奥古斯丁"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "柏拉图在《理想国》中提出以考试作为选拔人才的手段之一。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "在西方首次提出“蜡块说”和“白板说”的思想家是（ ）",
        "options": [
            {"id": "A", "text": "亚里士多德"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "苏格拉底"},
            {"id": "D", "text": "奥古斯丁"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "“蜡块说”和“白板说”在西方可追溯到亚里士多德。",
        "source_pages": {"question": ["waijiao_questions/page_003"], "answer": ["waijiao_answers/page_002", "waijiao_answers/page_003"]},
    },
    {
        "palace_id": 18,
        "source_chapter_id": 46,
        "question_type": "multiple_choice",
        "stem": "亚里士多德认为天性、习惯和理性之间的关系应是（ ）",
        "options": [
            {"id": "A", "text": "习惯和理性服从于天性"},
            {"id": "B", "text": "天性和习惯受理性的领导"},
            {"id": "C", "text": "天性和理性服从于习惯"},
            {"id": "D", "text": "三者不可兼得"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "亚里士多德认为天性和习惯应受理性的领导。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_003"]},
    },
    {
        "palace_id": 21,
        "source_chapter_id": 49,
        "question_type": "multiple_choice",
        "stem": "【2022年311真题25】古罗马共和时期家庭教育的主要内容为（ ）",
        "options": [
            {"id": "A", "text": "道德与公民教育"},
            {"id": "B", "text": "知识与技能教育"},
            {"id": "C", "text": "自由教育"},
            {"id": "D", "text": "骑士教育"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "古罗马共和时期家庭教育的主要内容是道德与公民教育。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_003"]},
    },
    {
        "palace_id": 21,
        "source_chapter_id": 49,
        "question_type": "multiple_choice",
        "stem": "罗马共和时期的教育主要形式是（ ）",
        "options": [
            {"id": "A", "text": "家庭教育"},
            {"id": "B", "text": "学校教育"},
            {"id": "C", "text": "个别教育"},
            {"id": "D", "text": "集体教育"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "罗马共和时期的教育基本上是农民-军人的教育，其主要形式是家庭教育。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_003"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2008年311真题21】夸美纽斯提出并系统论述了班级授课制，而班级授课制思想的萌芽可以追溯到古希腊罗马时期的教育家（ ）",
        "options": [
            {"id": "A", "text": "苏格拉底"},
            {"id": "B", "text": "柏拉图"},
            {"id": "C", "text": "昆体良"},
            {"id": "D", "text": "西塞罗"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "昆体良曾提出过班级授课制的设想。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_003", "waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2011年311真题25】古罗马教育家西塞罗论述教育的主要著作是（ ）",
        "options": [
            {"id": "A", "text": "《雄辩术原理》"},
            {"id": "B", "text": "《论雄辩家》"},
            {"id": "C", "text": "《忏悔录》"},
            {"id": "D", "text": "《论灵魂》"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "西塞罗论述教育的主要著作是《论雄辩家》。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2016年311真题25】相对于古希腊教育思想而言，以西塞罗、昆体良为代表的古罗马教育思想更具有（ ）",
        "options": [
            {"id": "A", "text": "理想主义取向"},
            {"id": "B", "text": "相对主义取向"},
            {"id": "C", "text": "思辨性取向"},
            {"id": "D", "text": "实践性取向"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "西塞罗、昆体良重视培养雄辩家、演说家，其教育思想更具有实践性取向。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2018年311真题25】古罗马教育家昆体良主张，在雄辩家培养中居于首要位置的是（ ）",
        "options": [
            {"id": "A", "text": "高尚品质的培养"},
            {"id": "B", "text": "雄辩技巧的练习"},
            {"id": "C", "text": "优雅举止的训练"},
            {"id": "D", "text": "文雅风度的修习"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "昆体良坚持把高尚品质的培养放在雄辩家培养的首要位置。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2020年311真题26】关于雄辩家的培养，古罗马教育家昆体良主张（ ）",
        "options": [
            {"id": "A", "text": "家庭是培养雄辩家的理想场所"},
            {"id": "B", "text": "雄辩术训练是第一位的，广博知识的掌握是第二位的"},
            {"id": "C", "text": "善良的德行是第一位的，完美的雄辩技能是第二位的"},
            {"id": "D", "text": "雄辩家的主要任务并非致力于正义和德行的宣扬和阐释"},
        ],
        "answer_payload": {"correct_option_id": "C"},
        "analysis": "昆体良认为善良的德行是第一位的，完美的雄辩技能是第二位的。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "【2021年311真题26】关于儿童早期教育问题，昆体良的教育建议是（ ）",
        "options": [
            {"id": "A", "text": "不要让儿童在他们还不能热爱学习的时候就厌恶学习"},
            {"id": "B", "text": "儿童年龄小的时候记忆力强，应尽可能多地教他们学习拉丁语"},
            {"id": "C", "text": "不要让儿童最初的教育成为一种娱乐"},
            {"id": "D", "text": "不要教7岁以前的儿童学习认字"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "昆体良认为不要让儿童在尚不能热爱学习时就厌恶学习；他提倡双语教学，且认为最初的教育应带有娱乐性，7岁以前儿童也可以学习认字。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "昆体良认为，雄辩家的首要品质是（ ）",
        "options": [
            {"id": "A", "text": "身体"},
            {"id": "B", "text": "知识"},
            {"id": "C", "text": "技能"},
            {"id": "D", "text": "德行"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "昆体良认为德行是雄辩家的首要品质。",
        "source_pages": {"question": ["waijiao_questions/page_004"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "主张学校教育优于家庭教育的思想家是（ ）",
        "options": [
            {"id": "A", "text": "洛克"},
            {"id": "B", "text": "昆体良"},
            {"id": "C", "text": "柏拉图"},
            {"id": "D", "text": "卢梭"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "昆体良认为学校教育优于家庭教育，学校能激励学生并提供多方面知识。",
        "source_pages": {"question": ["waijiao_questions/page_005"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "multiple_choice",
        "stem": "以下哪项不属于昆体良的教学思想（ ）",
        "options": [
            {"id": "A", "text": "其见解成为班级授课制的萌芽"},
            {"id": "B", "text": "认为专业教育应建立在广博的普通知识基础上"},
            {"id": "C", "text": "主张教师应德才兼备，对学生宽严相济"},
            {"id": "D", "text": "提出学习即回忆"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "提出学习即回忆的是柏拉图，而非昆体良。",
        "source_pages": {"question": ["waijiao_questions/page_005"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 22,
        "source_chapter_id": 50,
        "question_type": "short_answer",
        "stem": "试论昆体良的教育思想在教育史上的贡献。",
        "options": [],
        "answer_payload": {
            "reference_answer": "昆体良是古罗马最有成就的教育家，代表作是《雄辩术原理》。他的教育思想贡献包括：在教育目的上，以培养雄辩家为宗旨；在教育作用上，高度评价教育在人成长中的作用；在教育内容上，强调德行是雄辩家的首要品质，重视学前教育并较早提出双语教育；在教育方法上，主张因材施教、遵循儿童年龄特点，提出启发诱导和提问解答；在教育形式上，主张学校教育优于家庭教育；在教学理论上，其见解是班级授课制思想的萌芽，并主张专业教育建立在广博普通教育基础之上；在教师要求上，强调教师应德才兼备、严宽相济、懂得教学艺术并注意因材施教。"
        },
        "analysis": "参考答案来自昆体良教育思想论述题解析，按教育目的、作用、内容、方法、形式、教学理论和教师要求整理。",
        "source_pages": {"question": ["waijiao_questions/page_005"], "answer": ["waijiao_answers/page_004"]},
    },
    {
        "palace_id": 25,
        "source_chapter_id": 58,
        "question_type": "multiple_choice",
        "stem": "【2008年311真题22】文艺复兴与宗教改革时期，具有较强群众性和普及性特点的教育是（ ）",
        "options": [
            {"id": "A", "text": "人文主义教育"},
            {"id": "B", "text": "新教教育"},
            {"id": "C", "text": "天主教教育"},
            {"id": "D", "text": "耶稣会教育"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "人文主义教育、天主教教育和耶稣会教育具有贵族性，新教教育具有平民性、群众性和普及性。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 25,
        "source_chapter_id": 58,
        "question_type": "multiple_choice",
        "stem": "【2017年311真题27】宗教改革对欧洲教育发展影响的具体表现是（ ）",
        "options": [
            {"id": "A", "text": "教育管理的国家化"},
            {"id": "B", "text": "教育内容的古典化"},
            {"id": "C", "text": "教学语言的统一化"},
            {"id": "D", "text": "教学目的的单一化"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "宗教改革使欧洲国家的教育管理走向世俗化、国家化。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 25,
        "source_chapter_id": 58,
        "question_type": "multiple_choice",
        "stem": "以下哪项不属于宗教改革带来的教育上的变化（ ）",
        "options": [
            {"id": "A", "text": "教育世俗性的增强"},
            {"id": "B", "text": "教育管理国家化的发展"},
            {"id": "C", "text": "教育普及化的发展"},
            {"id": "D", "text": "教育古典性的加强"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "宗教改革促进教育国家化、世俗化和普及化，并未加强教育古典性。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 25,
        "source_chapter_id": 58,
        "question_type": "multiple_choice",
        "stem": "马丁·路德认为，教育的管理权应归（ ）",
        "options": [
            {"id": "A", "text": "国家"},
            {"id": "B", "text": "个人"},
            {"id": "C", "text": "教会"},
            {"id": "D", "text": "国家和教会"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "马丁·路德认为教育的管理权应归国家，而不是教会。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 25,
        "source_chapter_id": 58,
        "question_type": "multiple_choice",
        "stem": "普及教育之父、免费学校的创始人是（ ）",
        "options": [
            {"id": "A", "text": "加尔文"},
            {"id": "B", "text": "马丁·路德"},
            {"id": "C", "text": "柏拉图"},
            {"id": "D", "text": "斯图谟"},
        ],
        "answer_payload": {"correct_option_id": "A"},
        "analysis": "加尔文被称为普及教育之父、免费学校的创始人。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 26,
        "source_chapter_id": 59,
        "question_type": "multiple_choice",
        "stem": "【2012年311真题26】文艺复兴和宗教改革时期，人文主义教育、新教教育、天主教教育所具有的共同点是（ ）",
        "options": [
            {"id": "A", "text": "实施贵族式精英教育"},
            {"id": "B", "text": "重视古典人文学科"},
            {"id": "C", "text": "实施世俗性的义务教育"},
            {"id": "D", "text": "重视教育的群众性和普及性"},
        ],
        "answer_payload": {"correct_option_id": "B"},
        "analysis": "人文主义教育、新教教育和天主教教育都重视古典人文学科。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 26,
        "source_chapter_id": 59,
        "question_type": "multiple_choice",
        "stem": "以下哪项不属于耶稣会学校的教育特点（ ）",
        "options": [
            {"id": "A", "text": "有完备的组织管理"},
            {"id": "B", "text": "有高水平的师资"},
            {"id": "C", "text": "有切实可行的教学方法"},
            {"id": "D", "text": "有非宗教的教育目的"},
        ],
        "answer_payload": {"correct_option_id": "D"},
        "analysis": "耶稣会教育具有宗教目的，教育目的不可能是非宗教的。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
    {
        "palace_id": 26,
        "source_chapter_id": 59,
        "question_type": "short_answer",
        "stem": "比较分析文艺复兴时期人文主义教育、新教教育和天主教教育的区别和联系。",
        "options": [],
        "answer_payload": {
            "reference_answer": "三者区别：人文主义教育和天主教教育总体上反对宗教改革造成的教会分裂，新教教育则服务宗教改革；新教教育与天主教教育都是宗教教育，并共同反对人文主义教育中的异教因素；人文主义教育和天主教教育具有较强贵族性，新教教育更具群众性和普及性；三者根本差异在于服务目的不同。三者联系：都重视古典人文学科；都信仰上帝并具有宗教性；三者教育中的世俗性都在不断增强。"
        },
        "analysis": "参考答案来自天主教教育论述题解析，按区别和联系整理。",
        "source_pages": {"question": ["waijiao_questions/page_007"], "answer": ["waijiao_answers/page_007"]},
    },
]


IMAGE_SETS = {
    "zhongjiao_questions": {"subject": "zhongjiao", "role": "question"},
    "zhongjiao_answers": {"subject": "zhongjiao", "role": "answer"},
    "waijiao_questions": {"subject": "waijiao", "role": "question"},
    "waijiao_answers": {"subject": "waijiao", "role": "answer"},
    "jiaoyuan_questions": {"subject": "jiaoyuan", "role": "question"},
    "jiaoyuan_answers": {"subject": "jiaoyuan", "role": "answer"},
    "jiaoxin_questions": {"subject": "jiaoxin", "role": "question"},
    "jiaoxin_answers": {"subject": "jiaoxin", "role": "answer"},
}


PALACE_SUBJECT_RULES = [
    ("zhongjiao", re.compile(r"(蔡元培|新文化|收回教育权|国民政府|共产党|根据地|杨贤江|黄炎培|晏阳初|梁漱溟|陈鹤琴|陶行知|恽代英|李大钊|民国|现代教育家)")),
    ("waijiao", re.compile(r"(东方文明|古希腊|古罗马|西欧中世纪|人文主义|新教教育|天主教|英国近代|法国近代|德国近代|俄国近代|美国近代|日本近代)")),
]


def json_dump(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def json_load(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.translate(str.maketrans({"（": "(", "）": ")", "．": ".", "。": ".", "，": ",", "：": ":"}))
    text = re.sub(r"\s+", "", text)
    return text.strip()


def compact_for_match(value: Any) -> str:
    text = normalize_text(value)
    text = re.sub(r"^\d+[.、．]", "", text)
    text = re.sub(r"[\"'“”‘’]", "", text)
    return text.lower()


def page_number(path: Path) -> int:
    match = re.search(r"page[_-](\d+)", path.stem)
    return int(match.group(1)) if match else 0


def is_noise(text: str) -> bool:
    compact = normalize_text(text)
    if not compact:
        return True
    if re.search(r"后续更新\s*q+群?\s*\d*", compact, re.I):
        return True
    if re.fullmatch(r"[S5]?\d{1,4}", compact):
        return True
    return False


def line_center(box: list[list[float]]) -> tuple[float, float]:
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def normalize_ocr_result(result: list[Any]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for item in result or []:
        if len(item) < 3:
            continue
        box, text, score = item[0], str(item[1]).strip(), float(item[2])
        if is_noise(text):
            continue
        cx, cy = line_center(box)
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append(
            {
                "box": box,
                "text": text,
                "score": score,
                "cx": cx,
                "cy": cy,
                "x0": min(xs),
                "x1": max(xs),
                "y0": min(ys),
                "y1": max(ys),
            }
        )
    return lines


def reading_order(lines: list[dict[str, Any]], image_width: int) -> list[dict[str, Any]]:
    if not lines:
        return []
    # Most source images are two-column spreads after PDF page splitting. Sorting by
    # column first avoids interleaving left/right options into the same question.
    midpoint = image_width / 2
    gutter = image_width * 0.08

    def column(line: dict[str, Any]) -> int:
        if line["cx"] < midpoint - gutter:
            return 0
        if line["cx"] > midpoint + gutter:
            return 1
        return 0 if line["x0"] < midpoint else 1

    return sorted(lines, key=lambda r: (column(r), round(float(r["cy"]) / 14) * 14, float(r["x0"])))


def ocr_image(engine: RapidOCR, image_path: Path, cache_path: Path, force: bool) -> dict[str, Any]:
    if cache_path.exists() and not force:
        return json_load(cache_path, {})
    started = time.time()
    image = Image.open(image_path).convert("RGB")
    result, elapsed = engine(np.array(image))
    lines = reading_order(normalize_ocr_result(result or []), image.width)
    payload = {
        "image_path": str(image_path),
        "image_set": image_path.parent.name,
        "page": page_number(image_path),
        "width": image.width,
        "height": image.height,
        "elapsed": elapsed,
        "wall_seconds": round(time.time() - started, 2),
        "line_count": len(lines),
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
    }
    json_dump(cache_path, payload)
    return payload


def ocr_all(source_root: Path, work_root: Path, *, force: bool = False, limit_pages: int = 0) -> dict[str, list[dict[str, Any]]]:
    engine = RapidOCR()
    pages_by_set: dict[str, list[dict[str, Any]]] = {}
    for image_set in IMAGE_SETS:
        image_dir = source_root / "images" / image_set
        paths = sorted(image_dir.glob("page_*.*"), key=page_number)
        if limit_pages:
            paths = paths[:limit_pages]
        pages = []
        for path in paths:
            cache_path = work_root / "ocr" / image_set / f"{path.stem}.json"
            print(f"ocr {image_set} page {page_number(path)}", flush=True)
            pages.append(ocr_image(engine, path, cache_path, force))
        pages_by_set[image_set] = pages
    json_dump(work_root / "ocr_index.json", pages_by_set)
    return pages_by_set


def load_cached_ocr(work_root: Path, image_sets: set[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    pages_by_set: dict[str, list[dict[str, Any]]] = {}
    selected = image_sets or set(IMAGE_SETS)
    for image_set in IMAGE_SETS:
        if image_set not in selected:
            continue
        folder = work_root / "ocr" / image_set
        pages = [json_load(path, {}) for path in sorted(folder.glob("page_*.json"), key=page_number)]
        pages_by_set[image_set] = [page for page in pages if page]
    return pages_by_set


def parse_image_sets(raw_value: str) -> set[str] | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    aliases = {
        "current": {
            "zhongjiao_questions",
            "zhongjiao_answers",
            "waijiao_questions",
            "waijiao_answers",
        },
        "all": set(IMAGE_SETS),
    }
    if value in aliases:
        return aliases[value]
    selected = {item.strip() for item in value.split(",") if item.strip()}
    unknown = selected - set(IMAGE_SETS)
    if unknown:
        raise ValueError(f"unknown image sets: {sorted(unknown)}")
    return selected


def detect_type_label(line: str) -> str | None:
    compact = normalize_text(line)
    for label, qtype in QUESTION_TYPE_LABELS.items():
        if label in compact:
            return qtype
    return None


def detect_chapter_or_section(line: str) -> str | None:
    compact = normalize_text(line)
    if re.search(r"第[一二三四五六七八九十0-9]+章", compact):
        return line.strip()
    if re.search(r"第[一二三四五六七八九十0-9]+节", compact):
        return line.strip()
    return None


@dataclass
class ParsedQuestion:
    subject: str
    image_set: str
    page: int
    number: int
    question_type: str
    stem: str
    options: list[dict[str, str]]
    raw_lines: list[str]
    section_context: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "subject": self.subject,
            "image_set": self.image_set,
            "page": self.page,
            "number": self.number,
            "question_type": self.question_type,
            "stem": self.stem,
            "options": self.options,
            "raw_lines": self.raw_lines,
            "section_context": self.section_context,
        }


def finalize_question(
    *,
    subject: str,
    image_set: str,
    page: int,
    number: int,
    current_type: str,
    raw_lines: list[str],
    section_context: list[str],
) -> ParsedQuestion | None:
    if not raw_lines:
        return None
    first = raw_lines[0]
    first = QUESTION_START_RE.sub(r"\2", first, count=1).strip()
    stem_parts = [first] if first else []
    options: list[dict[str, str]] = []
    current_option: dict[str, str] | None = None
    for line in raw_lines[1:]:
        inline = split_inline_options(line)
        if inline:
            options.extend(inline)
            current_option = options[-1]
            continue
        match = OPTION_RE.match(line)
        if match:
            current_option = {"id": match.group(1).upper(), "text": match.group(2).strip()}
            options.append(current_option)
            continue
        if current_option is not None and len(options) < 4 and not QUESTION_START_RE.match(line):
            current_option["text"] = (current_option["text"] + " " + line.strip()).strip()
            continue
        stem_parts.append(line.strip())
        current_option = None
    detected_type = current_type
    if len({item["id"] for item in options}) >= 3:
        detected_type = "multiple_choice"
    stem = re.sub(r"\s+", " ", " ".join(stem_parts)).strip()
    if not stem:
        return None
    if detected_type == "short_answer":
        options = []
    return ParsedQuestion(
        subject=subject,
        image_set=image_set,
        page=page,
        number=number,
        question_type=detected_type,
        stem=stem,
        options=options,
        raw_lines=raw_lines,
        section_context=section_context[-4:],
    )


def split_inline_options(line: str) -> list[dict[str, str]]:
    matches = list(INLINE_OPTION_RE.finditer(line))
    if len(matches) < 2:
        return []
    # Avoid treating normal English abbreviations as options; require option ids to
    # be monotonically A-D and start with A or B.
    ids = [match.group(1).upper() for match in matches]
    if ids[0] not in {"A", "B"}:
        return []
    valid_order = ["A", "B", "C", "D"]
    positions = [valid_order.index(item) for item in ids if item in valid_order]
    if positions != sorted(set(positions)):
        return []
    items: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        text = line[start:end].strip()
        if text:
            items.append({"id": match.group(1).upper(), "text": text})
    return items


def parse_question_pages(pages_by_set: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for image_set, meta in IMAGE_SETS.items():
        if meta["role"] != "question":
            continue
        subject = str(meta["subject"])
        current_type = "multiple_choice"
        section_context: list[str] = []
        current_number: int | None = None
        current_lines: list[str] = []
        current_page = 0
        for page in pages_by_set.get(image_set, []):
            current_page = int(page.get("page") or 0)
            for line_obj in page.get("lines") or []:
                line = str(line_obj.get("text") or "").strip()
                if not line or is_noise(line):
                    continue
                label_type = detect_type_label(line)
                if label_type:
                    if current_number is not None:
                        q = finalize_question(
                            subject=subject,
                            image_set=image_set,
                            page=current_page,
                            number=current_number,
                            current_type=current_type,
                            raw_lines=current_lines,
                            section_context=section_context,
                        )
                        if q:
                            parsed.append(q.as_dict())
                    current_number = None
                    current_lines = []
                    current_type = label_type
                    continue
                section = detect_chapter_or_section(line)
                if section and len(line) < 40:
                    section_context.append(section)
                    continue
                match = QUESTION_START_RE.match(line)
                if match:
                    if current_number is not None:
                        q = finalize_question(
                            subject=subject,
                            image_set=image_set,
                            page=current_page,
                            number=current_number,
                            current_type=current_type,
                            raw_lines=current_lines,
                            section_context=section_context,
                        )
                        if q:
                            parsed.append(q.as_dict())
                    current_number = int(match.group(1))
                    current_lines = [line]
                    continue
                if current_number is not None:
                    current_lines.append(line)
        if current_number is not None:
            q = finalize_question(
                subject=subject,
                image_set=image_set,
                page=current_page,
                number=current_number,
                current_type=current_type,
                raw_lines=current_lines,
                section_context=section_context,
            )
            if q:
                parsed.append(q.as_dict())
    return parsed


def parse_answers(pages_by_set: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    answers_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for image_set, meta in IMAGE_SETS.items():
        if meta["role"] != "answer":
            continue
        subject = str(meta["subject"])
        current_type = "multiple_choice"
        section_context: list[str] = []
        current: dict[str, Any] | None = None
        for page in pages_by_set.get(image_set, []):
            page_no = int(page.get("page") or 0)
            for line_obj in page.get("lines") or []:
                line = str(line_obj.get("text") or "").strip()
                if not line or is_noise(line):
                    continue
                label_type = detect_type_label(line)
                if label_type:
                    current_type = label_type
                    continue
                section = detect_chapter_or_section(line)
                if section and len(line) < 40:
                    section_context.append(section)
                    continue
                match = ANSWER_START_RE.match(line)
                if match:
                    if current is not None:
                        answers_by_subject[subject].append(current)
                    current = {
                        "subject": subject,
                        "image_set": image_set,
                        "page": page_no,
                        "number": int(match.group(1)),
                        "question_type": current_type,
                        "answer": match.group(2).upper().strip(),
                        "analysis_lines": [match.group(3).strip()] if match.group(3).strip() else [],
                        "section_context": section_context[-4:],
                    }
                    if not current["answer"] and current["analysis_lines"]:
                        inline = ANSWER_INLINE_RE.search(current["analysis_lines"][0])
                        if inline:
                            current["answer"] = inline.group(1).upper()
                    continue
                if current is not None:
                    current["analysis_lines"].append(line)
        if current is not None:
            answers_by_subject[subject].append(current)
    for subject, items in answers_by_subject.items():
        for item in items:
            item["analysis"] = re.sub(r"\s+", " ", " ".join(item.pop("analysis_lines", []))).strip()
    return dict(answers_by_subject)


def load_palace_scope(db_path: Path) -> dict[str, Any]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        palaces = [dict(row) for row in con.execute("select id,title,primary_chapter_id,archived from palaces where archived=0 order by id")]
        chapters = {int(row["id"]): dict(row) for row in con.execute("select id,subject_id,parent_id,name,sort_order from chapters")}
        bindings: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in con.execute(
            """
            select cp.palace_id, cp.chapter_id, cp.is_explicit, c.name chapter_name
            from chapter_palaces cp join chapters c on c.id=cp.chapter_id
            order by cp.palace_id, cp.is_explicit desc, c.sort_order, c.id
            """
        ):
            bindings[int(row["palace_id"])].append(dict(row))
        return {"palaces": palaces, "chapters": chapters, "bindings": dict(bindings)}
    finally:
        con.close()


def infer_subject_for_palace(title: str, chapter_id: int | None, chapters: dict[int, dict[str, Any]]) -> str:
    if chapter_id is not None and chapter_id in chapters:
        subject_id = chapters[chapter_id].get("subject_id")
        if subject_id == 4:
            return "zhongjiao"
        if subject_id == 5:
            return "waijiao"
    for subject, pattern in PALACE_SUBJECT_RULES:
        if pattern.search(title):
            return subject
    return "unknown"


def score_question_for_palace(question: dict[str, Any], palace: dict[str, Any], chapter_name: str) -> int:
    title = compact_for_match(palace.get("title"))
    chapter = compact_for_match(chapter_name)
    context = compact_for_match(" ".join(question.get("section_context") or []))
    stem = compact_for_match(question.get("stem"))
    score = 0
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", title):
        if len(token) >= 2 and (token in context or token in stem):
            score += 8
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", chapter):
        if len(token) >= 2 and (token in context or token in stem):
            score += 10
    if chapter and chapter in context:
        score += 30
    if title and title in context:
        score += 25
    return score


def pair_answer(question: dict[str, Any], answers: list[dict[str, Any]]) -> dict[str, Any] | None:
    same_number = [
        item
        for item in answers
        if int(item.get("number") or -1) == int(question.get("number") or -2)
        and str(item.get("question_type") or "") == str(question.get("question_type") or "")
    ]
    if not same_number:
        return None
    q_context = compact_for_match(" ".join(question.get("section_context") or []))
    scored = []
    for item in same_number:
        a_context = compact_for_match(" ".join(item.get("section_context") or []))
        score = 0
        if q_context and a_context and (q_context in a_context or a_context in q_context):
            score += 20
        if item.get("answer"):
            score += 5
        score -= abs(int(item.get("page") or 0) - int(question.get("page") or 0))
        scored.append((score, item))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 8:
        return {"ambiguous": True, "top_score": scored[0][0], "second_score": scored[1][0], "number": question.get("number")}
    return scored[0][1]


def dedup_key(question: dict[str, Any]) -> str:
    options = question.get("options") or []
    option_text = "|".join(f"{item.get('id')}:{compact_for_match(item.get('text'))}" for item in options)
    stem = compact_for_match(YEAR_TAG_RE.sub("", str(question.get("stem") or "")))
    return f"{question.get('source_chapter_id')}|{question.get('question_type')}|{stem}|{option_text}"


def build_candidates(scope: dict[str, Any], questions: list[dict[str, Any]], answers_by_subject: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    chapters = scope["chapters"]
    candidates_by_palace: dict[str, list[dict[str, Any]]] = defaultdict(list)
    low_confidence: list[dict[str, Any]] = []
    for palace in scope["palaces"]:
        palace_id = int(palace["id"])
        rule = CURRENT_PALACE_RULES.get(palace_id)
        primary = palace.get("primary_chapter_id")
        chapter_id = int(rule["chapter_id"]) if rule else (int(primary) if primary is not None else None)
        bound = scope["bindings"].get(palace_id, [])
        if chapter_id is None:
            explicit_children = [item for item in bound if int(item.get("is_explicit") or 0) == 1 and chapters.get(int(item["chapter_id"]), {}).get("parent_id") is not None]
            if explicit_children:
                chapter_id = int(explicit_children[0]["chapter_id"])
        if chapter_id is None:
            low_confidence.append({"palace_id": palace_id, "reason": "missing_chapter_binding", "title": palace["title"]})
            continue
        chapter_name = str(chapters.get(chapter_id, {}).get("name") or "")
        subject = str(rule["subject"]) if rule else infer_subject_for_palace(str(palace["title"]), chapter_id, chapters)
        subject_questions = [q for q in questions if q.get("subject") == subject]
        if rule:
            selected = [
                q
                for q in subject_questions
                if int(q.get("page") or 0) in set(rule["pages"])
                and (
                    keyword_hit(q, rule["keywords"], chapter_name, str(palace["title"]))
                    or section_hit(q, rule["chapter_id"])
                )
            ]
        else:
            scored = [(score_question_for_palace(q, palace, chapter_name), q) for q in subject_questions]
            selected = [q for score, q in scored if score >= 10]
        if not selected:
            # Fallback to context title matching is intentionally conservative: no
            # fabricated questions if the OCR context does not show the palace scope.
            low_confidence.append({"palace_id": palace_id, "reason": "no_questions_matched_scope", "title": palace["title"], "subject": subject})
            continue
        seen: dict[str, dict[str, Any]] = {}
        for q in selected:
            answer = pair_answer(q, answers_by_subject.get(subject, []))
            record = {
                **q,
                "palace_id": palace_id,
                "source_chapter_id": chapter_id,
                "classified_chapter_id": None,
                "palace_title": palace["title"],
                "chapter_name": chapter_name,
                "paired_answer": answer,
            }
            if q["question_type"] == "multiple_choice":
                if len(q.get("options") or []) < 4:
                    record["reject_reason"] = "multiple_choice_missing_options"
                    low_confidence.append(record)
                    continue
                if not answer or answer.get("ambiguous"):
                    record["reject_reason"] = "ambiguous_answer_pair" if answer else "missing_choice_answer"
                    low_confidence.append(record)
                    continue
                answer_text = str(answer.get("answer") or "").strip().upper()
                if not answer_text:
                    record["reject_reason"] = "missing_choice_answer"
                    low_confidence.append(record)
                    continue
                if len(answer_text) != 1:
                    record["reject_reason"] = "multi_answer_not_supported"
                    low_confidence.append(record)
                    continue
                record["answer_payload"] = {"correct_option_id": answer_text}
                record["analysis"] = answer.get("analysis") or ""
            else:
                if not answer or answer.get("ambiguous") or not (answer.get("analysis") or answer.get("answer")):
                    record["reject_reason"] = "missing_short_answer"
                    low_confidence.append(record)
                    continue
                record["answer_payload"] = {"reference_answer": answer.get("analysis") or answer.get("answer")}
                record["analysis"] = answer.get("analysis") or ""
                record["options"] = []
            key = dedup_key(record)
            existing = seen.get(key)
            if existing is None or (YEAR_TAG_RE.search(str(record.get("stem"))) and not YEAR_TAG_RE.search(str(existing.get("stem")))):
                seen[key] = record
        candidates_by_palace[str(palace_id)] = list(seen.values())
    return {"candidates_by_palace": dict(candidates_by_palace), "low_confidence": low_confidence}


def keyword_hit(question: dict[str, Any], keywords: list[str], chapter_name: str, palace_title: str) -> bool:
    haystack = normalize_text(
        " ".join(
            [
                str(question.get("stem") or ""),
                " ".join(question.get("section_context") or []),
            ]
        )
    )
    tokens = list(keywords)
    tokens.extend(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", chapter_name))
    tokens.extend(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,}", palace_title))
    return any(token and normalize_text(token) in haystack for token in tokens)


def section_hit(question: dict[str, Any], chapter_id: int) -> bool:
    context = normalize_text(" ".join(question.get("section_context") or []))
    chapter_markers = {
        7: ["第八章", "第二节"],
        8: ["第八章", "第三节"],
        9: ["第八章", "第四节"],
        11: ["第九章", "第一节"],
        12: ["第九章", "第二节"],
        14: ["第十章", "第一节"],
        19: ["第十章", "第二节"],
        22: ["第十章", "第三节"],
        27: ["第十章", "第四节"],
        33: ["第十章", "第五节"],
        36: ["第十章", "第六节"],
        41: ["第十章", "第七节"],
        44: ["第一章", "第一节"],
        45: ["第一章", "第二节"],
        46: ["第一章", "第三节"],
        49: ["第二章", "第一节"],
        50: ["第二章", "第二节"],
        53: ["第三章"],
        57: ["第四章", "第一节"],
        58: ["第四章", "第二节"],
        59: ["第四章", "第三节"],
        62: ["第五章", "第一节"],
        63: ["第五章", "第二节"],
        64: ["第五章", "第三节"],
    }
    markers = chapter_markers.get(chapter_id) or []
    return bool(markers) and all(normalize_text(marker) in context for marker in markers)


def to_import_payload(record: dict[str, Any]) -> dict[str, Any]:
    answer = record.get("paired_answer") or {}
    source_meta = {
        "source_kind": "1000_quiz_local_repair",
        "repair_batch": REPAIR_BATCH,
        "question_image_set": record.get("image_set"),
        "question_page": record.get("page"),
        "question_number": record.get("number"),
        "answer_image_set": answer.get("image_set"),
        "answer_page": answer.get("page"),
        "answer_number": answer.get("number"),
        "ocr_confidence": None,
        "pairing_confidence": "rule_number_context",
    }
    payload = {
        "question_type": record["question_type"],
        "stem": record["stem"],
        "options": record.get("options") or [],
        "answer_payload": record["answer_payload"],
        "analysis": record.get("analysis") or "",
        "source_meta": source_meta,
        "source_chapter_id": record["source_chapter_id"],
        "classified_chapter_id": record.get("classified_chapter_id"),
    }
    if record["question_type"] == "short_answer":
        payload["reference_answer"] = payload["answer_payload"].get("reference_answer")
    else:
        payload["correct_option_id"] = payload["answer_payload"].get("correct_option_id")
    return payload


def validate_payloads(candidates_by_palace: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    problems = []
    summary = {}
    for palace_id, records in candidates_by_palace.items():
        type_counts = Counter(record["question_type"] for record in records)
        summary[palace_id] = {"total": len(records), "types": dict(type_counts)}
        for record in records:
            if record["question_type"] == "multiple_choice":
                option_ids = {item.get("id") for item in record.get("options") or []}
                answer = (record.get("answer_payload") or {}).get("correct_option_id")
                if answer not in option_ids:
                    problems.append({"palace_id": palace_id, "reason": "answer_not_in_options", "stem": record.get("stem"), "answer": answer})
                if re.search(r"\bA[.．、]\s*.+\bB[.．、]\s*", str(record.get("stem"))):
                    problems.append({"palace_id": palace_id, "reason": "stem_contains_options", "stem": record.get("stem")})
            if record["question_type"] == "short_answer" and record.get("options"):
                problems.append({"palace_id": palace_id, "reason": "short_answer_has_options", "stem": record.get("stem")})
    return {"summary": summary, "problems": problems}


def copy_db_for_audit(db_path: Path, work_root: Path) -> Path:
    target = work_root / "audit-app-home" / "data" / "memory_palace.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, target)
    return target


def create_live_backup(db_path: Path, work_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = work_root / "backups" / f"{timestamp}-before-live-write-memory_palace.db"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, backup)
    return backup


def import_into_db(db_path: Path, candidates_by_palace: dict[str, list[dict[str, Any]]], *, save_mode: str = "append") -> dict[str, Any]:
    import os

    os.environ["MEMORY_ANKI_HOME"] = str(db_path.parent.parent)

    from memory_anki.infrastructure.db.models import get_session
    from memory_anki.modules.quiz.application.question_creation_commands import batch_create_chapter_questions

    result = []
    with get_session() as session:
        chapter_payloads: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for records in candidates_by_palace.values():
            for record in records:
                chapter_payloads[int(record["source_chapter_id"])].append(to_import_payload(record))
        for chapter_id, payloads in sorted(chapter_payloads.items()):
            saved = batch_create_chapter_questions(session, chapter_id, payloads, save_mode=save_mode)
            result.append({"chapter_id": chapter_id, "input_count": len(payloads), "saved_count": len(saved)})
    return {"chapters": result}


def write_import_bundle(work_root: Path, candidates_by_palace: dict[str, list[dict[str, Any]]]) -> Path:
    bundle_path = work_root / "import_bundle.json"
    json_dump(bundle_path, {"candidates_by_palace": candidates_by_palace})
    return bundle_path


def run_import_subprocess(db_path: Path, bundle_path: Path, *, save_mode: str) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--import-bundle",
        str(bundle_path),
        "--db",
        str(db_path),
        "--save-mode",
        save_mode,
    ]
    completed = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "import subprocess failed\nSTDOUT:\n"
            + completed.stdout
            + "\nSTDERR:\n"
            + completed.stderr
        )
    return json.loads(completed.stdout)


def run_import_bundle(db_path: Path, bundle_path: Path, *, save_mode: str) -> int:
    bundle = json_load(bundle_path, {})
    candidates_by_palace = bundle.get("candidates_by_palace") if isinstance(bundle, dict) else None
    if not isinstance(candidates_by_palace, dict):
        raise RuntimeError(f"invalid import bundle: {bundle_path}")
    result = import_into_db(db_path, candidates_by_palace, save_mode=save_mode)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def run_audit(db_path: Path) -> dict[str, Any]:
    import importlib.util

    audit_path = REPO_ROOT / "tools" / "audit_1000_quiz_bank.py"
    spec = importlib.util.spec_from_file_location("audit_1000_quiz_bank", audit_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load audit script")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.audit_database(db_path)


def repair_existing_database(db_path: Path, work_root: Path, *, write: bool) -> dict[str, Any]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        actions = plan_existing_db_repairs(con)
        json_dump(work_root / "existing_db_repair_plan.json", actions)
        if write:
            apply_existing_db_repairs(con, actions)
            con.commit()
        return actions
    finally:
        con.close()


def load_rows(con: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(
        con.execute(
            """
            select id, palace_id, source_chapter_id, classified_chapter_id, mini_palace_id,
                   origin_question_id, question_type, stem, options_json,
                   answer_payload_json, analysis, source_meta_json, sort_order,
                   correct_count, incorrect_count, attempt_count
            from palace_quiz_questions
            order by id
            """
        )
    )


def row_identity(row: sqlite3.Row) -> str:
    options = json.loads(row["options_json"] or "[]")
    option_text = ""
    if isinstance(options, list):
        option_text = "|".join(
            f"{item.get('id') if isinstance(item, dict) else ''}:{compact_for_match(item.get('text') if isinstance(item, dict) else item)}"
            for item in options
        )
    stem = compact_for_match(YEAR_TAG_RE.sub("", str(row["stem"] or "")))
    return f"{row['question_type']}|{stem}|{option_text}"


def supplemental_identity(item: dict[str, Any]) -> str:
    option_text = "|".join(
        f"{opt.get('id')}:{compact_for_match(opt.get('text'))}"
        for opt in item.get("options") or []
        if isinstance(opt, dict)
    )
    stem = compact_for_match(YEAR_TAG_RE.sub("", str(item.get("stem") or "")))
    return f"{item['question_type']}|{stem}|{option_text}"


def plan_existing_db_repairs(con: sqlite3.Connection) -> dict[str, Any]:
    rows = load_rows(con)
    by_id = {int(row["id"]): row for row in rows}
    chapter_to_palace = {rule["chapter_id"]: palace_id for palace_id, rule in CURRENT_PALACE_RULES.items()}
    actions: dict[str, Any] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "copy_chapter_to_palace": [],
        "insert_supplemental": [],
        "delete_ids": [],
        "update_rows": [],
        "manual_review_ids": [],
        "summary_by_palace": {},
    }
    manual_bad_ids = {158, 175}
    actions["manual_review_ids"] = sorted(manual_bad_ids & set(by_id))
    delete_ids: set[int] = set(actions["manual_review_ids"])
    # Parent-scope leftovers in this dataset are either outside current palace
    # coverage or known misclassified old imports. Keeping them creates quiz
    # range bleed, so remove them from the repaired bank.
    for row in rows:
        if row["palace_id"] is None and row["source_chapter_id"] in {5, 13}:
            delete_ids.add(int(row["id"]))
        effective_chapter = row["classified_chapter_id"] if row["classified_chapter_id"] is not None else row["source_chapter_id"]
        if effective_chapter == 50:
            stem_key = compact_for_match(str(row["stem"] or "")).replace(",", "")
            if (
                "古罗马帝国时期的教育目的在于培养" in stem_key
                or "相对于共和时期古罗马帝国时期的教育变化不包括" in stem_key
                or "古罗马共和时期家庭教育的主要内容" in stem_key
            ):
                delete_ids.add(int(row["id"]))
        if row["palace_id"] == 21 or effective_chapter == 49:
            stem_key = compact_for_match(str(row["stem"] or "")).replace(",", "")
            if any(
                marker in stem_key
                for marker in [
                    "罗马共和时期的教育主要形式",
                    "班级授课制思想的萌芽",
                    "西塞罗论述教育的主要著作",
                    "古罗马教育思想更具有",
                    "昆体良主张在雄辩家培养中居于首要位置",
                    "关于雄辩家的培养古罗马教育家昆体良主张",
                    "关于儿童早期教育问题昆体良的教育建议",
                    "昆体良认为雄辩家的首要品质",
                    "主张学校教育优于家庭教育的思想家",
                    "以下哪项不属于昆体良的教学思想",
                ]
            ):
                delete_ids.add(int(row["id"]))

    # Copy clean chapter-owned questions into their palace so palace quiz pages are complete.
    existing_palace_keys = {
        (int(row["palace_id"]), row_identity(row))
        for row in rows
        if row["palace_id"] is not None and int(row["id"]) not in delete_ids
    }
    next_sort_by_palace: dict[int, int] = defaultdict(int)
    for row in rows:
        if row["palace_id"] is not None:
            next_sort_by_palace[int(row["palace_id"])] = max(
                next_sort_by_palace[int(row["palace_id"])],
                int(row["sort_order"] or 0),
            )
    for row in rows:
        if int(row["id"]) in delete_ids:
            continue
        source_chapter_id = row["source_chapter_id"]
        classified_chapter_id = row["classified_chapter_id"]
        effective_chapter_id = classified_chapter_id if classified_chapter_id is not None else source_chapter_id
        if row["palace_id"] is not None or effective_chapter_id is None:
            continue
        palace_id = chapter_to_palace.get(int(effective_chapter_id))
        if palace_id is None:
            continue
        key = (palace_id, row_identity(row))
        if key in existing_palace_keys:
            delete_ids.add(int(row["id"]))
            continue
        next_sort_by_palace[palace_id] += 1
        actions["copy_chapter_to_palace"].append(
            {
                "source_question_id": int(row["id"]),
                "target_palace_id": palace_id,
                "source_chapter_id": int(effective_chapter_id),
                "sort_order": next_sort_by_palace[palace_id],
            }
        )
        delete_ids.add(int(row["id"]))
        existing_palace_keys.add(key)

    for item in APPROVED_SUPPLEMENTAL_QUESTIONS:
        palace_id = int(item["palace_id"])
        key = (palace_id, supplemental_identity(item))
        if key in existing_palace_keys:
            continue
        next_sort_by_palace[palace_id] += 1
        payload = dict(item)
        payload["sort_order"] = next_sort_by_palace[palace_id]
        actions["insert_supplemental"].append(payload)
        existing_palace_keys.add(key)

    # Remove duplicates within each palace, keeping the oldest / tagged question.
    palace_groups: dict[int, dict[str, list[sqlite3.Row]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["palace_id"] is not None and int(row["id"]) not in delete_ids:
            palace_groups[int(row["palace_id"])][row_identity(row)].append(row)
    for palace_id, groups in palace_groups.items():
        for duplicates in groups.values():
            if len(duplicates) <= 1:
                continue
            duplicates = sorted(duplicates, key=lambda r: (0 if YEAR_TAG_RE.search(str(r["stem"] or "")) else 1, int(r["id"])))
            for row in duplicates[1:]:
                delete_ids.add(int(row["id"]))

    # Convert remaining direct palace-only questions to chapter-scoped palace questions.
    for row in rows:
        if int(row["id"]) in delete_ids:
            continue
        if row["palace_id"] is None or row["source_chapter_id"] is not None:
            continue
        rule = CURRENT_PALACE_RULES.get(int(row["palace_id"]))
        if not rule:
            continue
        actions["update_rows"].append(
            {
                "id": int(row["id"]),
                "source_chapter_id": int(rule["chapter_id"]),
                "classified_chapter_id": None,
                "source_meta_patch": {
                    "repair_batch": REPAIR_BATCH,
                    "repair_action": "filled_source_chapter_for_palace_question",
                },
            }
        )

    actions["delete_ids"] = sorted(delete_ids)
    projected_counts: dict[int, int] = defaultdict(int)
    for row in rows:
        question_id = int(row["id"])
        if question_id in delete_ids:
            continue
        if row["palace_id"] is not None:
            projected_counts[int(row["palace_id"])] += 1
    for item in actions["copy_chapter_to_palace"]:
        projected_counts[int(item["target_palace_id"])] += 1
    for item in actions["insert_supplemental"]:
        projected_counts[int(item["palace_id"])] += 1
    actions["summary_by_palace"] = {
        str(palace_id): {"projected_question_count": projected_counts.get(palace_id, 0)}
        for palace_id in sorted(CURRENT_PALACE_RULES)
    }
    return actions


def apply_existing_db_repairs(con: sqlite3.Connection, actions: dict[str, Any]) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    for item in actions.get("update_rows") or []:
        row = con.execute("select source_meta_json from palace_quiz_questions where id = ?", (int(item["id"]),)).fetchone()
        meta = json.loads(row["source_meta_json"] or "{}") if row else {}
        if not isinstance(meta, dict):
            meta = {}
        meta.update(item.get("source_meta_patch") or {})
        con.execute(
            """
            update palace_quiz_questions
            set source_chapter_id = ?, classified_chapter_id = ?, source_meta_json = ?, updated_at = ?
            where id = ?
            """,
            (
                item.get("source_chapter_id"),
                item.get("classified_chapter_id"),
                json.dumps(meta, ensure_ascii=False),
                now,
                int(item["id"]),
            ),
        )
    for item in actions.get("copy_chapter_to_palace") or []:
        source = con.execute("select * from palace_quiz_questions where id = ?", (int(item["source_question_id"]),)).fetchone()
        if source is None:
            continue
        meta = json.loads(source["source_meta_json"] or "{}")
        if not isinstance(meta, dict):
            meta = {}
        meta.update(
            {
                "repair_batch": REPAIR_BATCH,
                "repair_action": "copied_chapter_question_to_palace",
                "origin_question_id": int(source["id"]),
            }
        )
        con.execute(
            """
            insert into palace_quiz_questions (
                palace_id, question_type, stem, options_json, answer_payload_json,
                analysis, source_meta_json, sort_order, correct_count, incorrect_count,
                attempt_count, created_at, updated_at, mini_palace_id,
                origin_question_id, source_chapter_id, classified_chapter_id
            ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, NULL, ?, ?, NULL)
            """,
            (
                int(item["target_palace_id"]),
                source["question_type"],
                source["stem"],
                source["options_json"],
                source["answer_payload_json"],
                source["analysis"],
                json.dumps(meta, ensure_ascii=False),
                int(item["sort_order"]),
                now,
                now,
                int(source["id"]),
                int(item["source_chapter_id"]),
            ),
        )
    for item in actions.get("insert_supplemental") or []:
        meta = {
            "source_kind": "1000_quiz_local_repair",
            "repair_batch": REPAIR_BATCH,
            "repair_action": "approved_supplemental_from_ocr_source",
            "source_pages": item.get("source_pages") or {},
        }
        con.execute(
            """
            insert into palace_quiz_questions (
                palace_id, question_type, stem, options_json, answer_payload_json,
                analysis, source_meta_json, sort_order, correct_count, incorrect_count,
                attempt_count, created_at, updated_at, mini_palace_id,
                origin_question_id, source_chapter_id, classified_chapter_id
            ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, NULL, NULL, ?, NULL)
            """,
            (
                int(item["palace_id"]),
                item["question_type"],
                item["stem"],
                json.dumps(item.get("options") or [], ensure_ascii=False),
                json.dumps(item.get("answer_payload") or {}, ensure_ascii=False),
                item.get("analysis") or "",
                json.dumps(meta, ensure_ascii=False),
                int(item["sort_order"]),
                now,
                now,
                int(item["source_chapter_id"]),
            ),
        )
    for question_id in actions.get("delete_ids") or []:
        con.execute("delete from palace_quiz_questions where id = ?", (int(question_id),))


def main() -> int:
    parser = argparse.ArgumentParser(description="Locally repair 1000-question quiz bank without site Qwen models.")
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--work-root", default=str(DEFAULT_WORK_ROOT))
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--image-sets", default="current")
    parser.add_argument("--limit-pages", type=int, default=0)
    parser.add_argument("--import-audit-db", action="store_true")
    parser.add_argument("--write-live-db", action="store_true")
    parser.add_argument("--allow-incomplete-live-write", action="store_true")
    parser.add_argument("--save-mode", choices=["append", "overwrite"], default="append")
    parser.add_argument("--import-bundle", default="")
    parser.add_argument("--repair-existing-audit-db", action="store_true")
    parser.add_argument("--repair-existing-live-db", action="store_true")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    db_path = Path(args.db)
    work_root = Path(args.work_root)
    work_root.mkdir(parents=True, exist_ok=True)

    if args.import_bundle:
        return run_import_bundle(db_path, Path(args.import_bundle), save_mode=args.save_mode)

    image_sets = parse_image_sets(args.image_sets)
    if args.skip_ocr:
        pages_by_set = load_cached_ocr(work_root, image_sets)
    else:
        # Temporarily narrow IMAGE_SETS by filtering the result after OCR; OCR itself
        # still uses the global order for stable cache paths.
        original_sets = dict(IMAGE_SETS)
        try:
            if image_sets is not None:
                for key in list(IMAGE_SETS):
                    if key not in image_sets:
                        del IMAGE_SETS[key]
            pages_by_set = ocr_all(source_root, work_root, force=bool(args.force_ocr), limit_pages=max(0, args.limit_pages))
        finally:
            IMAGE_SETS.clear()
            IMAGE_SETS.update(original_sets)
    questions = parse_question_pages(pages_by_set)
    answers_by_subject = parse_answers(pages_by_set)
    scope = load_palace_scope(db_path)
    candidate_result = build_candidates(scope, questions, answers_by_subject)
    validation = validate_payloads(candidate_result["candidates_by_palace"])

    json_dump(work_root / "parsed_questions.json", questions)
    json_dump(work_root / "parsed_answers.json", answers_by_subject)
    json_dump(work_root / "candidate_questions.json", candidate_result)
    json_dump(work_root / "candidate_validation.json", validation)
    bundle_path = write_import_bundle(work_root, candidate_result["candidates_by_palace"])

    audit_db_path = copy_db_for_audit(db_path, work_root)
    import_result = None
    post_audit = None
    existing_repair_result = None
    existing_post_audit = None
    if args.repair_existing_audit_db or args.repair_existing_live_db:
        existing_repair_result = repair_existing_database(audit_db_path, work_root, write=True)
        existing_post_audit = run_audit(audit_db_path)
        json_dump(work_root / "audit_db_existing_repair_result.json", existing_repair_result)
        json_dump(work_root / "audit_db_existing_repair_post_audit.json", existing_post_audit)
    if args.import_audit_db or args.write_live_db:
        import_result = run_import_subprocess(audit_db_path, bundle_path, save_mode=args.save_mode)
        post_audit = run_audit(audit_db_path)
        json_dump(work_root / "audit_db_import_result.json", import_result)
        json_dump(work_root / "audit_db_post_audit.json", post_audit)

    live_backup = None
    live_import = None
    live_audit = None
    live_existing_repair = None
    if args.write_live_db:
        if (validation["problems"] or candidate_result["low_confidence"]) and not args.allow_incomplete_live_write:
            raise RuntimeError(
                "refusing live write because candidate validation has problems or low-confidence records; "
                "review reports first or pass --allow-incomplete-live-write explicitly"
            )
        live_backup = create_live_backup(db_path, work_root)
        live_import = run_import_subprocess(db_path, bundle_path, save_mode=args.save_mode)
        live_audit = run_audit(db_path)
        json_dump(work_root / "live_import_result.json", live_import)
        json_dump(work_root / "live_post_audit.json", live_audit)
    if args.repair_existing_live_db:
        live_backup = create_live_backup(db_path, work_root)
        live_existing_repair = repair_existing_database(db_path, work_root, write=True)
        live_audit = run_audit(db_path)
        json_dump(work_root / "live_existing_repair_result.json", live_existing_repair)
        json_dump(work_root / "live_post_audit.json", live_audit)

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repair_batch": REPAIR_BATCH,
        "db": str(db_path),
        "work_root": str(work_root),
        "parsed_question_count": len(questions),
        "parsed_answer_count": sum(len(items) for items in answers_by_subject.values()),
        "candidate_summary": validation["summary"],
        "candidate_problem_count": len(validation["problems"]),
        "low_confidence_count": len(candidate_result["low_confidence"]),
        "audit_db": str(audit_db_path),
        "audit_db_import_result": import_result,
        "audit_db_post_audit_counts": post_audit.get("counts") if isinstance(post_audit, dict) else None,
        "audit_db_existing_repair_counts": existing_post_audit.get("counts") if isinstance(existing_post_audit, dict) else None,
        "live_backup": str(live_backup) if live_backup else None,
        "live_import_result": live_import,
        "live_existing_repair": live_existing_repair,
        "live_post_audit_counts": live_audit.get("counts") if isinstance(live_audit, dict) else None,
    }
    json_dump(work_root / "repair_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not validation["problems"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
