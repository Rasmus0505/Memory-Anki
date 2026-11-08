"""把长期没复习过的已学单元拉回接下来几天。

用法：
    python tools/pull_stale_review_units.py                 # 只预览，不写库
    python tools/pull_stale_review_units.py --apply --progress-stage-index 4
    python tools/pull_stale_review_units.py --apply --weights 30,35,35 --progress-stage-index 4

口径（默认）：
- 「长期没复习」= 连续 15 个学习日（截至今天）没有任何评分记录。
- 只处理**学过**的单元：从来没有评分记录的单元是待学新卡，不存在「提前」。
- 跳过已删除 / 已归档宫殿里的单元：它们不在复习队列里，也解析不出单元定义。
- 同一座宫殿的单元尽量安排在同一天，按内容节点数做 30% / 35% / 35% 的三天分配。
- 可选 `--progress-stage-index 4`：把兼容进度档位设为 14 天档（约 15 天），同时保留分批到期日。

写入走 `adjust_unit_schedule`，只动 due_date / stage_index / fsrs_due_at，不碰 FSRS 记忆参数、不碰 has_passed；
revision 会加一。默认遇到进行中的复习轮次自动跳过，等那轮结束再重跑；确认可以打断时加 `--allow-active-sessions`。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from sqlalchemy import create_engine, event, func  # noqa: E402
from sqlalchemy.engine import URL  # noqa: E402
from sqlalchemy.orm import Session as OrmSession  # noqa: E402

from memory_anki.core.runtime_paths import (  # noqa: E402
    get_app_home,
    resolve_existing_database_file,
)
from memory_anki.core.time import local_day, study_day_of, utc_now_naive  # noqa: E402
from memory_anki.infrastructure.db._tables.misc import StudySession  # noqa: E402
from memory_anki.infrastructure.db._tables.palaces import Palace  # noqa: E402
from memory_anki.infrastructure.db._tables.unit_reviews import (  # noqa: E402
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_review_projection import (  # noqa: E402
    adjust_unit_schedule,
)
from memory_anki.modules.memory.application.unit_scheduler import INTERVAL_DAYS  # noqa: E402

DEFAULT_DAYS_WITHOUT_REVIEW = 15
DEFAULT_WEIGHTS = "30,35,35"
DEFAULT_OUTPUT = REPO_ROOT / "deliverables"


@dataclass
class TargetUnit:
    unit_id: str
    palace_id: int
    palace_title: str
    anchor_uid: str
    unit_kind: str
    node_count: int
    due_before: date
    last_review_day: date
    target_day: date | None = None

    @property
    def change(self) -> str:
        if self.target_day is None:
            return "未安排"
        if self.target_day < self.due_before:
            return "提前"
        if self.target_day > self.due_before:
            return "后移"
        return "不变"


@dataclass
class ExcludedUnit:
    unit_id: str
    palace_id: int
    palace_title: str
    reason: str


@dataclass
class Plan:
    today: date
    window_floor: date
    days: list[date]
    weights: list[float]
    targets: list[TargetUnit] = field(default_factory=list)
    excluded: list[ExcludedUnit] = field(default_factory=list)
    deferred: list[ExcludedUnit] = field(default_factory=list)
    never_rated_active: int = 0

    @property
    def total_nodes(self) -> int:
        return sum(item.node_count for item in self.targets)

    def by_day(self) -> dict[date, list[TargetUnit]]:
        buckets: dict[date, list[TargetUnit]] = defaultdict(list)
        for item in self.targets:
            if item.target_day is not None:
                buckets[item.target_day].append(item)
        return buckets


def _palace_title(palace: Palace) -> str:
    return str(palace.manual_title or palace.title or f"宫殿 {palace.id}")


def _parse_weights(raw: str, spread_days: int) -> list[float]:
    parts = [part.strip() for part in str(raw or "").replace("，", ",").split(",") if part.strip()]
    if len(parts) == 1 and spread_days > 1:
        parts = [parts[0]] * spread_days
    if len(parts) != spread_days:
        raise ValueError(f"weights 需要 {spread_days} 个数字，收到 {len(parts)} 个")
    try:
        values = [float(part) for part in parts]
    except ValueError as exc:
        raise ValueError(f"weights 不是数字：{raw}") from exc
    if any(value < 0 for value in values) or sum(values) <= 0:
        raise ValueError("weights 必须是非负数且总和大于 0")
    return values


def _last_review_days(session: Any) -> dict[str, date]:
    rows = (
        session.query(
            ReviewUnitRatingOperation.unit_id,
            func.max(ReviewUnitRatingOperation.created_at),
        )
        .filter(ReviewUnitRatingOperation.undone_at.is_(None))
        .group_by(ReviewUnitRatingOperation.unit_id)
        .all()
    )
    result: dict[str, date] = {}
    for unit_id, latest in rows:
        if latest is None:
            continue
        if isinstance(latest, str):
            latest = datetime.fromisoformat(latest.replace("Z", "+00:00"))
        result[str(unit_id)] = study_day_of(latest)
    return result


def build_plan(
    session: Any,
    *,
    days_without_review: int = DEFAULT_DAYS_WITHOUT_REVIEW,
    spread_days: int = 3,
    weights: list[float] | None = None,
) -> Plan:
    today = local_day()
    floor = today - timedelta(days=max(1, days_without_review))
    weights = weights or [1.0] * spread_days
    plan = Plan(
        today=today,
        window_floor=floor,
        days=[today + timedelta(days=offset) for offset in range(spread_days)],
        weights=weights,
    )

    last_review = _last_review_days(session)
    palaces = {palace.id: palace for palace in session.query(Palace).all()}
    states = (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.active.is_(True))
        .order_by(ReviewUnitState.palace_id.asc(), ReviewUnitState.id.asc())
        .all()
    )

    for state in states:
        last_day = last_review.get(state.id)
        if last_day is None:
            plan.never_rated_active += 1
            continue
        if last_day >= floor:
            continue
        palace = palaces.get(state.palace_id)
        if palace is None or palace.deleted_at is not None or palace.archived:
            plan.excluded.append(
                ExcludedUnit(
                    unit_id=state.id,
                    palace_id=state.palace_id,
                    palace_title=_palace_title(palace) if palace is not None else f"宫殿 {state.palace_id}",
                    reason="宫殿已删除或归档",
                )
            )
            continue
        node_count = len(json.loads(state.node_uids_json or "[]"))
        plan.targets.append(
            TargetUnit(
                unit_id=state.id,
                palace_id=state.palace_id,
                palace_title=_palace_title(palace),
                anchor_uid=state.anchor_uid,
                unit_kind=state.unit_kind,
                node_count=node_count,
                due_before=state.due_date,
                last_review_day=last_day,
            )
        )

    _assign_days(plan)
    return plan


def _assign_days(plan: Plan) -> None:
    """整宫装桶：宫殿按内容量从大到小，放进剩余容量最大的那一天。"""
    if not plan.targets:
        return
    total = plan.total_nodes
    weight_sum = sum(plan.weights)
    capacity = [total * value / weight_sum for value in plan.weights]
    loads = [0.0] * len(plan.days)

    palace_units: dict[int, list[TargetUnit]] = defaultdict(list)
    palace_nodes: dict[int, int] = defaultdict(int)
    for item in plan.targets:
        palace_units[item.palace_id].append(item)
        palace_nodes[item.palace_id] += item.node_count

    for palace_id in sorted(palace_nodes, key=lambda pid: (-palace_nodes[pid], pid)):
        day_index = max(
            range(len(plan.days)),
            key=lambda index: capacity[index] - loads[index],
        )
        loads[day_index] += palace_nodes[palace_id]
        for item in palace_units[palace_id]:
            item.target_day = plan.days[day_index]


def _defer_palaces(plan: Plan, palace_ids: set[int]) -> None:
    """把正在学习的宫殿从本次写入里拿掉，等这一轮结束再补。"""
    moved = [item for item in plan.targets if item.palace_id in palace_ids]
    if not moved:
        return
    plan.targets = [item for item in plan.targets if item.palace_id not in palace_ids]
    for item in moved:
        plan.deferred.append(
            ExcludedUnit(
                unit_id=item.unit_id,
                palace_id=item.palace_id,
                palace_title=item.palace_title,
                reason="宫殿正在学习，本轮结束后重跑",
            )
        )
    for item in plan.targets:
        item.target_day = None
    _assign_days(plan)


def _active_palace_ids(session: Any, palace_ids: set[int]) -> list[int]:
    if not palace_ids:
        return []
    rows = (
        session.query(StudySession.palace_id)
        .filter(
            StudySession.palace_id.in_(sorted(palace_ids)),
            StudySession.status == "active",
            StudySession.scene.in_(("formal_unit_review", "freestyle_unit_review")),
        )
        .distinct()
        .all()
    )
    return sorted(int(row[0]) for row in rows)


def _backup_database(db_path: Path) -> Path:
    stamp = utc_now_naive().strftime("%Y%m%d-%H%M%S")
    destination = db_path.with_name(f"{db_path.stem}.before-stale-pull-{stamp}.db")
    source = sqlite3.connect(str(db_path))
    try:
        target = sqlite3.connect(str(destination))
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return destination


def _apply_plan(
    session: Any,
    plan: Plan,
    *,
    progress_stage_index: int | None = None,
) -> tuple[list[TargetUnit], list[dict[str, str]]]:
    applied: list[TargetUnit] = []
    failures: list[dict[str, str]] = []
    for item in plan.targets:
        if item.target_day is None:
            continue
        state = session.get(ReviewUnitState, item.unit_id)
        if state is None or not state.active:
            failures.append({"unit_id": item.unit_id, "error": "单元已失效"})
            continue
        if (
            state.due_date == item.target_day
            and (progress_stage_index is None or state.stage_index == progress_stage_index)
        ):
            applied.append(item)
            continue
        try:
            adjust_unit_schedule(
                session,
                unit_id=item.unit_id,
                operation_id=f"stale-pull:{plan.today.isoformat()}:{item.unit_id}",
                due_date=item.target_day,
                reason="stale_days_pull",
            )
            if progress_stage_index is not None:
                state.stage_index = progress_stage_index
            session.commit()
            applied.append(item)
        except Exception as exc:  # noqa: BLE001 - one bad unit must not stop the batch
            session.rollback()
            failures.append({"unit_id": item.unit_id, "error": str(exc)})
    return applied, failures


def _verify(
    plan: Plan,
    session: Any,
    *,
    progress_stage_index: int | None = None,
) -> dict[str, Any]:
    mismatches = []
    for item in plan.targets:
        state = session.get(ReviewUnitState, item.unit_id)
        if state is None:
            mismatches.append({"unit_id": item.unit_id, "actual": "missing"})
        elif item.target_day is not None and (
            state.due_date != item.target_day
            or (
                progress_stage_index is not None
                and state.stage_index != progress_stage_index
            )
        ):
            mismatches.append(
                {
                    "unit_id": item.unit_id,
                    "expected": (
                        f"due={item.target_day.isoformat()}, stage={progress_stage_index}"
                        if progress_stage_index is not None
                        else item.target_day.isoformat()
                    ),
                    "actual": f"due={state.due_date.isoformat()}, stage={state.stage_index}",
                }
            )
    return {"checked": len(plan.targets), "mismatches": mismatches}


def _format_report(
    plan: Plan,
    *,
    applied: bool,
    backup: Path | None,
    failures: list[dict[str, str]],
    verification: dict[str, Any] | None,
    progress_stage_index: int | None = None,
) -> str:
    lines: list[str] = []
    lines.append(f"# 冷落单元提前复习 · {plan.today.isoformat()}")
    lines.append("")
    lines.append("## 结论")
    lines.append("")
    lines.append(
        f"- 截至 {plan.today.isoformat()}，连续 { (plan.today - plan.window_floor).days } 个学习日（{plan.window_floor.isoformat()} 起）没有评分、"
        f"且宫殿仍有效的已学单元：**{len(plan.targets)} 个**，共 {plan.total_nodes} 个内容节点。"
    )
    lines.append(
        f"- 已按内容量分配到 {plan.days[0].isoformat()} 起的 {len(plan.days)} 天："
        + " / ".join(
            f"{day.isoformat()}（{len(plan.by_day().get(day, []))} 个，{sum(item.node_count for item in plan.by_day().get(day, []))} 节点）"
            for day in plan.days
        )
        + "。"
    )
    changes = Counter(item.change for item in plan.targets)
    if changes:
        lines.append(
            "- 相对原到期日："
            + f"提前 {changes.get('提前', 0)} 个"
            + f" / 原已到期、排到后两天 {changes.get('后移', 0)} 个"
            + f" / 不变 {changes.get('不变', 0)} 个。"
        )
    if progress_stage_index is not None:
        stage = max(0, min(progress_stage_index, len(INTERVAL_DAYS) - 1))
        lines.append(
            f"- 进度档位：第 {stage + 1} 档，约 {INTERVAL_DAYS[stage]} 天（展示用；FSRS 记忆参数不因此重置）。"
        )
    if plan.excluded:
        lines.append(f"- 另有 {len(plan.excluded)} 个单元命中了时间条件，但宫殿已删除/归档，未处理。")
    if plan.deferred:
        lines.append(
            f"- 有 {len(plan.deferred)} 个单元所在的宫殿正在学习，已推迟到这一轮结束后补跑。"
        )
    if plan.never_rated_active:
        lines.append(f"- 从没学过的新单元 {plan.never_rated_active} 个不在此次范围内。")
    lines.append("")
    lines.append("## 三天安排")
    lines.append("")
    for day in plan.days:
        items = plan.by_day().get(day, [])
        nodes = sum(item.node_count for item in items)
        palace_ids = sorted({item.palace_id for item in items})
        lines.append(f"### {day.isoformat()} · {len(items)} 个单元 / {nodes} 节点 / {len(palace_ids)} 座宫殿")
        lines.append("")
        lines.append("| 宫殿 | 单元数 | 节点数 | 最早原到期 | 最近一次评分 |")
        lines.append("|---|---:|---:|---|---|")
        grouped: dict[int, list[TargetUnit]] = defaultdict(list)
        for item in items:
            grouped[item.palace_id].append(item)
        for palace_id in sorted(grouped, key=lambda pid: (-sum(i.node_count for i in grouped[pid]), pid)):
            group = grouped[palace_id]
            lines.append(
                f"| {group[0].palace_title} | {len(group)} | {sum(i.node_count for i in group)} | "
                f"{min(i.due_before for i in group).isoformat()} | {max(i.last_review_day for i in group).isoformat()} |"
            )
        lines.append("")
    if plan.excluded:
        lines.append("## 未处理：宫殿已删除/归档")
        lines.append("")
        lines.append("| 宫殿 | 单元数 | 原因 |")
        lines.append("|---|---:|---|")
        excluded_group: dict[int, list[ExcludedUnit]] = defaultdict(list)
        for item in plan.excluded:
            excluded_group[item.palace_id].append(item)
        for palace_id, group in sorted(excluded_group.items()):
            lines.append(f"| {group[0].palace_title} | {len(group)} | {group[0].reason} |")
        lines.append("")
    if plan.deferred:
        lines.append("## 推迟：宫殿正在学习")
        lines.append("")
        lines.append("| 宫殿 | 单元数 | 原因 |")
        lines.append("|---|---:|---|")
        deferred_group: dict[int, list[ExcludedUnit]] = defaultdict(list)
        for item in plan.deferred:
            deferred_group[item.palace_id].append(item)
        for palace_id, group in sorted(deferred_group.items()):
            lines.append(f"| {group[0].palace_title} | {len(group)} | {group[0].reason} |")
        lines.append("")
    lines.append("## 写入说明")
    lines.append("")
    if applied:
        lines.append("- 已写库：到期日按分批计划安排；进度档位按命令设置；不改 FSRS 记忆参数和通过状态。")
        lines.append(f"- 备份：`{backup}`" if backup else "- 备份：无")
        lines.append(f"- 写入成功 {len(plan.targets) - len(failures)} 个，失败 {len(failures)} 个。")
        if failures:
            lines.append("")
            for failure in failures:
                lines.append(f"  - `{failure['unit_id']}`：{failure['error']}")
        if verification:
            lines.append(
                f"- 复核：{verification['checked']} 个单元中不一致 {len(verification['mismatches'])} 个。"
            )
    else:
        lines.append("- 本次是预览，没有写库。确认后加 `--apply` 再运行。")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001 - non-tty streams may not support it
            pass

    parser = argparse.ArgumentParser(description="把长期没复习的已学单元安排到接下来几天")
    parser.add_argument("--database", type=Path, default=None, help="默认使用本机学习数据库")
    parser.add_argument(
        "--days-without-review",
        type=int,
        default=DEFAULT_DAYS_WITHOUT_REVIEW,
        help="连续多少个学习日没有评分算冷落（默认 15）",
    )
    parser.add_argument("--spread-days", type=int, default=3, help="铺开到从今天起几天内（默认 3）")
    parser.add_argument("--weights", default=DEFAULT_WEIGHTS, help="每天的内容量占比（默认 30,35,35）")
    parser.add_argument(
        "--progress-stage-index",
        type=int,
        default=None,
        choices=range(10),
        help="可选：统一进度档位（4=14天档，约15天），到期日仍按三天安排",
    )
    parser.add_argument("--apply", action="store_true", help="备份后真正写库；不加只预览")
    parser.add_argument(
        "--allow-active-sessions",
        action="store_true",
        help="允许在目标宫殿有进行中复习轮次时写库（会打断该轮）",
    )
    parser.add_argument("--output", type=Path, default=None, help="报告路径；默认放到 deliverables/")
    args = parser.parse_args(argv)

    if args.database is not None:
        db_path = Path(args.database)
    else:
        db_path = resolve_existing_database_file(get_app_home())
    if not db_path.exists():
        print(f"数据库不存在：{db_path}", file=sys.stderr)
        return 2

    spread_days = max(1, int(args.spread_days))
    weights = _parse_weights(args.weights, spread_days)
    database_engine = create_engine(
        URL.create("sqlite", database=str(db_path.resolve())),
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    @event.listens_for(database_engine, "connect")
    def _configure_sqlite_connection(connection, _connection_record):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=10000")
    session = OrmSession(database_engine)
    try:
        plan = build_plan(
            session,
            days_without_review=max(1, int(args.days_without_review)),
            spread_days=spread_days,
            weights=weights,
        )
        target_palaces = {item.palace_id for item in plan.targets}
        active_palaces = _active_palace_ids(session, target_palaces)
        if active_palaces and not args.allow_active_sessions:
            _defer_palaces(plan, set(active_palaces))
            print(
                "目标宫殿里有进行中的复习轮次，已推迟："
                + ", ".join(str(pid) for pid in active_palaces)
                + "（这一轮结束后重跑即可补上；确认可以打断时加 --allow-active-sessions）"
            )

        backup: Path | None = None
        failures: list[dict[str, str]] = []
        applied_items: list[TargetUnit] = []
        if args.apply:
            backup = _backup_database(db_path)
            applied_items, failures = _apply_plan(
                session,
                plan,
                progress_stage_index=args.progress_stage_index,
            )
        verification = (
            _verify(
                plan,
                session,
                progress_stage_index=args.progress_stage_index,
            )
            if args.apply
            else None
        )

        report = _format_report(
            plan,
            applied=args.apply,
            backup=backup,
            failures=failures,
            verification=verification,
            progress_stage_index=args.progress_stage_index,
        )
        output = args.output
        if output is None:
            suffix = "" if args.apply else "-预览"
            output = DEFAULT_OUTPUT / f"复习提前-{plan.today.isoformat()}-冷落单元{suffix}.md"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report, encoding="utf-8")

        print(
            ("已写库" if args.apply else "预览")
            + f"：{len(plan.targets)} 个单元 / {plan.total_nodes} 节点"
            + (f"，失败 {len(failures)} 个" if failures else "")
        )
        for day in plan.days:
            items = plan.by_day().get(day, [])
            print(
                f"  {day.isoformat()}：{len(items)} 个单元 / "
                f"{sum(item.node_count for item in items)} 节点 / "
                f"{len({item.palace_id for item in items})} 座宫殿"
            )
        if plan.excluded:
            print(f"  跳过已删除/归档宫殿单元：{len(plan.excluded)} 个")
        if backup:
            print(f"  备份：{backup}")
        print(f"  报告：{output}")
        if applied_items and not failures:
            print("  复核：全部到期日与计划一致")
        return 1 if failures else 0
    finally:
        session.close()
        database_engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
