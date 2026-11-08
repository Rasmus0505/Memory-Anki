"""把冷落批次真正拉回「14 天档」：校准 FSRS 记忆强度，而不只是改显示档位。

背景
----
`stage_index` 只是到期日的展示分桶，评分时真正说话的是 FSRS 记忆状态。
上一轮批量提前只写了 `stage_index=4`，于是面板显示「等级 5 · 14–29天」，
但一点「记得」仍会按旧的稳定度（20–280 天）外推，再被考试地平线压到同一天，
看起来像「一评分就跳 41 天」。

这个脚本做三件事（只针对指定批次）：

1. 把到期日早于「上次评分日」的不一致行修正到期（合并整宫继承了一个
   从没学过片段的旧到期日），否则界面会把间隔算成 0 而标成「首学」。
2. 反解 FSRS 稳定度：让该单元在自己的到期日点「记得」时，排期正好落回
   14 天档（下一次约 14–15 天后），难度等其它记忆参数保持原样。
3. 关掉这些单元上未评分的旧会话快照，避免下一次点开时用旧 baseline 覆盖。

默认只预览；`--apply` 才写库，并在写库前做一次 SQLite 完整备份。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from sqlalchemy import create_engine, event  # noqa: E402
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
    ReviewUnitEncounter,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_fsrs_adapter import (  # noqa: E402
    FsrsUnitState,
    rate_unit_with_fsrs,
)
from memory_anki.modules.memory.application.unit_review_service import (  # noqa: E402
    _SPRINT_HORIZON_KEY,
    _sprint_horizon,
)
from memory_anki.modules.memory.application.unit_scheduler import INTERVAL_DAYS  # noqa: E402

TARGET_STAGE = 4
TARGET_DAYS = INTERVAL_DAYS[TARGET_STAGE]  # 14
DEFAULT_OUTPUT = Path("deliverables") / "复习进度校准-14天档-2026-11-08.md"
BATCH_DAYS = (date(2026, 11, 7), date(2026, 11, 8), date(2026, 11, 9))
BATCH_CUTOFF = date(2026, 11, 7)


@dataclass
class Target:
    unit_id: str
    palace_id: int
    palace_title: str
    due_date: date
    fixed_due_from: date | None
    last_review: datetime
    last_review_after: datetime
    difficulty: float
    stability_before: float | None
    stability_after: float | None = None
    good_days: int | None = None
    easy_days: int | None = None
    rated: bool = False

    @property
    def interval_before(self) -> int:
        return max(0, (self.due_date - study_day_of(self.last_review)).days)

    @property
    def interval_after(self) -> int:
        return max(0, (self.due_date - study_day_of(self.last_review_after)).days)


def _palace_title(palace: Palace | None) -> str:
    if palace is None:
        return "未知宫殿"
    return str(getattr(palace, "title", "") or f"宫殿 {palace.id}")


def _difficulty(row: ReviewUnitState) -> float:
    value = row.fsrs_difficulty
    return float(value) if value is not None else 5.0


def _horizon_for(session: OrmSession, day: date):
    session.info.pop(_SPRINT_HORIZON_KEY, None)
    return _sprint_horizon(session, day)


def _project(
    *,
    unit_id: str,
    row: ReviewUnitState,
    due: date,
    stability: float,
    difficulty: float,
    rating: int,
    horizon: Any,
    last_review: datetime,
) -> int:
    """在 due 当天评分后，这次评分真正会排到的间隔（天）。"""
    state = FsrsUnitState(
        stability=stability,
        difficulty=difficulty,
        fsrs_state=int(row.fsrs_state or 2),
        step=row.fsrs_step,
        due_at=datetime.combine(due, time(4)),
        last_review=last_review,
    )
    previous = max(0, (due - study_day_of(last_review)).days)
    result = rate_unit_with_fsrs(
        current=state,
        has_passed=bool(row.has_passed),
        rating=rating,
        today=due,
        rated_at=datetime.combine(due, time(4)),
        schedule_locked=False,
        locked_due_date=due,
        fuzz_key=unit_id,
        horizon=horizon,
        previous_interval_days=previous,
        current_stage=int(row.stage_index),
        early_step=row.early_step if row.early_step is not None else 1,
        lapse_original_days=row.lapse_original_interval_days,
        lapse_started_on=row.lapse_started_on,
    )
    return max(0, (result.due_date - due).days)


def _solve_stability(
    *, unit_id: str, row: ReviewUnitState, due: date, last_review: datetime, horizon: Any
) -> tuple[float, int, int]:
    """找让「记得」刚好落回 14 天档的稳定度；间隔随稳定度单调增。"""
    difficulty = _difficulty(row)
    low, high = 0.05, 60.0
    best: tuple[int, float] | None = None
    for _ in range(70):
        mid = (low + high) / 2
        days = _project(
            unit_id=unit_id, row=row, due=due, stability=mid,
            difficulty=difficulty, rating=3, horizon=horizon, last_review=last_review,
        )
        if best is None or abs(days - TARGET_DAYS) < abs(best[0] - TARGET_DAYS):
            best = (days, mid)
        if days < TARGET_DAYS:
            low = mid
        else:
            high = mid
    assert best is not None
    chosen_days, chosen_stability = best
    easy_days = _project(
        unit_id=unit_id, row=row, due=due, stability=chosen_stability,
        difficulty=difficulty, rating=4, horizon=horizon, last_review=last_review,
    )
    return round(chosen_stability, 4), chosen_days, easy_days


def _original_batch_ids(db_path: Path) -> set[str]:
    """从「提前复习」之前的备份里还原那 97 个批次单元。"""
    candidates = sorted(db_path.parent.glob(f"{db_path.stem}.before-stale-pull-*.db"))
    if not candidates:
        return set()
    backup = sqlite3.connect(str(candidates[-1]))
    try:
        backup.row_factory = sqlite3.Row
        palaces = {
            row["id"]: row
            for row in backup.execute("select id, deleted_at, archived from palaces")
        }
        last_ops = {
            row["unit_id"]: row["latest"]
            for row in backup.execute(
                "select unit_id, max(created_at) as latest from review_unit_rating_operations "
                "where undone_at is null group by unit_id"
            )
        }
        ids: set[str] = set()
        for row in backup.execute(
            "select id, palace_id from review_unit_states where active = 1 and has_passed = 1"
        ):
            palace = palaces.get(row["palace_id"])
            if palace is None or palace["deleted_at"] is not None or palace["archived"]:
                continue
            latest = last_ops.get(row["id"])
            if latest is None:
                continue
            if study_day_of(datetime.fromisoformat(str(latest).replace("Z", ""))) >= BATCH_CUTOFF:
                continue
            ids.add(row["id"])
        return ids
    finally:
        backup.close()


def build_rated_targets(
    session: OrmSession, db_path: Path
) -> tuple[list[Target], list[dict[str, str]]]:
    """批次里「已经评过分」的单元：评分后跳出了 14 天档，同样拉回来。

    这些单元在提前复习后已经被真实评分过，所以不改上次评分时间：到期日直接取
    「上次评分 + 14 天」，让它们真的在 14 天后回来。
    """
    today = local_day()
    batch_ids = _original_batch_ids(db_path)
    if not batch_ids:
        return [], [{"unit_id": "-", "reason": "找不到提前复习前的备份，跳过已评分单元"}]
    active_palaces = {
        int(pid)
        for (pid,) in session.query(StudySession.palace_id)
        .filter(
            StudySession.status == "active",
            StudySession.scene.in_(("formal_unit_review", "freestyle_unit_review")),
        )
        .all()
    }
    palaces = {p.id: p for p in session.query(Palace).all()}
    targets: list[Target] = []
    skipped: list[dict[str, str]] = []
    for row in (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.active.is_(True), ReviewUnitState.id.in_(batch_ids))
        .all()
    ):
        if row.fsrs_last_review is None:
            continue
        reviewed_on = study_day_of(row.fsrs_last_review)
        if reviewed_on < BATCH_CUTOFF:
            continue
        palace = palaces.get(row.palace_id)
        if palace is None or palace.deleted_at is not None or palace.archived:
            skipped.append({"unit_id": row.id, "reason": "宫殿已删除或归档"})
            continue
        if row.palace_id in active_palaces:
            skipped.append({"unit_id": row.id, "reason": "宫殿正在学习"})
            continue
        due = reviewed_on + timedelta(days=TARGET_DAYS)
        if due <= today:
            due = today + timedelta(days=TARGET_DAYS)
        current_interval = max(0, (row.due_date - reviewed_on).days)
        if current_interval < INTERVAL_DAYS[TARGET_STAGE + 1] and row.stage_index <= TARGET_STAGE:
            continue  # 仍在本档或更低：这是正常的近期评分，不动

        targets.append(
            Target(
                unit_id=row.id,
                palace_id=row.palace_id,
                palace_title=_palace_title(palace),
                due_date=due,
                fixed_due_from=row.due_date,
                last_review=row.fsrs_last_review,
                last_review_after=row.fsrs_last_review,
                difficulty=_difficulty(row),
                stability_before=row.fsrs_stability,
                rated=True,
            )
        )
    return targets, skipped


def build_targets(session: OrmSession) -> tuple[list[Target], list[dict[str, str]]]:
    today = local_day()
    active_palaces = {
        int(pid)
        for (pid,) in session.query(StudySession.palace_id)
        .filter(
            StudySession.status == "active",
            StudySession.scene.in_(("formal_unit_review", "freestyle_unit_review")),
        )
        .all()
    }
    palaces = {p.id: p for p in session.query(Palace).all()}
    targets: list[Target] = []
    skipped: list[dict[str, str]] = []

    rows = (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.active.is_(True))
        .all()
    )
    seen: set[str] = set()
    for row in rows:
        if row.fsrs_last_review is None:
            continue
        reviewed_on = study_day_of(row.fsrs_last_review)
        incoherent = row.due_date < reviewed_on
        in_batch = (
            row.stage_index in (0, TARGET_STAGE)
            and bool(row.has_passed)
            and row.due_date in BATCH_DAYS
            and reviewed_on < BATCH_CUTOFF
        )
        if not (incoherent or in_batch):
            continue
        if row.id in seen:
            continue
        if row.stage_index == TARGET_STAGE and (row.due_date - reviewed_on).days == TARGET_DAYS:
            continue  # 已经是 14 天档，重跑不重复写
        palace = palaces.get(row.palace_id)
        if palace is None or palace.deleted_at is not None or palace.archived:
            skipped.append({"unit_id": row.id, "reason": "宫殿已删除或归档"})
            continue
        if row.palace_id in active_palaces:
            skipped.append({"unit_id": row.id, "reason": "宫殿正在学习"})
            continue
        due = row.due_date
        fixed_from: date | None = None
        if incoherent:
            # 到期日落在上次评分之前：合并时继承了从没学过片段的旧日期。
            # 现在就该看到，所以回到今天；间隔随之变成「上次评分 → 今天」的真实值。
            fixed_from = due
            due = today
        seen.add(row.id)
        # 进度 = 到期日 − 上次评分日。要让「进度」真的停在 14 天档，就把这条
        # 已持有的间隔对齐到 14 天；否则「困难」还会按旧的 30+ 天区间封底，
        # 出现「困难比记得还久」的自相矛盾。
        rebaselined_review = datetime.combine(due - timedelta(days=TARGET_DAYS), time(4))
        targets.append(
            Target(
                unit_id=row.id,
                palace_id=row.palace_id,
                palace_title=_palace_title(palace),
                due_date=due,
                fixed_due_from=fixed_from,
                last_review=row.fsrs_last_review,
                last_review_after=rebaselined_review,
                difficulty=_difficulty(row),
                stability_before=row.fsrs_stability,
            )
        )
    return targets, skipped


def _backup_database(db_path: Path) -> Path:
    stamp = utc_now_naive().strftime("%Y%m%d-%H%M%S")
    destination = db_path.with_name(f"{db_path.stem}.before-rebaseline-14d-{stamp}.db")
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


def _apply(session: OrmSession, targets: list[Target]) -> list[dict[str, str]]:
    failures: list[dict[str, str]] = []
    now = utc_now_naive()
    for item in targets:
        row = session.get(ReviewUnitState, item.unit_id)
        if row is None or not row.active:
            failures.append({"unit_id": item.unit_id, "error": "单元已失效"})
            continue
        try:
            row.due_date = item.due_date
            row.stage_index = TARGET_STAGE
            row.fsrs_stability = item.stability_after
            row.fsrs_state = int(row.fsrs_state or 2)
            row.fsrs_step = None
            row.fsrs_last_review = item.last_review_after
            row.fsrs_due_at = datetime.combine(item.due_date, time(4))
            if row.early_step is None:
                row.early_step = 1
            row.revision += 1
            # 旧会话快照会冻结修复前的记忆状态，下一次点开会把它写回去。
            (
                session.query(ReviewUnitEncounter)
                .filter(
                    ReviewUnitEncounter.unit_id == item.unit_id,
                    ReviewUnitEncounter.status == "open",
                )
                .update(
                    {
                        ReviewUnitEncounter.status: "closed",
                        ReviewUnitEncounter.closed_at: now,
                    },
                    synchronize_session=False,
                )
            )
            session.commit()
        except Exception as exc:  # noqa: BLE001 - one bad unit must not stop the batch
            session.rollback()
            failures.append({"unit_id": item.unit_id, "error": str(exc)})
    return failures


def _verify(session: OrmSession, targets: list[Target]) -> list[dict[str, str]]:
    mismatches: list[dict[str, str]] = []
    for item in targets:
        row = session.get(ReviewUnitState, item.unit_id)
        if row is None:
            mismatches.append({"unit_id": item.unit_id, "actual": "missing"})
            continue
        if row.due_date != item.due_date or row.stage_index != TARGET_STAGE:
            mismatches.append(
                {
                    "unit_id": item.unit_id,
                    "expected": f"{item.due_date} / {TARGET_STAGE}",
                    "actual": f"{row.due_date} / {row.stage_index}",
                }
            )
            continue
        days = _project(
            unit_id=row.id, row=row, due=row.due_date,
            stability=float(row.fsrs_stability or 0), difficulty=_difficulty(row),
            rating=3, horizon=_horizon_for(session, row.due_date),
            last_review=row.fsrs_last_review,
        )
        if abs(days - TARGET_DAYS) > 1:
            mismatches.append(
                {
                    "unit_id": item.unit_id,
                    "expected": f"记得≈{TARGET_DAYS}天",
                    "actual": f"{days}天",
                }
            )
    return mismatches


def _format_report(
    targets: list[Target],
    *,
    skipped: list[dict[str, str]],
    applied: bool,
    backup: Path | None,
    failures: list[dict[str, str]],
    mismatches: list[dict[str, str]],
) -> str:
    lines = ["# 复习进度校准 · 14 天档 · 2026-11-08", ""]
    lines.append(
        f"- 批次单元：**{len(targets)} 个**；把「记得」的下一次排期校准到 **{TARGET_DAYS} 天档**"
        f"（当前 `INTERVAL_DAYS[4] = {TARGET_DAYS}`）。"
    )
    lines.append(
        "- 做法：把已持有间隔对齐到 14 天（`上次评分 = 到期日 − 14`），再按单元自己的到期日反解 FSRS 稳定度，"
        "让「记得」正好落回 14–15 天、`困难` 落回 11–14 天；难度与通过状态不动。"
    )
    rated = [t for t in targets if t.rated]
    if rated:
        lines.append(
            f"- 其中 {len(rated)} 个是**已经评过分**的批次单元：评分后跳出了 14 天档，"
            "现在按「上次评分 + 14 天」重新排回本档，上次评分时间保持真实。"
        )
    fixed = [t for t in targets if t.fixed_due_from is not None]
    if fixed:
        lines.append(
            f"- {len(fixed)} 个单元的到期日被重排："
            + "、".join(f"{t.palace_title}（{t.fixed_due_from} → {t.due_date}）" for t in fixed)
            + "。"
        )
    if skipped:
        lines.append(f"- 跳过 {len(skipped)} 个：宫殿正在学习或已删除/归档。")
    lines.append("")
    lines.append("## 明细")
    lines.append("")
    lines.append("| 宫殿 | 到期日 | 间隔 前 → 后 | 稳定度 前 → 后 | 记得 | 轻松 |")
    lines.append("|---|---:|---:|---|---:|---:|")
    for item in sorted(targets, key=lambda t: (t.due_date, t.palace_title, t.unit_id)):
        lines.append(
            f"| {item.palace_title} | {item.due_date.isoformat()} | "
            f"{item.interval_before} → {item.interval_after} | "
            f"{(item.stability_before or 0):.2f} → {(item.stability_after or 0):.2f} | "
            f"{item.good_days} 天 | {item.easy_days} 天 |"
        )
    lines.append("")
    lines.append("## 写入")
    lines.append("")
    if applied:
        lines.append(f"- 已写库 {len(targets) - len(failures)} 个，失败 {len(failures)} 个。")
        lines.append(f"- 备份：`{backup}`" if backup else "- 备份：无")
        lines.append(
            f"- 复核：{len(targets)} 个单元中，到期日/档位或「记得」间隔不符 {len(mismatches)} 个。"
        )
        for failure in failures:
            lines.append(f"  - `{failure['unit_id']}`：{failure['error']}")
        for mismatch in mismatches:
            lines.append(f"  - `{mismatch['unit_id']}`：{mismatch.get('actual')}")
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

    parser = argparse.ArgumentParser(description="把冷落批次校准到 14 天档（真正影响评分）")
    parser.add_argument("--database", type=Path, default=None)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    db_path = Path(args.database) if args.database else resolve_existing_database_file(get_app_home())
    if not db_path.exists():
        print(f"数据库不存在：{db_path}", file=sys.stderr)
        return 2

    engine = create_engine(
        URL.create("sqlite", database=str(db_path.resolve())),
        connect_args={"check_same_thread": False, "timeout": 10},
    )

    @event.listens_for(engine, "connect")
    def _configure(connection, _record):  # noqa: ANN001 - SQLAlchemy hook
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")

    failures: list[dict[str, str]] = []
    mismatches: list[dict[str, str]] = []
    backup: Path | None = None
    with OrmSession(engine) as session:
        targets, skipped = build_targets(session)
        rated_targets, rated_skipped = build_rated_targets(session, db_path)
        known = {item.unit_id for item in targets}
        targets.extend(item for item in rated_targets if item.unit_id not in known)
        skipped.extend(rated_skipped)
        for item in targets:
            row = session.get(ReviewUnitState, item.unit_id)
            assert row is not None
            stability, good_days, easy_days = _solve_stability(
                unit_id=row.id, row=row, due=item.due_date,
                last_review=item.last_review_after,
                horizon=_horizon_for(session, item.due_date),
            )
            item.stability_after = stability
            item.good_days = good_days
            item.easy_days = easy_days
        if args.apply and targets:
            backup = _backup_database(db_path)
            failures = _apply(session, targets)
            mismatches = _verify(session, targets)

    report = _format_report(
        targets, skipped=skipped, applied=args.apply, backup=backup,
        failures=failures, mismatches=mismatches,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
