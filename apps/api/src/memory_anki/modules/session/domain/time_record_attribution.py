"""Framework-free attribution contract for time records.

A time interval is only useful if it can answer "time spent on *what*". The
original ledger stored just ``session_key`` + ``completion_method``, so every
row looked like ``06:44 学习时段`` and none of it could be totalled per subject.

Four orthogonal dimensions, all optional because not every surface knows all of
them (a dashboard visit has no palace):

- ``subject``  — 学科, sourced from the palace's ``palace_subjects`` link.
- ``chapter``  — 章节, sourced from the palace's ``chapter_palaces`` link.
- ``unit``     — 单元, the palace (and optionally segment) being studied.
- ``scene``    — 场景: 随心 / 宫殿编辑 / 复习 / 做题 / 英语 …
- ``behavior`` — 行为: 翻卡 / 做题 / 编辑 / 查词 …

``palace_id`` is kept as its own field rather than folded into ``unit`` so an
existing numeric key survives renames and stays joinable to the palace table.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Scenes are open-ended across modules, but these are the ones the learner sees.
KNOWN_SCENES = (
    "freestyle",  # 随心
    "palace_edit",  # 宫殿编辑
    "review",  # 复习
    "quiz",  # 做题
    "practice",  # 练习
    "english",  # 英语
    "english_reading",  # 英语阅读
    "dashboard",  # 仪表盘
    "knowledge",  # 知识体系
    "settings",  # 设置
    "custom",  # 其他
)

# The concrete action, independent of which page hosted it.
KNOWN_BEHAVIORS = (
    "flip",  # 翻卡
    "quiz",  # 做题
    "edit",  # 编辑
    "lookup",  # 查词 / 查看宫殿
    "review",  # 复习提交
    "reading",  # 阅读
    "listening",  # 听力
    "browse",  # 浏览
)

SCENE_LABELS = {
    "freestyle": "随心",
    "palace_edit": "宫殿编辑",
    "review": "复习",
    "quiz": "做题",
    "practice": "练习",
    "english": "英语",
    "english_reading": "英语阅读",
    "dashboard": "仪表盘",
    "knowledge": "知识体系",
    "settings": "设置",
    "custom": "其他",
}

BEHAVIOR_LABELS = {
    "flip": "翻卡",
    "quiz": "做题",
    "edit": "编辑",
    "lookup": "查词",
    "review": "复习",
    "reading": "阅读",
    "listening": "听力",
    "browse": "浏览",
}


def _clean(value: Any, *, limit: int) -> str | None:
    """Normalize a free-form label to a trimmed, bounded string."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _positive_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class StudySessionAttribution(BaseModel):
    """Who/what a time interval belongs to, in four independent dimensions."""

    model_config = ConfigDict(extra="ignore")

    # 学科
    subject_id: int | None = None
    subject_name: str | None = Field(default=None, max_length=100)
    # 章节
    chapter_id: int | None = None
    chapter_name: str | None = Field(default=None, max_length=200)
    # 单元: the palace/segment actually being studied.
    unit_label: str | None = Field(default=None, max_length=200)
    palace_id: int | None = None
    palace_segment_id: int | None = None
    # 场景 + 行为
    scene: str | None = Field(default=None, max_length=64)
    behavior: str | None = Field(default=None, max_length=64)

    def normalized(self) -> StudySessionAttribution:
        """Drop blank/zero values so absent attribution stays absent."""
        return StudySessionAttribution(
            subject_id=_positive_int(self.subject_id),
            subject_name=_clean(self.subject_name, limit=100),
            chapter_id=_positive_int(self.chapter_id),
            chapter_name=_clean(self.chapter_name, limit=200),
            unit_label=_clean(self.unit_label, limit=200),
            palace_id=_positive_int(self.palace_id),
            palace_segment_id=_positive_int(self.palace_segment_id),
            scene=_clean(self.scene, limit=64),
            behavior=_clean(self.behavior, limit=64),
        )

    @property
    def has_target(self) -> bool:
        """True when the record names *what* was studied, not just that time passed."""
        normalized = self.normalized()
        return any(
            (
                normalized.subject_id,
                normalized.chapter_id,
                normalized.palace_id,
                normalized.unit_label,
            )
        )

    def as_metadata(self) -> dict[str, Any]:
        """Compact mapping for the ledger ``metadata`` bag (omits empty values)."""
        normalized = self.normalized()
        mapping: dict[str, Any] = {}
        for key in (
            "subject_id",
            "subject_name",
            "chapter_id",
            "chapter_name",
            "unit_label",
            "palace_id",
            "palace_segment_id",
            "scene",
            "behavior",
        ):
            value = getattr(normalized, key)
            if value is not None:
                mapping[key] = value
        return mapping

    @classmethod
    def from_metadata(cls, raw: Any) -> StudySessionAttribution:
        """Read attribution back out of a ledger/store metadata bag."""
        if not isinstance(raw, dict):
            return cls()
        return cls(
            subject_id=raw.get("subject_id"),
            subject_name=raw.get("subject_name"),
            chapter_id=raw.get("chapter_id"),
            chapter_name=raw.get("chapter_name"),
            unit_label=raw.get("unit_label"),
            palace_id=raw.get("palace_id"),
            palace_segment_id=raw.get("palace_segment_id"),
            scene=raw.get("scene"),
            behavior=raw.get("behavior"),
        ).normalized()

    def display_label(self) -> str:
        """Human-readable "学科-章节-单元-场景-行为" chain, skipping absent parts."""
        normalized = self.normalized()
        parts = [
            normalized.subject_name or (f"学科#{normalized.subject_id}" if normalized.subject_id else None),
            normalized.chapter_name or (f"章节#{normalized.chapter_id}" if normalized.chapter_id else None),
            normalized.unit_label,
            SCENE_LABELS.get(normalized.scene or "", normalized.scene),
            BEHAVIOR_LABELS.get(normalized.behavior or "", normalized.behavior),
        ]
        return "-".join(part for part in parts if part)


__all__ = [
    "BEHAVIOR_LABELS",
    "KNOWN_BEHAVIORS",
    "KNOWN_SCENES",
    "SCENE_LABELS",
    "StudySessionAttribution",
]
