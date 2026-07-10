"""Mind-map view preferences and recall feedback tables."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class MindMapRecallEvent(Base):
    __tablename__ = "mindmap_recall_events"
    __table_args__ = (
        Index("ix_mindmap_recall_events_palace_node", "palace_id", "node_uid", "occurred_at"),
        Index("ix_mindmap_recall_events_session", "study_session_id", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    study_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    source_scene: Mapped[str] = mapped_column(String(40), nullable=False, default="formal_review")
    recall_round: Mapped[str] = mapped_column(String(20), nullable=False, default="first")
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    supersedes_event_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("mindmap_recall_events.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)


class MindMapNodeLabel(Base):
    __tablename__ = "mindmap_node_labels"
    __table_args__ = (
        UniqueConstraint("palace_id", "node_uid", name="uq_mindmap_node_labels_palace_node"),
        Index("ix_mindmap_node_labels_palace_label", "palace_id", "label"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)
