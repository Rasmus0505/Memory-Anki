"""调度单元解析：宫殿整体，或按永久标记切出的子单元。

单元是「一次复习安排」的原子——同一单元的卡向共同的复习日收敛，不同单元
各自独立。永久标记因此从「只管随心队列的切分」升级为真正的调度边界。

单元键 = ``(palace_id, unit_root_uid)``；``unit_root_uid`` 是永久标记节点的
uid，整宫殿/残余单元用宫殿根 uid。键随用户增删标记而变，用读时调和
（``reconcile_open_waves``）处理，不做键迁移脚本。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.modules.mindmap_document.api import (
    UNIT_KIND_PALACE,
    permanent_mark_uids_from_nodes,
    split_scheduling_units,
)

_CACHE_KEY = "_scheduling_units_cache"


@dataclass(frozen=True)
class SchedulingUnit:
    palace_id: int
    unit_root_uid: str
    kind: str
    title: str
    node_uids: frozenset[str]
    # 文档 DFS 先序，供冻结集排序（复习顺序：根→一级从上到下→分支内深度优先）
    order: tuple[str, ...]

    @property
    def node_count(self) -> int:
        return len(self.order)


def _build_units(session: Session, palace_id: int) -> dict[str, SchedulingUnit]:
    from memory_anki.infrastructure.db._tables.palaces import Palace
    from memory_anki.modules.memory.application.node_memory_projection import _tree

    palace = session.get(Palace, int(palace_id))
    if palace is None or palace.deleted_at is not None:
        return {}
    root_uid, nodes = _tree(palace)
    if not root_uid:
        return {}
    mark_uids = permanent_mark_uids_from_nodes(nodes, root_uid=root_uid)
    units: dict[str, SchedulingUnit] = {}
    for split in split_scheduling_units(
        nodes=nodes, root_uid=root_uid, permanent_mark_uids=mark_uids
    ):
        # 残余单元与整宫殿单元共用宫殿根 uid：同一宫殿最多一个，合并即可。
        existing = units.get(split.unit_root_uid)
        order = (
            existing.order + split.node_uids if existing is not None else split.node_uids
        )
        units[split.unit_root_uid] = SchedulingUnit(
            palace_id=int(palace_id),
            unit_root_uid=split.unit_root_uid,
            kind=existing.kind if existing is not None else split.kind,
            title=split.title,
            node_uids=frozenset(order),
            order=order,
        )
    return units


def resolve_units(session: Session, palace_id: int) -> dict[str, SchedulingUnit]:
    """该宫殿的调度单元（unit_root_uid -> 单元），按请求生命周期缓存。"""
    cache = session.info.setdefault(_CACHE_KEY, {})
    cached = cache.get(int(palace_id))
    if cached is None:
        cached = _build_units(session, int(palace_id))
        cache[int(palace_id)] = cached
    return cached


def resolve_units_batch(
    session: Session, palace_ids: list[int] | set[int] | tuple[int, ...]
) -> dict[int, dict[str, SchedulingUnit]]:
    return {int(pid): resolve_units(session, int(pid)) for pid in palace_ids}


def unit_of_node(
    session: Session, palace_id: int, node_uid: str
) -> SchedulingUnit | None:
    for unit in resolve_units(session, palace_id).values():
        if node_uid in unit.node_uids:
            return unit
    return None


def unit_root_uid_of_node(session: Session, palace_id: int, node_uid: str) -> str | None:
    unit = unit_of_node(session, palace_id, node_uid)
    return unit.unit_root_uid if unit is not None else None


def default_unit_root_uid(session: Session, palace_id: int) -> str | None:
    """整宫殿单元的键（无永久标记时唯一的单元）。"""
    units = resolve_units(session, palace_id)
    for unit in units.values():
        if unit.kind == UNIT_KIND_PALACE:
            return unit.unit_root_uid
    return next(iter(units), None)


def invalidate_units_cache(session: Session, palace_id: int | None = None) -> None:
    cache = session.info.get(_CACHE_KEY)
    if cache is None:
        return
    if palace_id is None:
        cache.clear()
    else:
        cache.pop(int(palace_id), None)


def units_payload(units: dict[str, SchedulingUnit]) -> list[dict[str, Any]]:
    return [
        {
            "unit_root_uid": unit.unit_root_uid,
            "kind": unit.kind,
            "title": unit.title,
            "node_count": unit.node_count,
        }
        for unit in units.values()
    ]


def reconcile_open_waves(
    session: Session, palace_id: int, *, now: datetime | None = None
) -> int:
    """把开放波次里归错单元的项迁到正确单元的同日波次。

    单元定义会随用户增删永久标记而变。ACTIVE/PAUSED 波次不动——冻结集不可变
    是既有不变量，进行中的会话按旧单元跑完，结算后的下一次调和归位。
    """
    from memory_anki.infrastructure.db._tables.reviews import ReviewWave, ReviewWaveItem
    from memory_anki.modules.memory.application.wave_policy import (
        ITEM_PENDING,
        WAVE_STATUS_SCHEDULED,
        WAVE_TYPE_FORMAL,
    )
    from memory_anki.modules.memory.application.wave_service import (
        close_empty_open_wave,
        get_or_create_formal_wave,
    )

    units = resolve_units(session, palace_id)
    if not units:
        return 0
    node_to_unit = {
        uid: unit.unit_root_uid for unit in units.values() for uid in unit.node_uids
    }
    waves = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_FORMAL,
            ReviewWave.status == WAVE_STATUS_SCHEDULED,
        )
        .all()
    )
    if not waves:
        return 0
    moved = 0
    now_naive = now or utc_now_naive()
    for wave in waves:
        if wave.local_date is None:
            continue
        items = (
            session.query(ReviewWaveItem)
            .filter(
                ReviewWaveItem.wave_id == wave.id,
                ReviewWaveItem.status == ITEM_PENDING,
            )
            .all()
        )
        for item in items:
            target_unit = node_to_unit.get(item.node_uid)
            if target_unit is None or target_unit == wave.unit_root_uid:
                continue
            target_wave = get_or_create_formal_wave(
                session, palace_id, wave.local_date, unit_root_uid=target_unit
            )
            if target_wave.id == wave.id:
                continue
            item.wave_id = target_wave.id
            item.updated_at = now_naive
            wave.item_count = max(0, int(wave.item_count or 0) - 1)
            target_wave.item_count = int(target_wave.item_count or 0) + 1
            wave.updated_at = now_naive
            target_wave.updated_at = now_naive
            moved += 1
    if moved:
        session.flush()
        for wave in waves:
            close_empty_open_wave(session, wave)
        session.flush()
    return moved
