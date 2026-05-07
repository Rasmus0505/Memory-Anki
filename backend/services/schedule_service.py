"""记忆曲线调度算法：ebbinghaus / sm2 / custom + 1h/睡前 + 锚定策略"""
from datetime import date, timedelta, datetime


def get_config_value(session, key: str) -> str:
    from models import Config
    row = session.query(Config).filter_by(key=key).first()
    if row:
        return row.value
    from config import DEFAULTS
    return DEFAULTS.get(key, "")


def ebbinghaus_intervals(session) -> list[str]:
    """返回如 ['1h','sleep','1','2','4','7','15','30','60']"""
    raw = get_config_value(session, "ebbinghaus_intervals")
    return [x.strip() for x in raw.split(",") if x.strip()]


def custom_intervals(session) -> list[str]:
    """自定义间隔：纯天数，无 1h/sleep"""
    raw = get_config_value(session, "custom_intervals")
    return [x.strip() for x in raw.split(",") if x.strip() and x.strip().isdigit()]


def use_anchor(session) -> bool:
    return get_config_value(session, "early_review_anchor") == "true"


def compute_next_review(
    session, algorithm: str, review_number: int,
    prev_interval: int, score: int, anchor_date: date | None = None,
) -> tuple[int, date, str, str]:
    """
    返回 (next_interval_days, next_date, review_type, algorithm_used)
    """
    intervals = []
    if algorithm == "sm2":
        return _sm2_next(session, review_number, prev_interval, score)
    elif algorithm == "custom":
        intervals = custom_intervals(session)
    else:
        intervals = ebbinghaus_intervals(session)

    if review_number >= len(intervals):
        # 超出预定义间隔，使用最后一个
        val = intervals[-1]
        return _resolve_interval(val, anchor_date, algorithm)

    val = intervals[review_number]
    return _resolve_interval(val, anchor_date, algorithm)


def _resolve_interval(val: str, anchor_date: date | None, algorithm: str) -> tuple[int, date, str, str]:
    """将间隔值解析为具体的 (天数, 日期, 类型, 算法)"""
    today = date.today()
    if val == "1h":
        return 0, today, "1h", algorithm
    elif val == "sleep":
        return 0, today, "sleep", algorithm
    else:
        days = int(val)
        base = anchor_date or today
        return days, base + timedelta(days=days), "standard", algorithm


def _sm2_next(session, review_number, prev_interval, score):
    initial_ease = float(get_config_value(session, "sm2_initial_ease"))
    min_ease = float(get_config_value(session, "sm2_min_ease"))
    init_int = int(get_config_value(session, "sm2_initial_interval"))
    today = date.today()

    if score >= 3:
        if prev_interval <= 0:
            new = init_int
        elif review_number == 0:
            new = 1
        elif review_number == 1:
            new = 6
        else:
            ease = initial_ease - (0.8 - score * 0.2)
            ease = max(ease, min_ease)
            new = max(1, round(prev_interval * ease))
    else:
        new = 1

    return new, today + timedelta(days=new), "standard", "sm2"


def generate_schedule_for_palace(session, palace_id: int, algorithm: str):
    from models import ReviewSchedule
    today = date.today()

    intervals = []
    if algorithm == "ebbinghaus":
        intervals = ebbinghaus_intervals(session)
    elif algorithm == "custom":
        intervals = custom_intervals(session)
    else:
        intervals = ebbinghaus_intervals(session)

    for i, val in enumerate(intervals):
        if val == "1h":
            scheduled = today
            rtype = "1h"
            interval_days = 0
        elif val == "sleep":
            scheduled = today
            rtype = "sleep"
            interval_days = 0
        else:
            days = int(val)
            scheduled = today + timedelta(days=days)
            rtype = "standard"
            interval_days = days

        s = ReviewSchedule(
            palace_id=palace_id, scheduled_date=scheduled,
            interval_days=interval_days, algorithm_used=algorithm,
            review_number=i, review_type=rtype,
            anchor_date=today,  # 锚定到创建日
        )
        session.add(s)
    session.commit()


def update_all_pending_schedules(session, new_algorithm: str):
    from models import ReviewSchedule, Palace
    session.query(ReviewSchedule).filter_by(completed=False).delete()
    session.commit()
    for palace in session.query(Palace).all():
        generate_schedule_for_palace(session, palace.id, new_algorithm)
