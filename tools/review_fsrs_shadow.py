"""Read-only FSRS shadow report for palace review units.

用法：
    python tools/review_fsrs_shadow.py
    python tools/review_fsrs_shadow.py --database "C:/.../memory_palace.db" --output deliverables/...
    python tools/review_fsrs_shadow.py --json tmp/fsrs-shadow.json

脚本只读打开 SQLite，不写回数据库，也不改动任何单元的 stage/due。它做三件事：

1. 用真实评分历史回放阶梯与 FSRS，验证适配器没有改变现有产品规则。
2. 比较“今天再点一次记得”两条路径的下一到期日。
3. 汇总应用运行后写入的实时影子记录（如果新表已经存在）。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from pathlib import Path
from statistics import mean
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from memory_anki.core.exam_horizon import resolve_sprint_horizon  # noqa: E402
from memory_anki.core.runtime_paths import (  # noqa: E402
    get_app_home,
    resolve_existing_database_file,
)
from memory_anki.core.time import local_day, study_day_of  # noqa: E402
from memory_anki.modules.memory.application.unit_fsrs_adapter import (  # noqa: E402
    DEFAULT_RETENTION,
    MAXIMUM_INTERVAL_DAYS,
    SCHEDULER_VERSION,
    FsrsUnitState,
    build_shadow_scheduler,
    rate_unit_with_fsrs,
)
from memory_anki.modules.memory.application.unit_scheduler import rate_unit  # noqa: E402

DEFAULT_OUTPUT = REPO_ROOT / "deliverables" / "2026-10-24-FSRS影子适配基线.md"
# 2026-10-21 23:21 +08:00 起，忘记改为归零、困难改为每天只降一次。
# 用次日作为严格窗口起点，避开当天改动前后的混合口径。
DEFAULT_STRICT_SINCE = date(2026, 10, 22)
# 考试冲刺边界 2026-10-24 才上线；更早的评分没有这条规则，回放时不能套用。
HORIZON_SINCE = date(2026, 10, 24)


@dataclass
class ReplayAudit:
    operation_id: str
    unit_id: str
    palace_title: str
    study_day: date
    rating: int
    schedule_locked: bool
    hard_penalized_today: bool
    had_failure_in_encounter: bool
    stored_stage: int | None
    replayed_stage: int
    stored_due: date | None
    replayed_due: date

    @property
    def stage_ok(self) -> bool:
        return self.stored_stage is None or self.stored_stage == self.replayed_stage

    @property
    def due_ok(self) -> bool:
        return self.stored_due is None or self.stored_due == self.replayed_due

    @property
    def ok(self) -> bool:
        return self.stage_ok and self.due_ok

    @property
    def month(self) -> str:
        return self.study_day.strftime("%Y-%m")

    @property
    def reason(self) -> str:
        if self.ok:
            return ""
        if self.schedule_locked:
            return "提前复习：旧版仍会推进排期"
        if self.had_failure_in_encounter:
            return "同一次重试链：旧口径未计入"
        if self.rating == 2 and self.hard_penalized_today:
            return "同日重复困难：旧版会再次降级"
        if self.rating == 1:
            return "忘记：旧版保留部分阶梯"
        return "其他：手动改期或旧版本"


@dataclass
class UnitRow:
    unit_id: str
    palace_title: str
    anchor_uid: str
    current_stage: int
    current_due: date
    current_has_passed: bool
    history_count: int
    fsrs_current_due: date | None
    next_ladder: date
    next_fsrs: date
    next_delta: int
    ladder_replay_mismatches: int


def parse_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value


def parse_day(raw: Any) -> date | None:
    text = str(raw or "").strip()[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def load_exam_settings(connection: sqlite3.Connection) -> dict[str, Any]:
    try:
        row = connection.execute(
            "SELECT value FROM config WHERE key = 'exam_settings'"
        ).fetchone()
    except sqlite3.Error:
        return {}
    if row is None:
        return {}
    try:
        loaded = json.loads(row[0] or "{}")
    except (TypeError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def load_units(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    connection.row_factory = sqlite3.Row
    return [
        dict(row)
        for row in connection.execute(
            """
            SELECT s.*, p.title AS palace_title
            FROM review_unit_states s
            LEFT JOIN palaces p ON p.id = s.palace_id
            WHERE s.active = 1
            ORDER BY s.palace_id, s.topology_order, s.id
            """
        )
    ]


def load_operations(connection: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    connection.row_factory = sqlite3.Row
    rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT id, unit_id, rating, passed, created_at,
                   before_state_json, after_state_json
            FROM review_unit_rating_operations
            WHERE undone_at IS NULL AND replaced_at IS NULL
            ORDER BY created_at, id
            """
        )
    ]
    by_unit: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_unit.setdefault(str(row["unit_id"]), []).append(row)
    return by_unit


