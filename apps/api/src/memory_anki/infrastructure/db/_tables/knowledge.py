"""Knowledge domain ORM tables: subjects, subject documents, chapters, node connections."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from memory_anki.core.time import utc_now_naive

from ._base import Base
from .palaces import Palace, chapter_palace_table


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    editor_doc: Mapped[str] = mapped_column(Text, default="")
    editor_config: Mapped[str] = mapped_column(Text, default="")
    editor_local_config: Mapped[str] = mapped_column(Text, default="")

    chapters: Mapped[list[Chapter]] = relationship(
        "Chapter",
        back_populates="subject",
        cascade="all, delete-orphan",
        order_by="Chapter.sort_order",
    )
    documents: Mapped[list[SubjectDocument]] = relationship(
        "SubjectDocument",
        back_populates="subject",
        cascade="all, delete-orphan",
        order_by="SubjectDocument.created_at.desc()",
    )


class SubjectDocument(Base):
    __tablename__ = "subject_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)

    subject: Mapped[Subject] = relationship("Subject", back_populates="documents")


class Chapter(Base):
    __tablename__ = "chapters"

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


class NodeConnection(Base):
    __tablename__ = "node_connections"
    __table_args__ = (
        Index(
            "ix_node_connections_style_source",
            "style",
            "source_type",
            "source_id",
        ),
        Index(
            "ix_node_connections_style_target",
            "style",
            "target_type",
            "target_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="")
    style: Mapped[str] = mapped_column(String(20), default="solid")
