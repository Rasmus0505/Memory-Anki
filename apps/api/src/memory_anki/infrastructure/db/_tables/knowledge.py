"""Knowledge domain ORM tables: subjects and chapters."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ._base import Base
from .palaces import Palace, chapter_palace_table, palace_subject_table


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    editor_doc: Mapped[str] = mapped_column(Text, default="")
    editor_config: Mapped[str] = mapped_column(Text, default="")
    editor_local_config: Mapped[str] = mapped_column(Text, default="")

    palaces: Mapped[list[Palace]] = relationship(
        "Palace",
        secondary=palace_subject_table,
        back_populates="subjects",
    )
    chapters: Mapped[list[Chapter]] = relationship(
        "Chapter",
        back_populates="subject",
        cascade="all, delete-orphan",
        order_by="Chapter.sort_order",
    )


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (
        Index("ix_chapters_subject_sort", "subject_id", "sort_order"),
        Index("ix_chapters_parent_sort", "parent_id", "sort_order"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
    )
    parent_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")

    subject: Mapped[Subject] = relationship("Subject", back_populates="chapters")
    children: Mapped[list[Chapter]] = relationship(
        "Chapter",
        back_populates="parent",
        order_by="Chapter.sort_order",
    )
    parent: Mapped[Chapter | None] = relationship(
        "Chapter",
        back_populates="children",
        remote_side="Chapter.id",
    )
    palaces: Mapped[list[Palace]] = relationship(
        "Palace",
        secondary=chapter_palace_table,
        back_populates="chapters",
    )
