"""Pure policy helpers for palace wave adsorption and safety windows.

No SQLAlchemy / FastAPI imports — unit-testable domain rules.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

WAVE_TYPE_FORMAL = "formal_long_term"
WAVE_TYPE_REINFORCEMENT = "same_day_reinforcement"

WAVE_STATUS_SCHEDULED = "scheduled"
WAVE_STATUS_ACTIVE = "active"
WAVE_STATUS_PAUSED = "paused"
WAVE_STATUS_COMPLETED = "completed"
WAVE_STATUS_CANCELLED = "cancelled"

ITEM_PENDING = "pending"
ITEM_RATED_DIRECT = "rated_direct"
ITEM_RATED_INHERITED = "rated_inherited"
ITEM_PENDING_REINFORCEMENT = "pending_reinforcement"
ITEM_DONE = "done"
ITEM_CONTENT_CHANGED = "content_changed"

SCHEDULE_UNINITIALIZED = "uninitialized"
SCHEDULE_CONTENT_CHANGED = "content_changed"
SCHEDULE_MANUAL = "manual"
SCHEDULE_PRACTICE = "practice"
SCHEDULE_WAVE_ADSORB = "wave_adsorb"
SCHEDULE_CALIBRATED = "calibrated"
SCHEDULE_REINFORCEMENT = "reinforcement"
# 够不到任何单元波次的短间隔卡：不建宫殿波次，进跨宫殿「今日巩固」清单。
SCHEDULE_CONSOLIDATE = "consolidate"


@dataclass(frozen=True)
class AggregationPolicy:
    """单元聚合的**非对称**容忍窗。

    提前与推后的代价完全不同，不能用同一个比例约束：

    - 提前复习昂贵：R 更高 → 稳定度增益项 (e^{w10(1−R)} − 1) 缩水。按 FSRS-6
      默认 w10≈0.796，提前 20% 永久损失约 18% 的间隔增长（复利），提前 35%
      损失约 33%。所以 ``max_pull_ratio`` 收紧到 0.20。
    - 推后便宜：只付一次性的失误概率。推后 30% 约 −2.6pp 保持率、推后 40%
      约 −3.5pp，而复习成功时反而多赚 16–22% 的稳定度增益。所以
      ``max_push_ratio`` 放宽到 0.40，与 ``max_retention_drop`` 互为冗余闸门。

    ``max_push_ratio`` 取 0.40 的依据是 FSRS 的自然分歧带宽：同日复习对齐
    last_review 后，全 Good 时对数分歧每次按 S^(−w9) 压缩约 17%，但 Hard(×0.6)
    / Easy(×1.9) 持续注入，稳态是 ±30% 左右的间隔带。把窗口对齐到这条带宽，
    单元的稳态就是 1–2 个复习日。

    ``min_window_days`` 修掉旧实现的致命缺陷：floor(interval × ratio) 让 6 天
    间隔的卡窗口宽度为 0，永远无法与任何波次合并——聚合开不开都拉不齐。
    """

    max_pull_ratio: float = 0.20
    max_push_ratio: float = 0.40
    max_retention_drop: float = 0.04
    # 窗口宽度下限：短间隔卡也要有合并机会。
    min_window_days: int = 1
    # 绝对兜底，实际由 ratio 主导。
    max_pull_days: int = 30
    max_push_days: int = 30
    # 聚类后低于此张数的簇解散，卡落入巩固清单（避免一张卡撑起一次会话）。
    min_wave_cards: int = 3
    # 间隔低于此的卡永不建单元波次。
    consolidate_floor_days: int = 3


DEFAULT_AGGREGATION_POLICY = AggregationPolicy()

# 单元复习日的排布策略。
UNIT_DAY_POLICY_LOAD_BALANCE = "load_balance"
UNIT_DAY_POLICY_FUZZ = "fuzz"
UNIT_DAY_POLICY_NONE = "none"
DEFAULT_UNIT_DAY_POLICY = UNIT_DAY_POLICY_LOAD_BALANCE

# fuzz 模式下的偏移幅度按单元中位间隔分档（天）。
UNIT_FUZZ_SPREAD_TIERS: tuple[tuple[float, int], ...] = (
    (7.0, 0),
    (20.0, 1),
    (60.0, 2),
)
UNIT_FUZZ_SPREAD_MAX = 3

# Legacy defaults (clock delay removed). Weak ratings use end-of-batch restudy.
DEFAULT_AGAIN_REINFORCEMENT_MINUTES = 0
DEFAULT_HARD_REINFORCEMENT_MINUTES = 0

BASELINE_TIERS: dict[str, dict[str, Any]] = {
    "new": {"stability": None, "difficulty": None, "initialized": False},
    "weak": {"stability": 1.0, "difficulty": 7.0, "initialized": True},
    "fair": {"stability": 7.0, "difficulty": 5.0, "initialized": True},
    "strong": {"stability": 30.0, "difficulty": 3.0, "initialized": True},
}


@dataclass(frozen=True)
class WaveCandidate:
    wave_id: str
    local_date: date
    status: str


def interval_days(last_review_at: datetime | None, raw_due_at: datetime) -> float:
    """Positive interval length in days (minimum small epsilon)."""
    if last_review_at is None:
        return 1.0
    seconds = (raw_due_at - last_review_at).total_seconds()
    return max(seconds / 86400.0, 1.0 / 1440.0)  # at least one minute


def fsrs_retrievability(
    stability_days: float | None,
    *,
    elapsed_days: float,
) -> float:
    """Approximate FSRS-4.5/6 retrievability R = (1 + t/(9S))^-1 for policy checks."""
    if stability_days is None or stability_days <= 0:
        return 0.0
    return (1.0 + elapsed_days / (9.0 * stability_days)) ** -1


def safety_window_bounds(
    *,
    anchor: date,
    interval_days_value: float,
    policy: AggregationPolicy = DEFAULT_AGGREGATION_POLICY,
) -> tuple[date, date]:
    """Return [earliest, latest] local dates within the asymmetric safety window.

    推后侧比提前侧宽（见 AggregationPolicy 的代价分析）；两侧都有
    ``min_window_days`` 下限，否则短间隔卡的窗口会被 floor 抹成 0 天。
    """
    pull_days = min(policy.max_pull_days, interval_days_value * policy.max_pull_ratio)
    push_days = min(policy.max_push_days, interval_days_value * policy.max_push_ratio)
    pull = max(policy.min_window_days, math.floor(pull_days))
    push = max(policy.min_window_days, math.floor(push_days))
    earliest = anchor - timedelta(days=pull)
    latest = anchor + timedelta(days=push)
    return earliest, latest


def unit_fuzz_spread_days(median_interval_days: float) -> int:
    """fuzz 模式下单元复习日的偏移幅度（按中位间隔分档）。"""
    for threshold, spread in UNIT_FUZZ_SPREAD_TIERS:
        if median_interval_days < threshold:
            return spread
    return UNIT_FUZZ_SPREAD_MAX


def unit_day_offset(
    *,
    palace_id: int,
    unit_root_uid: str,
    anchor: date,
    spread_days: int,
    lo: int = 0,
    hi: int = 0,
) -> int:
    """整单元一起偏移的确定性天数，钳制到可行区间 [lo, hi]。

    种子含未偏移质心的序数：同单元同质心恒得同偏移（幂等重算不抖动），
    质心变了则重新掷（不产生系统性偏置）。lo/hi 由簇内每张卡的安全窗交集
    给出——质心按构造落在所有窗内，所以 0 永远可行，用钳制而非重掷即可
    保持确定性。
    """
    if spread_days <= 0 or hi < lo:
        return min(max(0, lo), hi) if hi >= lo else 0
    seed = f"{palace_id}:{unit_root_uid}:{anchor.toordinal()}".encode()
    digest = hashlib.blake2b(seed, digest_size=8).digest()
    raw = int.from_bytes(digest, "big") % (2 * spread_days + 1) - spread_days
    return min(max(raw, lo), hi)


def local_date_of(value: datetime, *, tz_offset_minutes: int | None = None) -> date:
    """Convert a UTC-naive (or aware) datetime to a local calendar date.

    When ``tz_offset_minutes`` is None, use the host local timezone (device-local day).
    """
    if value.tzinfo is not None:
        local = value.astimezone()
        return local.date()
    if tz_offset_minutes is None:
        # Interpret naive as UTC storage, convert to local wall date.
        from datetime import UTC

        aware = value.replace(tzinfo=UTC)
        return aware.astimezone().date()
    from datetime import timezone

    aware = value.replace(tzinfo=UTC)
    offset = timezone(timedelta(minutes=tz_offset_minutes))
    return aware.astimezone(offset).date()


def effective_due_at_for_local_date(local_day: date) -> datetime:
    """Map a formal wave local day to a UTC-naive due timestamp (local midnight → UTC)."""
    from memory_anki.core.time import local_calendar_day_start_as_utc_naive

    return local_calendar_day_start_as_utc_naive(local_day)


def retention_ok_for_later(
    *,
    stability_days: float | None,
    desired_retention: float,
    raw_due_local: date,
    candidate_local: date,
    last_review_at: datetime | None,
    policy: AggregationPolicy = DEFAULT_AGGREGATION_POLICY,
) -> bool:
    """Later wave is allowed only if projected R stays within the drop budget."""
    if candidate_local <= raw_due_local:
        return True
    if last_review_at is None or stability_days is None or stability_days <= 0:
        return candidate_local <= raw_due_local
    delay_days = (candidate_local - raw_due_local).days
    # elapsed from last review to candidate day (approx)
    base_elapsed = max((raw_due_local - local_date_of(last_review_at)).days, 0)
    r_at_candidate = fsrs_retrievability(
        stability_days, elapsed_days=float(base_elapsed + delay_days)
    )
    return r_at_candidate >= (desired_retention - policy.max_retention_drop)


def retention_drop_pp(
    *,
    stability_days: float | None,
    raw_due_local: date,
    candidate_local: date,
    last_review_at: datetime | None,
) -> float:
    """Percentage-point R drop (positive = worse) when moving raw→candidate day.

    提前（candidate 早于 raw）返回负值（R 更高），推后返回正值。
    """
    if last_review_at is None or stability_days is None or stability_days <= 0:
        return 0.0
    base_elapsed = max((raw_due_local - local_date_of(last_review_at)).days, 0)
    shift_days = (candidate_local - raw_due_local).days
    r_raw = fsrs_retrievability(stability_days, elapsed_days=float(base_elapsed))
    r_candidate = fsrs_retrievability(
        stability_days, elapsed_days=float(max(base_elapsed + shift_days, 0))
    )
    return r_raw - r_candidate


def pick_adsorb_wave(
    *,
    raw_due_local: date,
    interval_days_value: float,
    candidates: list[WaveCandidate],
    stability_days: float | None,
    desired_retention: float,
    last_review_at: datetime | None,
    policy: AggregationPolicy = DEFAULT_AGGREGATION_POLICY,
    today: date | None = None,
) -> WaveCandidate | None:
    """Choose the nearest existing scheduled formal wave inside the safety window.

    只吸附到未来的 SCHEDULED 波次：进行中/暂停的会话冻结波次不接收新卡，
    否则学习步的当日短到期会把已冻结的会话撑出新的未评分项。
    Prefer earlier wave when distances tie. Returns None when none fit.
    """
    earliest, latest = safety_window_bounds(
        anchor=raw_due_local, interval_days_value=interval_days_value, policy=policy
    )
    eligible: list[tuple[int, date, WaveCandidate]] = []
    for wave in candidates:
        if wave.status != WAVE_STATUS_SCHEDULED:
            continue
        day = wave.local_date
        if today is not None and day <= today:
            continue
        if day < earliest or day > latest:
            continue
        if not retention_ok_for_later(
            stability_days=stability_days,
            desired_retention=desired_retention,
            raw_due_local=raw_due_local,
            candidate_local=day,
            last_review_at=last_review_at,
            policy=policy,
        ):
            continue
        distance = abs((day - raw_due_local).days)
        eligible.append((distance, day, wave))
    if not eligible:
        return None
    eligible.sort(key=lambda item: (item[0], item[1], item[2].wave_id))
    return eligible[0][2]


def reinforcement_delay_minutes(
    rating: int, *, again_minutes: int = 0, hard_minutes: int = 0
) -> int | None:
    """Return delay minutes for weak ratings, or None when not reinforcement.

    Product rule (batch restudy): 忘记/困难 are immediately available for the
    next pass (delay 0). Clock-based 20/60m waits are retired; ``again_minutes`` /
    ``hard_minutes`` are ignored so legacy settings cannot reintroduce waits.
    """
    del again_minutes, hard_minutes
    if rating in (1, 2):
        return 0
    return None


def is_formal_queue_eligible(schedule_source: str | None, *, has_memory: bool) -> bool:
    """Nodes that may appear in formal long-term due queues.

    Product rule: brand-new / never-reviewed nodes (no memory yet) enter the
    formal learn queue immediately so a newly built palace is reviewable without
    a separate calibration step. Content-changed, same-day reinforcement and
    consolidation-list cards stay out of the formal queue — consolidation cards
    are reviewed from the cross-palace 今日巩固 list so a single short-interval
    card never wakes a whole palace session.
    """
    source = schedule_source or SCHEDULE_UNINITIALIZED
    if source in {
        SCHEDULE_CONTENT_CHANGED,
        SCHEDULE_REINFORCEMENT,
        SCHEDULE_CONSOLIDATE,
    }:
        return False
    # First-learn: unlearned tree nodes are formal-due now.
    if not has_memory:
        return True
    # After the first rating, pure uninitialized shells should not linger as due.
    if source == SCHEDULE_UNINITIALIZED:
        return False
    return True


# Freestyle progress scopes (mutually exclusive buckets on a node).
PROGRESS_SCOPE_OVERDUE = "overdue"
PROGRESS_SCOPE_DUE = "due"
PROGRESS_SCOPE_CALENDAR_TODAY = "calendar_today"
PROGRESS_SCOPE_REINFORCEMENT = "reinforcement"
PROGRESS_SCOPE_CONSOLIDATE = "consolidate"
PROGRESS_SCOPE_NEW = "new"

PROGRESS_SCOPES = frozenset(
    {
        PROGRESS_SCOPE_OVERDUE,
        PROGRESS_SCOPE_DUE,
        PROGRESS_SCOPE_CALENDAR_TODAY,
        PROGRESS_SCOPE_REINFORCEMENT,
        PROGRESS_SCOPE_CONSOLIDATE,
        PROGRESS_SCOPE_NEW,
    }
)

# Default freestyle set: clock-due formal work + same-day restudy + first-learn.
# Calendar-today (not yet clock-due) stays opt-in.
DEFAULT_PROGRESS_SCOPES: tuple[str, ...] = (
    PROGRESS_SCOPE_OVERDUE,
    PROGRESS_SCOPE_DUE,
    PROGRESS_SCOPE_REINFORCEMENT,
    PROGRESS_SCOPE_CONSOLIDATE,
    PROGRESS_SCOPE_NEW,
)


def resolve_progress_bucket(
    *,
    schedule_source: str | None,
    has_memory: bool,
    due_at: datetime | None,
    now: datetime,
    formal_due: bool,
    reinforcement_due: bool,
    calendar_today_due: bool,
) -> str | None:
    """Map a projected node into at most one freestyle progress bucket.

    Buckets are mutually exclusive (priority: reinforcement > consolidate > new >
    overdue > due > calendar_today). Content-changed and not-yet-actionable nodes
    return None and never enter freestyle mind-map units.
    """
    source = schedule_source or SCHEDULE_UNINITIALIZED
    if source == SCHEDULE_CONTENT_CHANGED:
        return None
    if reinforcement_due or source == SCHEDULE_REINFORCEMENT:
        return PROGRESS_SCOPE_REINFORCEMENT if reinforcement_due else None
    if source == SCHEDULE_CONSOLIDATE:
        # 到期的巩固卡仍可在随心队列出现；未到期则不可行动。
        return (
            PROGRESS_SCOPE_CONSOLIDATE
            if due_at is not None and due_at <= now
            else None
        )
    if not has_memory and formal_due:
        return PROGRESS_SCOPE_NEW
    if not formal_due and not calendar_today_due:
        return None
    if due_at is not None and has_memory:
        today = local_date_of(now)
        due_day = local_date_of(due_at)
        if formal_due and due_day < today:
            return PROGRESS_SCOPE_OVERDUE
        if formal_due and due_at <= now and due_day == today:
            return PROGRESS_SCOPE_DUE
        # formal_due with due_day == today but due_at slightly in the future should
        # not happen; treat clock-due on a past second of today as due.
        if formal_due and due_at <= now:
            return PROGRESS_SCOPE_DUE
    if calendar_today_due:
        return PROGRESS_SCOPE_CALENDAR_TODAY
    if formal_due and not has_memory:
        return PROGRESS_SCOPE_NEW
    return None
