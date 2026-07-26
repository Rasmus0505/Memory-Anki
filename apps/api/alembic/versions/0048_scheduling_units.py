"""Scheduling units: per-unit waves, consolidation plan items, unit config keys.

调度单元 = 宫殿整体，或永久标记切出的子单元。波次因此需要单元维度，
0043 的"每宫殿至多一个 active 正式波次"唯一索引也要放宽到 (宫殿, 单元)。

Revision ID: 0048_scheduling_units
Revises: 0047_scheduling_kernel
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0048_scheduling_units"
down_revision = "0047_scheduling_kernel"
branch_labels = None
depends_on = None

_ACTIVE_WAVE_INDEX = "uq_review_waves_palace_active_formal"
_FORMAL_DAY_INDEX = "uq_review_waves_palace_formal_day"

NEW_CONFIG_DEFAULTS = {
    "scheduling_unit_mode": "unit",
    "unit_max_pull_ratio": "0.20",
    "unit_max_push_ratio": "0.40",
    "unit_max_retention_drop_pp": "4",
    "unit_min_wave_cards": "3",
    "unit_day_policy": "load_balance",
    "unit_fuzz_max_days": "2",
    "consolidate_enabled": "true",
    "consolidate_floor_days": "3",
    "large_batch_hint_size": "60",
}

# 每日**复习**额度与整批调度冲突：按卡片数截断会把刚拉齐的批次重新切碎。
# 到期就该复习；负载控制改为排期时的 load_balance。
DEAD_CONFIG_KEYS = ("daily_review_limit",)


def _root_uid(editor_doc: str | None) -> str | None:
    """Palace root uid from the stored document (整宫殿单元的键)。"""
    if not editor_doc:
        return None
    try:
        document = json.loads(editor_doc)
    except (TypeError, ValueError):
        return None
    root = document.get("root") if isinstance(document, dict) else None
    if not isinstance(root, dict):
        return None
    data = root.get("data")
    uid = (data or {}).get("uid") if isinstance(data, dict) else None
    return str(uid) if uid else "root"


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "review_waves", sa.Column("unit_root_uid", sa.String(length=128), nullable=True)
    )
    op.create_index(
        "ix_review_waves_palace_unit_date",
        "review_waves",
        ["palace_id", "unit_root_uid", "wave_type", "local_date"],
    )

    # 回填历史正式波次：一律归入宫殿根单元；首次 reconcile_open_waves 会把
    # 落在永久标记区里的项分流到正确单元。
    rows = conn.execute(
        sa.text("SELECT id, editor_doc FROM palaces WHERE deleted_at IS NULL")
    ).fetchall()
    for palace_id, editor_doc in rows:
        root = _root_uid(editor_doc)
        if not root:
            continue
        conn.execute(
            sa.text(
                "UPDATE review_waves SET unit_root_uid = :root"
                " WHERE palace_id = :pid AND wave_type = 'formal_long_term'"
                " AND unit_root_uid IS NULL"
            ),
            {"root": root, "pid": palace_id},
        )

    # 放宽 0043 的两个 partial unique index，键加上单元维度：
    #  - active：同宫殿的不同单元可各自持有进行中的波次
    #  - formal_day：同宫殿的不同单元可在同一天各有一个波次（不放宽会直接
    #    冲突，因为整批调度的常态就是多个单元排到相近的日子）
    op.execute(f"DROP INDEX IF EXISTS {_ACTIVE_WAVE_INDEX}")
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_ACTIVE_WAVE_INDEX} "
        "ON review_waves (palace_id, unit_root_uid) "
        "WHERE wave_type = 'formal_long_term' AND status IN ('active', 'paused')"
    )
    op.execute(f"DROP INDEX IF EXISTS {_FORMAL_DAY_INDEX}")
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_FORMAL_DAY_INDEX} "
        "ON review_waves (palace_id, unit_root_uid, local_date) "
        "WHERE wave_type = 'formal_long_term' AND local_date IS NOT NULL "
        "AND status IN ('scheduled', 'active', 'paused')"
    )

    # review_daily_plan_items.kind 要装下 'consolidate'（11 字符）。SQLite 的
    # VARCHAR(n) 只是类型亲和、不强制长度，所以这里无需 alter_column——ORM 侧
    # 已声明 String(16)，全新安装（create_all）直接就是宽的。

    # 单元模式的三态用**新增列**表达，避免把 aggregation_enabled 改成 nullable
    # 这种破坏性变更：NULL = 未表态（跟随全局，默认整批），'unit'/'card' = 显式。
    op.add_column(
        "palace_review_settings",
        sa.Column("scheduling_unit_mode_override", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "palace_review_settings",
        sa.Column("unit_min_wave_cards_override", sa.Integer(), nullable=True),
    )
    # 曾显式开启聚合的宫殿 → 显式整批；历史默认值 0 是"从未表态"，留 NULL 跟随全局。
    conn.execute(
        sa.text(
            "UPDATE palace_review_settings SET scheduling_unit_mode_override = 'unit'"
            " WHERE aggregation_enabled = 1"
        )
    )

    for key in DEAD_CONFIG_KEYS:
        conn.execute(sa.text("DELETE FROM config WHERE key = :key"), {"key": key})
    for key, value in NEW_CONFIG_DEFAULTS.items():
        exists = conn.execute(
            sa.text("SELECT 1 FROM config WHERE key = :key"), {"key": key}
        ).first()
        if exists is None:
            conn.execute(
                sa.text(
                    "INSERT INTO config (key, value, updated_at)"
                    " VALUES (:key, :value, CURRENT_TIMESTAMP)"
                ),
                {"key": key, "value": value},
            )
    # 逐卡 fuzz 会主动打散同单元的卡，与整批调度冲突；改用单元级日期排布。
    conn.execute(
        sa.text(
            "UPDATE config SET value = 'false', updated_at = CURRENT_TIMESTAMP"
            " WHERE key = 'enable_fuzzing'"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    for key in NEW_CONFIG_DEFAULTS:
        conn.execute(sa.text("DELETE FROM config WHERE key = :key"), {"key": key})

    op.drop_column("palace_review_settings", "unit_min_wave_cards_override")
    op.drop_column("palace_review_settings", "scheduling_unit_mode_override")

    op.execute(f"DROP INDEX IF EXISTS {_ACTIVE_WAVE_INDEX}")
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_ACTIVE_WAVE_INDEX} "
        "ON review_waves (palace_id) "
        "WHERE wave_type = 'formal_long_term' AND status IN ('active', 'paused')"
    )
    op.execute(f"DROP INDEX IF EXISTS {_FORMAL_DAY_INDEX}")
    op.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_FORMAL_DAY_INDEX} "
        "ON review_waves (palace_id, local_date) "
        "WHERE wave_type = 'formal_long_term' AND local_date IS NOT NULL "
        "AND status IN ('scheduled', 'active', 'paused')"
    )
    op.drop_index("ix_review_waves_palace_unit_date", table_name="review_waves")
    op.drop_column("review_waves", "unit_root_uid")
