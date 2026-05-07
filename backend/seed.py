"""初始化示例数据，用于测试"""
from models import init_db, get_session, Palace, Peg, Tag, ReviewSchedule
from services.review_service import trigger_review_for_palace
from config import DEFAULTS
from datetime import date, timedelta
import random

init_db()
s = get_session()

# 创建标签
tags_data = [
    ("编程", "#6366f1"),
    ("外语", "#ec4899"),
    ("历史", "#f59e0b"),
    ("日常", "#10b981"),
    ("学习", "#8b5cf6"),
]
tags = {}
for name, color in tags_data:
    t = Tag(name=name, color=color)
    s.add(t)
    tags[name] = t
s.commit()

# 创建宫殿
palaces_data = [
    {
        "title": "Python 基础语法宫殿",
        "description": "使用家中的客厅来记忆 Python 基础知识。\n\n- 大门 = `print()` 输出函数\n- 沙发 = `for` 循环\n- 电视 = `if/else` 条件判断\n- 书架 = `list` 列表操作",
        "difficulty": 2,
        "review_mode": "flashcard",
        "tags": ["编程"],
        "pegs": [
            ("大门", "print('Hello World') - Python 的标准输出函数，将内容显示在屏幕上"),
            ("沙发", "for item in items: - 遍历可迭代对象，每次循环处理一个元素"),
            ("电视", "if condition: ... else: - 条件分支，根据条件的真假执行不同代码"),
            ("书架", "my_list = [1,2,3] - Python 列表，可变有序集合，支持索引、切片、追加"),
        ],
    },
    {
        "title": "日语 N5 单词 - 厨房",
        "description": "利用厨房空间记忆日语 N5 核心词汇。",
        "difficulty": 3,
        "review_mode": "flashcard",
        "tags": ["外语"],
        "pegs": [
            ("冰箱", "食べる (たべる) - 吃"),
            ("水槽", "飲む (のむ) - 喝"),
            ("灶台", "作る (つくる) - 制作"),
            ("餐桌", "食べ物 (たべもの) - 食物"),
        ],
    },
    {
        "title": "中国朝代顺序",
        "description": "用一个熟悉的街道来记忆中国主要朝代顺序。\n\n从街头的第一家店开始，每家店对应一个朝代。",
        "difficulty": 4,
        "review_mode": "browse",
        "tags": ["历史"],
        "pegs": [
            ("咖啡店", "夏朝 - 中国第一个世袭制王朝"),
            ("面包房", "商朝 - 甲骨文的时代"),
            ("书店", "周朝 - 分西周东周，百家争鸣"),
            ("餐厅", "秦朝 - 统一六国，书同文车同轨"),
            ("服装店", "汉朝 - 丝绸之路开通"),
            ("银行", "唐朝 - 贞观之治，开元盛世"),
        ],
    },
]

for pd in palaces_data:
    palace = Palace(
        title=pd["title"],
        description=pd["description"],
        difficulty=pd["difficulty"],
        review_mode=pd["review_mode"],
    )
    s.add(palace)
    s.flush()

    for i, (name, content) in enumerate(pd["pegs"]):
        peg = Peg(palace_id=palace.id, name=name, content=content, sort_order=i)
        s.add(peg)

    for tname in pd["tags"]:
        if tname in tags:
            palace.tags.append(tags[tname])

    s.commit()
    trigger_review_for_palace(s, palace.id)

# 为第一个宫殿模拟一些历史复习记录
from models import ReviewLog
palace1 = s.query(Palace).filter_by(title="Python 基础语法宫殿").first()
if palace1:
    for days_ago, score in [(6, 3), (4, 4), (2, 5)]:
        log = ReviewLog(
            palace_id=palace1.id,
            review_date=date.today() - timedelta(days=days_ago),
            score=score,
            review_mode="flashcard",
        )
        s.add(log)
    # 标记已完成的 schedule
    for sch in palace1.review_schedules[:3]:
        sch.completed = True
    s.commit()

s.close()
print("Sample data created: 3 palaces, 5 tags, simulated review records")
print("Run: cd backend && python app.py")
print("API: http://127.0.0.1:8000")
print("API docs: http://127.0.0.1:8000/docs")