def live_shadow_summary(connection: sqlite3.Connection) -> dict[str, Any]:
    exists = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' "
        "AND name = 'review_unit_fsrs_shadow_ratings'"
    ).fetchone()
    if exists is None:
        return {"available": False, "count": 0}
    # An undone or replaced operation is no longer evidence. Its shadow row stays
    # for audit, but it must not inflate the live comparison.
    effective_join = """
        FROM review_unit_fsrs_shadow_ratings AS shadow
        JOIN review_unit_rating_operations AS operation ON operation.id = shadow.id
        WHERE operation.undone_at IS NULL AND operation.replaced_at IS NULL
    """
    row = connection.execute(
        f"""
        SELECT COUNT(*) AS count,
               AVG(shadow.due_delta_days) AS avg_delta,
               MIN(shadow.due_delta_days) AS min_delta,
               MAX(shadow.due_delta_days) AS max_delta,
               MAX(shadow.created_at) AS last_created_at
        {effective_join}
        """
    ).fetchone()
    buckets: Counter[str] = Counter()
    for (delta,) in connection.execute(
        f"SELECT shadow.due_delta_days {effective_join}"
    ):
        buckets[bucket(int(delta))] += 1
    return {
        "available": True,
        "count": int(row["count"] or 0),
        "avg_delta": round(float(row["avg_delta"]), 2) if row["avg_delta"] is not None else None,
        "min_delta": row["min_delta"],
        "max_delta": row["max_delta"],
        "last_created_at": row["last_created_at"],
        "buckets": dict(buckets),
    }


def bucket(diff: int) -> str:
    if diff <= -30:
        return "提前 >30 天"
    if diff <= -8:
        return "提前 8–30 天"
    if diff <= -1:
        return "提前 1–7 天"
    if diff == 0:
        return "同一天"
    if diff <= 7:
        return "延后 1–7 天"
    if diff <= 30:
        return "延后 8–30 天"
    return "延后 >30 天"


