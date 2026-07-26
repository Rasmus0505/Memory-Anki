"""FSRS 参数集读取：激活的个性化权重（优化器产出）或 None（官方默认）。"""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ActiveParameterSet:
    set_id: str
    weights: tuple[float, ...]


def load_active_parameter_set(session: Session) -> ActiveParameterSet | None:
    """Return the active optimized parameter set, or None to use defaults.

    迁移 0047 之前表不存在；查询失败一律回退默认参数，不阻断评分。
    """
    try:
        from memory_anki.infrastructure.db._tables.reviews import FsrsParameterSet
    except ImportError:
        return None
    try:
        row = (
            session.query(FsrsParameterSet)
            .filter(FsrsParameterSet.status == "active")
            .order_by(FsrsParameterSet.activated_at.desc())
            .first()
        )
    except Exception:
        return None
    if row is None or not row.weights_json:
        return None
    try:
        weights = tuple(float(w) for w in json.loads(row.weights_json))
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not weights:
        return None
    return ActiveParameterSet(set_id=str(row.id), weights=weights)
