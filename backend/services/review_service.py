"""复习调度服务"""
from datetime import date, timedelta
from sqlalchemy.orm import Session
from models import Palace, ReviewSchedule, ReviewLog
from services.schedule_service import (
    compute_next_review, generate_schedule_for_palace,
    get_config_value, ebbinghaus_intervals, custom_intervals
)


def get_today_reviews(session: Session) -> list[ReviewSchedule]:
    today = date.today()
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    q = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date <= today,
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.review_type != "standard",
                  ReviewSchedule.scheduled_date)
    )
    if max_per_day > 0:
        return q.limit(max_per_day).all()
    return q.all()


def get_overdue_count(session: Session) -> int:
    today = date.today()
    return (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date < today,
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        ).count()
    )


def get_due_count(session: Session) -> int:
    today = date.today()
    return (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date <= today,
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        ).count()
    )


def submit_review(session: Session, schedule_id: int, score: int,
                  duration_seconds: int = 0) -> tuple[ReviewLog | None, dict]:
    """返回 (log, extra_info)"""
    sched = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not sched:
        return None, {}

    today = date.today()
    log = ReviewLog(
        palace_id=sched.palace_id, review_date=today, score=score,
        review_mode=sched.palace.review_mode, duration_seconds=duration_seconds,
    )
    session.add(log)
    sched.completed = True

    algorithm = sched.algorithm_used
    from services.schedule_service import use_anchor
    anchor = sched.anchor_date if use_anchor(session) else None

    # 逾期智能调整：用实际间隔作为基础
    actual_interval = (today - sched.scheduled_date).days
    effective_interval = max(sched.interval_days, actual_interval)

    next_interval, next_date, review_type, algo_used = compute_next_review(
        session, algorithm, sched.review_number + 1, effective_interval, score, anchor
    )

    completed_count = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=sched.palace_id, completed=True)
        .count()
    )

    extra = {}
    # 检查是否已掌握（完成所有间隔）
    intervals = []
    if algorithm in ("ebbinghaus",):
        intervals = ebbinghaus_intervals(session)
    elif algorithm == "custom":
        intervals = custom_intervals(session)
    if intervals and completed_count >= len(intervals):
        sched.palace.mastered = True
        extra["mastered"] = True
    else:
        next_sched = ReviewSchedule(
            palace_id=sched.palace_id, scheduled_date=next_date,
            interval_days=next_interval, algorithm_used=algo_used,
            review_number=completed_count, review_type=review_type,
            anchor_date=sched.anchor_date,
        )
        session.add(next_sched)

    session.commit()
    session.refresh(log)
    return log, extra


def spread_overdue(session: Session, days: int = 7):
    """将逾期项均摊到未来 N 天"""
    today = date.today()
    overdue = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date < today,
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.scheduled_date)
        .all()
    )
    if not overdue:
        return 0

    n = len(overdue)
    per_day = max(1, n // days)
    for i, sched in enumerate(overdue):
        offset = i // per_day
        sched.scheduled_date = today + timedelta(days=min(offset, days - 1))
    session.commit()
    return n


def get_palace_stats(session: Session, palace_id: int) -> dict:
    logs = session.query(ReviewLog).filter_by(palace_id=palace_id).order_by(ReviewLog.review_date).all()
    total = len(logs)
    avg_score = sum(l.score for l in logs) / total if total > 0 else 0
    return {
        "total_reviews": total,
        "average_score": round(avg_score, 1),
        "last_review": logs[-1].review_date.isoformat() if logs else None,
    }


def get_weekly_stats(session: Session) -> dict:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    logs = (
        session.query(ReviewLog)
        .filter(ReviewLog.review_date >= start, ReviewLog.review_date <= today)
        .all()
    )
    total = len(logs)
    completed = sum(1 for l in logs if l.score >= 3)
    return {
        "total": total,
        "completed": completed,
        "completion_rate": round(completed / total * 100) if total > 0 else 0,
        "avg_score": round(sum(l.score for l in logs) / total, 1) if total > 0 else 0,
    }


def trigger_review_for_palace(session: Session, palace_id: int):
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    from services.schedule_service import get_config_value
    algorithm = get_config_value(session, "default_algorithm")
    generate_schedule_for_palace(session, palace_id, algorithm)