def replay_unit(
    unit: dict[str, Any],
    operations: list[dict[str, Any]],
    *,
    today: date,
    simulated_at: datetime,
    horizon: Any,
    scheduler: Any,
) -> tuple[UnitRow, list[ReplayAudit]]:
    unit_id = str(unit["id"])
    palace_title = str(unit.get("palace_title") or "")
    fsrs_state = FsrsUnitState.empty()
    audits: list[ReplayAudit] = []

    for operation in operations:
        operation_at = parse_ts(operation["created_at"])
        if operation_at is None:
            continue
        operation_day = study_day_of(operation_at)
        payload = _before_payload(operation["before_state_json"])
        before = payload.get("state") or {}
        item = payload.get("item") or {}
        due_before = parse_day(before.get("due_date")) or operation_day
        schedule_locked = due_before > operation_day
        hard_today = (
            str(before.get("hard_penalized_on") or "")[:10]
            == operation_day.isoformat()
        )
        retry_before = int(item.get("retry_count") or 0)
        had_failure = retry_before > 0
        stage_before = int(before.get("stage_index") or 0)
        has_passed_before = bool(before.get("has_passed"))
        rating = int(operation["rating"])
        operation_horizon = horizon if operation_day >= HORIZON_SINCE else None

        ladder = rate_unit(
            stage_index=stage_before,
            has_passed=has_passed_before,
            rating=rating,
            had_failure_in_encounter=had_failure,
            today=operation_day,
            fuzz_key=unit_id,
            schedule_locked=schedule_locked,
            locked_due_date=due_before if schedule_locked else None,
            hard_penalized_today=hard_today,
            horizon=operation_horizon,
        )
        fsrs = rate_unit_with_fsrs(
            current=fsrs_state,
            has_passed=has_passed_before,
            rating=rating,
            today=operation_day,
            rated_at=operation_at,
            schedule_locked=schedule_locked,
            locked_due_date=due_before if schedule_locked else None,
            hard_penalized_today=hard_today,
            fuzz_key=unit_id,
            horizon=operation_horizon,
            scheduler=scheduler,
        )
        fsrs_state = fsrs.state
        stored_after = _after_state(operation["after_state_json"])
        stored_stage = stored_after.get("stage_index")
        audits.append(
            ReplayAudit(
                operation_id=str(operation["id"]),
                unit_id=unit_id,
                palace_title=palace_title,
                study_day=operation_day,
                rating=rating,
                schedule_locked=schedule_locked,
                hard_penalized_today=hard_today,
                had_failure_in_encounter=had_failure,
                stored_stage=int(stored_stage) if stored_stage is not None else None,
                replayed_stage=ladder.stage_index,
                stored_due=parse_day(stored_after.get("due_date")),
                replayed_due=ladder.due_date,
            )
        )

    current_due = date.fromisoformat(str(unit["due_date"])[:10])
    current_locked = current_due > today
    hard_today = str(unit.get("hard_penalized_on") or "")[:10] == today.isoformat()
    ladder_next = rate_unit(
        stage_index=int(unit["stage_index"]),
        has_passed=bool(unit["has_passed"]),
        rating=3,
        had_failure_in_encounter=False,
        today=today,
        fuzz_key=unit_id,
        schedule_locked=current_locked,
        locked_due_date=current_due if current_locked else None,
        hard_penalized_today=hard_today,
        horizon=horizon,
    )
    fsrs_next = rate_unit_with_fsrs(
        current=fsrs_state,
        has_passed=bool(unit["has_passed"]),
        rating=3,
        today=today,
        rated_at=simulated_at,
        schedule_locked=current_locked,
        locked_due_date=current_due if current_locked else None,
        hard_penalized_today=hard_today,
        fuzz_key=unit_id,
        horizon=horizon,
        scheduler=scheduler,
    )
    row = UnitRow(
        unit_id=unit_id,
        palace_title=palace_title,
        anchor_uid=str(unit.get("anchor_uid") or ""),
        current_stage=int(unit["stage_index"]),
        current_due=current_due,
        current_has_passed=bool(unit["has_passed"]),
        history_count=len(operations),
        fsrs_current_due=fsrs_state.due_at.date() if fsrs_state.due_at else None,
        next_ladder=ladder_next.due_date,
        next_fsrs=fsrs_next.due_date,
        next_delta=(fsrs_next.due_date - ladder_next.due_date).days,
        ladder_replay_mismatches=sum(1 for audit in audits if not audit.ok),
    )
    return row, audits


def _before_payload(raw: str) -> dict[str, Any]:
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _after_state(raw: str) -> dict[str, Any]:
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    unit = loaded.get("unit") if isinstance(loaded, dict) else None
    return unit if isinstance(unit, dict) else {}


