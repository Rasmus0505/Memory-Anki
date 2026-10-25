"""复习提醒的领域值：设置、判定结果、投递状态。

框架无关（不 import FastAPI / SQLAlchemy），时间一律由调用方注入，
这样"到没到点"可以在测试里用假时钟精确断言。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, time
from typing import Any, Literal

# 投递类型。``slot`` 列存的是 <类型>[:<时分>] 形式的唯一键，
# 唯一约束 (study_day, slot) 因此同时管住"每天一次"和"每分钟最多一次"。
KIND_MORNING = "morning"
KIND_EVENING = "evening"
KIND_READY = "ready"
KIND_IDLE = "idle"
KIND_HOURLY = "hourly"
KINDS = (KIND_MORNING, KIND_EVENING, KIND_READY, KIND_IDLE, KIND_HOURLY)
KIND_LABELS = {
    KIND_MORNING: "早上概览",
    KIND_EVENING: "晚上催促",
    KIND_READY: "到期就绪",
    KIND_IDLE: "闲置拉回",
    KIND_HOURLY: "整点小结",
}
# 同一分钟只能出一条，高优先级先发。
KIND_PRIORITY = {
    KIND_MORNING: 90,
    KIND_EVENING: 80,
    KIND_READY: 60,
    KIND_IDLE: 50,
    KIND_HOURLY: 10,
}

ContentMode = Literal["detailed", "vague"]
CONTENT_MODES = ("detailed", "vague")

# 一小时内最多尝试几次（失败重试）；失败后隔多久再试。
MAX_SEND_ATTEMPTS = 3
RETRY_BACKOFF_MINUTES = 10

DEFAULT_BARK_GROUP = "MemoryAnki"

# 免打扰默认 0:00–8:00。默认值不写死在循环里，全部来自设置。
DEFAULT_QUIET_START_HOUR = 0
DEFAULT_QUIET_END_HOUR = 8


def _coerce_time(value: Any, fallback: time) -> time:
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    text = str(value or "").strip()
    if not text:
        return fallback
    try:
        parsed = time.fromisoformat(text)
    except ValueError:
        return fallback
    return parsed.replace(second=0, microsecond=0)


def _coerce_int(value: Any, fallback: int, *, minimum: int = 0, maximum: int = 10_000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _coerce_icon_url(value: Any) -> str:
    """通知图标只接受 http(s) 地址；其余一律当作没设置。"""
    text = str(value or "").strip()
    if not text.lower().startswith(("http://", "https://")):
        return ""
    return text[:500]


def _coerce_bool(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return fallback


@dataclass(frozen=True)
class ReminderSettings:
    """用户可改的全部提醒设置。默认值就是产品默认值。"""

    enabled: bool = False
    bark_key: str = ""
    morning_time: time = time(8, 30)
    evening_time: time = time(20, 30)
    morning_enabled: bool = True
    evening_enabled: bool = True
    # 补发窗口：到点后多久内开机仍然补发。默认早上到 12:00、晚上到 23:00。
    morning_window_minutes: int = 210
    evening_window_minutes: int = 150
    # 0 = 关闭。到期数低于阈值的那天不发早上那条。
    due_threshold: int = 0
    content_mode: ContentMode = "detailed"
    bark_group: str = DEFAULT_BARK_GROUP
    # 通知图标：必须是公网可达的图片地址（Bark 服务器要去下载它）。
    icon_url: str = ""
    # 免打扰时段（小时，含开始不含结束；开始 > 结束 表示跨零点）。
    quiet_start_hour: int = DEFAULT_QUIET_START_HOUR
    quiet_end_hour: int = DEFAULT_QUIET_END_HOUR
    # 闲置拉回：多久没动作开始提醒、之后每隔多久再催。
    idle_enabled: bool = False
    idle_after_minutes: int = 60
    idle_repeat_minutes: int = 5
    # 0 = 不设上限，直到你回来为止。
    idle_max_repeats: int = 0
    # 默认只在"今天已经动过"之后才盯防：今天一次都没开过，交给早上/晚上概览。
    idle_requires_activity_today: bool = True
    # 到期就绪：累计新放出多少张才值得推一条、两条之间至少隔多久。
    ready_enabled: bool = False
    ready_min_units: int = 5
    ready_min_gap_minutes: int = 15
    # 整点小结。
    hourly_enabled: bool = False
    # 每天最多几条（0 = 不限）。防止配置写错或手机放一边时把通知权限耗光。
    daily_cap: int = 60

    @property
    def configured(self) -> bool:
        return bool(self.bark_key)

    def to_payload(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "morning_time": self.morning_time.strftime("%H:%M"),
            "evening_time": self.evening_time.strftime("%H:%M"),
            "morning_enabled": self.morning_enabled,
            "evening_enabled": self.evening_enabled,
            "morning_window_minutes": self.morning_window_minutes,
            "evening_window_minutes": self.evening_window_minutes,
            "due_threshold": self.due_threshold,
            "content_mode": self.content_mode,
            "bark_group": self.bark_group,
            "icon_url": self.icon_url,
            "quiet_start_hour": self.quiet_start_hour,
            "quiet_end_hour": self.quiet_end_hour,
            "idle_enabled": self.idle_enabled,
            "idle_after_minutes": self.idle_after_minutes,
            "idle_repeat_minutes": self.idle_repeat_minutes,
            "idle_max_repeats": self.idle_max_repeats,
            "idle_requires_activity_today": self.idle_requires_activity_today,
            "ready_enabled": self.ready_enabled,
            "ready_min_units": self.ready_min_units,
            "ready_min_gap_minutes": self.ready_min_gap_minutes,
            "hourly_enabled": self.hourly_enabled,
            "daily_cap": self.daily_cap,
        }

    @classmethod
    def from_payload(cls, payload: Any) -> ReminderSettings:
        if not isinstance(payload, dict):
            return cls()
        defaults = cls()
        mode = str(payload.get("content_mode") or defaults.content_mode)
        return cls(
            enabled=_coerce_bool(payload.get("enabled"), defaults.enabled),
            bark_key=str(payload.get("bark_key") or "").strip(),
            morning_time=_coerce_time(payload.get("morning_time"), defaults.morning_time),
            evening_time=_coerce_time(payload.get("evening_time"), defaults.evening_time),
            morning_enabled=_coerce_bool(
                payload.get("morning_enabled"), defaults.morning_enabled
            ),
            evening_enabled=_coerce_bool(
                payload.get("evening_enabled"), defaults.evening_enabled
            ),
            morning_window_minutes=_coerce_int(
                payload.get("morning_window_minutes"),
                defaults.morning_window_minutes,
                minimum=0,
                maximum=720,
            ),
            evening_window_minutes=_coerce_int(
                payload.get("evening_window_minutes"),
                defaults.evening_window_minutes,
                minimum=0,
                maximum=720,
            ),
            due_threshold=_coerce_int(
                payload.get("due_threshold"), defaults.due_threshold, maximum=5000
            ),
            content_mode=mode if mode in CONTENT_MODES else defaults.content_mode,  # type: ignore[arg-type]
            bark_group=(
                str(payload.get("bark_group") or "").strip() or defaults.bark_group
            ),
            icon_url=_coerce_icon_url(payload.get("icon_url")),
            quiet_start_hour=_coerce_int(
                payload.get("quiet_start_hour"), defaults.quiet_start_hour, maximum=23
            ),
            quiet_end_hour=_coerce_int(
                payload.get("quiet_end_hour"), defaults.quiet_end_hour, maximum=23
            ),
            idle_enabled=_coerce_bool(payload.get("idle_enabled"), defaults.idle_enabled),
            idle_after_minutes=_coerce_int(
                payload.get("idle_after_minutes"),
                defaults.idle_after_minutes,
                minimum=5,
                maximum=720,
            ),
            idle_repeat_minutes=_coerce_int(
                payload.get("idle_repeat_minutes"),
                defaults.idle_repeat_minutes,
                minimum=1,
                maximum=240,
            ),
            idle_max_repeats=_coerce_int(
                payload.get("idle_max_repeats"), defaults.idle_max_repeats, maximum=99
            ),
            idle_requires_activity_today=_coerce_bool(
                payload.get("idle_requires_activity_today"),
                defaults.idle_requires_activity_today,
            ),
            ready_enabled=_coerce_bool(
                payload.get("ready_enabled"), defaults.ready_enabled
            ),
            ready_min_units=_coerce_int(
                payload.get("ready_min_units"), defaults.ready_min_units, minimum=1, maximum=200
            ),
            ready_min_gap_minutes=_coerce_int(
                payload.get("ready_min_gap_minutes"),
                defaults.ready_min_gap_minutes,
                minimum=1,
                maximum=240,
            ),
            hourly_enabled=_coerce_bool(
                payload.get("hourly_enabled"), defaults.hourly_enabled
            ),
            daily_cap=_coerce_int(payload.get("daily_cap"), defaults.daily_cap, maximum=500),
        )


@dataclass(frozen=True)
class DueSnapshot:
    """一条提醒要用的数字。"""

    due_count: int = 0
    ready_now_count: int = 0
    completed_today: int = 0
    completed_yesterday: int = 0
    completed_last_hour: int = 0
    streak_days: int = 0
    # 到期队列里最老的一张已经等了几天。逾期天数是最有说服力的紧迫信号：
    # 它直接对应遗忘曲线，而"还剩多少张"只是一个数字。
    oldest_overdue_days: int = 0
    # 记忆保留率（0–1）。None = 没有可计算的 FSRS 状态。
    average_retention: float | None = None
    lowest_retention: float | None = None
    at_risk_units: int = 0
    # 今天的时间账本：已经过去多久、真正在复习的有几个整点、还剩多久。
    elapsed_hours_today: float = 0.0
    active_hours_today: int = 0
    hours_left_today: float = 0.0


@dataclass(frozen=True)
class DeliveryState:
    """某个投递键已有的结果。"""

    status: str = "pending"
    attempts: int = 0
    last_attempt_at: datetime | None = None  # UTC-naive


@dataclass(frozen=True)
class ReminderDecision:
    send: bool
    kind: str | None
    reason: str

    @property
    def blocked(self) -> bool:
        return not self.send


@dataclass(frozen=True)
class ReminderRuntime:
    """当天的运行态：闲置轮次、就绪基准、上次小结的小时。"""

    study_day: str = ""
    idle_last_at: datetime | None = None  # UTC-naive
    idle_repeats: int = 0
    ready_baseline: int | None = None
    last_ready_at: datetime | None = None  # UTC-naive
    last_hour_key: str = ""
    last_activity_at: datetime | None = None  # UTC-naive
    last_hour_done: int = 0

    def for_day(self, study_day: str) -> ReminderRuntime:
        if self.study_day == study_day:
            return self
        return replace(
            self,
            study_day=study_day,
            idle_last_at=None,
            idle_repeats=0,
            ready_baseline=None,
            last_ready_at=None,
            last_hour_key="",
            last_activity_at=None,
            last_hour_done=0,
        )


SKIP_DISABLED = "disabled"
SKIP_UNCONFIGURED = "unconfigured"
SKIP_QUIET_HOURS = "quiet_hours"
SKIP_OUTSIDE_WINDOW = "outside_window"
SKIP_ALREADY_SENT = "already_sent"
SKIP_RETRY_BACKOFF = "retry_backoff"
SKIP_ATTEMPTS_EXHAUSTED = "attempts_exhausted"
SKIP_NOTHING_DUE = "nothing_due"
SKIP_BELOW_THRESHOLD = "below_threshold"
SKIP_ALREADY_STUDIED = "already_studied"
SKIP_DAILY_CAP = "daily_cap"
SKIP_NOT_IDLE = "not_idle"
SKIP_NO_NEW_READY = "no_new_ready"
SKIP_HOUR_DONE = "hour_done"
SEND_NOW = "due"