def render_report(
    *,
    database: Path,
    today: date,
    rows: list[UnitRow],
    audits: list[ReplayAudit],
    strict_since: date,
    live: dict[str, Any],
) -> str:
    next_buckets = Counter(bucket(row.next_delta) for row in rows)
    earlier = sum(1 for row in rows if row.next_delta < 0)
    same = sum(1 for row in rows if row.next_delta == 0)
    later = sum(1 for row in rows if row.next_delta > 0)
    top = sorted(rows, key=lambda row: abs(row.next_delta), reverse=True)[:20]
    exact = sum(1 for row in rows if row.ladder_replay_mismatches == 0)
    history_units = sum(1 for row in rows if row.history_count > 0)

    mismatched = [audit for audit in audits if not audit.ok]
    strict = [audit for audit in audits if audit.study_day >= strict_since]
    strict_bad = [audit for audit in strict if not audit.ok]
    month_stats: dict[str, list[ReplayAudit]] = {}
    for audit in audits:
        month_stats.setdefault(audit.month, []).append(audit)

    lines = [
        "# FSRS 影子适配基线",
        "",
        f"> 生成日期：{today.isoformat()}；数据库：本机数据目录中的 `{database.name}`（只读）。",
        "> 本报告只读回放，不修改任何单元的阶梯阶段或到期日。",
        "",
        "## 0. 一页结论",
        "",
        f"- 适配器版本：`{SCHEDULER_VERSION}`，目标保持率 **{DEFAULT_RETENTION:.2f}**，最大间隔 **{MAXIMUM_INTERVAL_DAYS}** 天。",
        f"- 活跃复习单元 **{len(rows)}** 个，其中有评分历史 **{history_units}** 个。",
        f"- 活跃单元的有效评分 **{len(audits)}** 条，其中阶梯回放可以复现 **{len(audits) - len(mismatched)}** 条（**{len(mismatched)}** 条不一致，见第 4 节）。已停用单元的历史不计入。",
        f"- 严格窗口（{strict_since.isoformat()} 起，现行忘记/困难规则）评分 **{len(strict)}** 条，不一致 **{len(strict_bad)}** 条。",
        f"- 假设今天再点一次“记得”：FSRS 比阶梯**早** {earlier} 个、**同一天** {same} 个、**晚** {later} 个。",
        "- 这只说明两条排期的差异；现有排期没有改变。实时影子记录会在真实评分时写入新表。",
        "",
        "## 1. 适配器保留了哪些产品规则",
        "",
        "| 规则 | 影子适配器的做法 |",
        "| --- | --- |",
        "| 通过必须至少排到次日 | FSRS 间隔小于 1 天时强制为 1 天 |",
        "| 提前复习的通过不推进排期 | 检测到 `due_date > 学习日` 时跳过 FSRS 更新，保留原到期日 |",
        "| 困难当天重试，且同一天只降一次 | `困难` 保持今天到期；当天第二次 `困难` 不再更新 FSRS |",
        "| 忘记归零 | `忘记` 用 FSRS Again，但产品到期日仍为今天 |",
        "| 考试冲刺边界 | 通过时把 FSRS 间隔交给 `SprintHorizon`，只收短、不延长 |",
        "| 同一天成批到期要摊开 | FSRS 自身 fuzz 关闭，适配器用单元 ID 做确定性 5% 偏移 |",
        "",
        "与阶梯的**有意差异**：FSRS 按每个单元的记忆稳定性算间隔，不再查固定阶梯；因此同一个评分可能比阶梯长或短。影子记录只保存差异，不改变真实 due。",
        "",
        "## 2. 今天再点一次“记得”的差异",
        "",
        "| 差值 | 单元数 |",
        "| --- | ---: |",
    ]
    for label in (
        "提前 >30 天",
        "提前 8–30 天",
        "提前 1–7 天",
        "同一天",
        "延后 1–7 天",
        "延后 8–30 天",
        "延后 >30 天",
    ):
        lines.append(f"| {label} | {next_buckets.get(label, 0)} |")

    lines.extend(
        [
            "",
            "## 3. 差异最大的单元",
            "",
            "| 宫殿 | 单元 | 当前阶段 | 当前到期 | 阶梯下次 | FSRS 下次 | 差值 | 历史评分 |",
            "| --- | --- | ---: | --- | --- | --- | ---: | ---: |",
        ]
    )
    for row in top:
        title = row.palace_title.replace("|", "\\|")
        anchor = row.anchor_uid.replace("|", "\\|")
        lines.append(
            f"| {title} | {anchor} | {row.current_stage} | {row.current_due} | "
            f"{row.next_ladder} | {row.next_fsrs} | {row.next_delta:+d} | {row.history_count} |"
        )

    lines.extend(
        [
            "",
            "## 4. 阶梯回放校验",
            "",
            "适配器不是重新实现一套阶梯，而是复用 `rate_unit` 生成影子对照。本节只回放当前活跃单元的历史评分（已停用单元的评分不计入），用历史 `before_state_json`（含当时的重试次数）重算，再与当时写入的 `after_state_json` 比较阶段和到期日。",
            "",
            "排期规则在 2026-10-21 改过：`忘记` 从“保留一半阶梯”改为归零，`困难` 从“每次都降一级”改为每天只降一次。考试冲刺边界又到 2026-10-24 才上线。因此旧评分不能用现行规则严格回放：严格回归只看 2026-10-22 之后的评分，且早于 10-24 的评分不套用冲刺边界。",
            "",
            f"按单元看，**{exact}/{len(rows)}** 个单元的全部历史评分都能复现。",
            "",
            "| 月份 | 评分条数 | 可复现 | 不一致 |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for month in sorted(month_stats):
        month_audits = month_stats[month]
        month_bad = sum(1 for audit in month_audits if not audit.ok)
        lines.append(
            f"| {month} | {len(month_audits)} | {len(month_audits) - month_bad} | {month_bad} |"
        )
    lines.append(
        f"| **合计** | **{len(audits)}** | **{len(audits) - len(mismatched)}** | **{len(mismatched)}** |"
    )
    lines.extend(
        [
            "",
            f"严格窗口（{strict_since.isoformat()} 起）：**{len(strict)}** 条评分，**{len(strict_bad)}** 条不一致。",
            "",
        ]
    )
    if strict_bad:
        lines.append("严格窗口内仍不一致的条目（说明现行 `rate_unit` 与真实评分结果有偏差，需要先查清）：")
        lines.append("")
        for audit in strict_bad[:30]:
            lines.append(
                f"- `{audit.operation_id}`（{audit.study_day}，评分 {audit.rating}）："
                f"阶段 {audit.stored_stage} → {audit.replayed_stage}，"
                f"到期 {audit.stored_due} → {audit.replayed_due}；{audit.reason}"
            )
        lines.append("")
    elif strict:
        lines.append("严格窗口内全部一致：现行 `rate_unit` 能逐条复现真实评分结果。")
        lines.append("")
    if mismatched:
        reasons = Counter(audit.reason for audit in mismatched)
        lines.append("历史不一致的原因分布：")
        lines.append("")
        lines.append("| 原因 | 条数 |")
        lines.append("| --- | ---: |")
        for reason, count in reasons.most_common():
            lines.append(f"| {reason} | {count} |")
        lines.append("")
        lines.append("最早/最近的 10 条历史不一致：")
        lines.append("")
        for audit in (mismatched[:5] + mismatched[-5:]) if len(mismatched) > 5 else mismatched:
            lines.append(
                f"- {audit.study_day} 评分 {audit.rating}（`{audit.operation_id[:8]}`）："
                f"阶段 {audit.stored_stage} → {audit.replayed_stage}，"
                f"到期 {audit.stored_due} → {audit.replayed_due}；{audit.reason}"
            )
        lines.append("")
        lines.append(
            "这些条目来自旧规则、手动改期或外部修改，不影响影子记录；严格窗口的结果才是当前实现的回归证据。"
        )
    else:
        lines.append("所有可回放的评分操作都与历史记录一致。")

    lines.extend(
        [
            "",
            "## 5. 实时影子记录",
            "",
        ]
    )
    if not live.get("available"):
        lines.append("新表尚未迁移到当前数据库。启动一次应用（或运行启动器冒烟）后，迁移会创建两张影子表。")
    elif int(live.get("count") or 0) == 0:
        lines.append("影子表已存在，但还没有实时记录。完成一次随心评分后，这里会出现第一条对比。")
    else:
        lines.append(f"- 已记录评分 **{live['count']}** 条。")
        lines.append(f"- 平均 due 差值：**{live.get('avg_delta')}** 天（范围 {live.get('min_delta')} … {live.get('max_delta')}）。")
        lines.append(f"- 最近写入：`{live.get('last_created_at')}`。")
        lines.append("")
        lines.append("| 差值 | 条数 |")
        lines.append("| --- | ---: |")
        for label, count in sorted(live.get("buckets", {}).items()):
            lines.append(f"| {label} | {count} |")

    lines.extend(
        [
            "",
            "## 6. 怎么读这份报告",
            "",
            "- **先看第 4 节**：如果回放与历史不一致很多，说明历史本身有手动改期或旧规则，不要直接拿差异当算法优劣。",
            "- **再看第 2 节**：FSRS 大量“提前”通常意味着它会更快安排下次复习；大量“延后”则意味着它认为记忆更稳。",
            "- **最后看第 5 节**：实时记录才是接入后真实发生的对比；它不受回放假设影响。",
            "",
            "## 7. 安全边界",
            "",
            "- 生产排期仍由 `unit_scheduler.rate_unit` 决定；影子适配器不写 `review_unit_states`。",
            "- 影子写入包在 SQLAlchemy savepoint 中，失败只记日志，不影响评分成功。",
            "- 影子表可以随时 `DROP`，不会丢学习进度；它们只保存 FSRS 的稳定性、难度、到期日和每次评分的前后对照。",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="生成只读 FSRS 影子对比报告")
    parser.add_argument(
        "--database",
        type=Path,
        default=resolve_existing_database_file(get_app_home()),
        help="memory_palace.db 路径（默认读取本机 local-config）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Markdown 输出路径",
    )
    parser.add_argument(
        "--json",
        type=Path,
        default=None,
        help="可选：额外输出 JSON",
    )
    parser.add_argument(
        "--strict-since",
        type=date.fromisoformat,
        default=DEFAULT_STRICT_SINCE,
        help="严格回放窗口起点（默认 2026-10-22，现行忘记/困难规则生效后）",
    )
    args = parser.parse_args()

    if not args.database.exists():
        print(f"数据库不存在：{args.database}", file=sys.stderr)
        return 2
    connection = sqlite3.connect(f"file:{args.database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    today = local_day()
    settings = load_exam_settings(connection)
    horizon = resolve_sprint_horizon(
        exam_date=settings.get("exam_date"),
        sprint_mode=bool(settings.get("sprint_mode")),
        today=today,
    )
    scheduler = build_shadow_scheduler()
    units = load_units(connection)
    operations = load_operations(connection)
    live = live_shadow_summary(connection)
    connection.close()

    # A fixed mid-day instant keeps the report reproducible within one day.
    # 04:00 UTC is noon in Beijing, safely inside the current study day.
    simulated_at = datetime.combine(today, time(hour=4), tzinfo=UTC)

    rows: list[UnitRow] = []
    audits: list[ReplayAudit] = []
    for unit in units:
        row, unit_audits = replay_unit(
            unit,
            operations.get(str(unit["id"]), []),
            today=today,
            simulated_at=simulated_at,
            horizon=horizon,
            scheduler=scheduler,
        )
        rows.append(row)
        audits.extend(unit_audits)
    audits.sort(key=lambda audit: (audit.study_day, audit.operation_id))
    mismatched = [audit for audit in audits if not audit.ok]
    strict = [audit for audit in audits if audit.study_day >= args.strict_since]
    strict_bad = [audit for audit in strict if not audit.ok]
    month_operations = Counter(audit.month for audit in audits)
    month_mismatches = Counter(audit.month for audit in mismatched)

    report = render_report(
        database=args.database,
        today=today,
        rows=rows,
        audits=audits,
        strict_since=args.strict_since,
        live=live,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8", newline="\n")

    payload = {
        "generated_on": today.isoformat(),
        "database": str(args.database),
        "scheduler_version": SCHEDULER_VERSION,
        "desired_retention": DEFAULT_RETENTION,
        "maximum_interval": MAXIMUM_INTERVAL_DAYS,
        "active_units": len(rows),
        "units_with_history": sum(1 for row in rows if row.history_count > 0),
        "ladder_replay": {
            "operations": len(audits),
            "reproduced": len(audits) - len(mismatched),
            "mismatched": len(mismatched),
            "strict_since": args.strict_since.isoformat(),
            "strict_operations": len(strict),
            "strict_mismatched": len(strict_bad),
            "by_month": {
                month: {
                    "operations": month_operations[month],
                    "mismatched": month_mismatches[month],
                }
                for month in sorted(month_operations)
            },
            "reasons": dict(Counter(audit.reason for audit in mismatched)),
            "samples": [
                {
                    "operation_id": audit.operation_id,
                    "unit_id": audit.unit_id,
                    "study_day": audit.study_day.isoformat(),
                    "rating": audit.rating,
                    "stored_stage": audit.stored_stage,
                    "replayed_stage": audit.replayed_stage,
                    "stored_due": audit.stored_due.isoformat() if audit.stored_due else None,
                    "replayed_due": audit.replayed_due.isoformat(),
                    "reason": audit.reason,
                }
                for audit in mismatched[:50]
            ],
        },
        "next_good_today": {
            "earlier": sum(1 for row in rows if row.next_delta < 0),
            "same": sum(1 for row in rows if row.next_delta == 0),
            "later": sum(1 for row in rows if row.next_delta > 0),
            "buckets": dict(Counter(bucket(row.next_delta) for row in rows)),
            "average_delta": round(mean(row.next_delta for row in rows), 2) if rows else 0,
        },
        "live_shadow": live,
        "units": [
            {
                "unit_id": row.unit_id,
                "palace_title": row.palace_title,
                "anchor_uid": row.anchor_uid,
                "current_stage": row.current_stage,
                "current_due": row.current_due.isoformat(),
                "fsrs_current_due": row.fsrs_current_due.isoformat() if row.fsrs_current_due else None,
                "next_ladder": row.next_ladder.isoformat(),
                "next_fsrs": row.next_fsrs.isoformat(),
                "next_delta": row.next_delta,
                "history_count": row.history_count,
                "ladder_replay_mismatches": row.ladder_replay_mismatches,
            }
            for row in rows
        ],
    }
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )

    print(f"报告已写入：{args.output}")
    print(
        f"单元 {len(rows)}；全部历史回放不一致 {len(mismatched)} 条；"
        f"严格窗口 {args.strict_since} 起 {len(strict)} 条中不一致 {len(strict_bad)} 条；"
        f"记得路径：提前 {payload['next_good_today']['earlier']} / 同日 "
        f"{payload['next_good_today']['same']} / 延后 {payload['next_good_today']['later']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
