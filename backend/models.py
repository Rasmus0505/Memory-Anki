from datetime import datetime, date
from sqlalchemy import (
    create_engine, Column, Integer, String, Text,
    Date, DateTime, Boolean, ForeignKey, Table
)
from sqlalchemy.orm import DeclarativeBase, relationship, Session

from config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


chapter_palace_table = Table(
    "chapter_palaces", Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("chapter_id", Integer, ForeignKey("chapters.id", ondelete="CASCADE")),
    Column("palace_id", Integer, ForeignKey("palaces.id", ondelete="CASCADE")),
)


class Palace(Base):
    __tablename__ = "palaces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, default="")
    description = Column(Text, default="")
    difficulty = Column(Integer, default=3)
    review_mode = Column(String(20), default="flashcard")
    archived = Column(Boolean, default=False)
    mastered = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    pegs = relationship("Peg", back_populates="palace", cascade="all, delete-orphan",
                        primaryjoin="and_(Peg.palace_id==Palace.id, Peg.parent_id==None)",
                        order_by="Peg.sort_order")
    attachments = relationship("Attachment", back_populates="palace", cascade="all, delete-orphan")
    review_schedules = relationship("ReviewSchedule", back_populates="palace", cascade="all, delete-orphan")
    review_logs = relationship("ReviewLog", back_populates="palace", cascade="all, delete-orphan")
    chapters = relationship("Chapter", secondary=chapter_palace_table, back_populates="palaces")


class Peg(Base):
    __tablename__ = "pegs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    palace_id = Column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"))
    parent_id = Column(Integer, ForeignKey("pegs.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), default="")
    content = Column(Text, default="")
    sort_order = Column(Integer, default=0)

    palace = relationship("Palace", back_populates="pegs")
    children = relationship("Peg", back_populates="parent", remote_side=[parent_id],
                            cascade="all, delete-orphan", order_by="Peg.sort_order")
    parent = relationship("Peg", back_populates="children", remote_side=[id])


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    palace_id = Column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"))
    filename = Column(String(300), nullable=False)
    original_name = Column(String(300), nullable=False)
    file_size = Column(Integer, default=0)

    palace = relationship("Palace", back_populates="attachments")


class ReviewSchedule(Base):
    __tablename__ = "review_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    palace_id = Column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"))
    scheduled_date = Column(Date, nullable=False)
    interval_days = Column(Integer, default=0)
    algorithm_used = Column(String(30), default="ebbinghaus")
    completed = Column(Boolean, default=False)
    review_number = Column(Integer, default=0)
    review_type = Column(String(20), default="standard")  # standard / 1h / sleep
    anchor_date = Column(Date, nullable=True)  # 原始锚定日期（用于提前复习策略）

    palace = relationship("Palace", back_populates="review_schedules")


class ReviewLog(Base):
    __tablename__ = "review_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    palace_id = Column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"))
    review_date = Column(Date, default=date.today)
    score = Column(Integer, default=0)
    review_mode = Column(String(20), default="flashcard")
    duration_seconds = Column(Integer, default=0)

    palace = relationship("Palace", back_populates="review_logs")


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(20), default="#6366f1")
    sort_order = Column(Integer, default=0)

    chapters = relationship("Chapter", back_populates="subject", cascade="all, delete-orphan",
                            order_by="Chapter.sort_order")


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"))
    parent_id = Column(Integer, ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    notes = Column(Text, default="")

    subject = relationship("Subject", back_populates="chapters")
    children = relationship("Chapter", back_populates="parent", remote_side=[id],
                            order_by="Chapter.sort_order")
    parent = relationship("Chapter", back_populates="children", remote_side=[parent_id])
    palaces = relationship("Palace", secondary=chapter_palace_table, back_populates="chapters")


class NodeConnection(Base):
    __tablename__ = "node_connections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_type = Column(String(20), nullable=False)  # 'chapter' | 'peg'
    source_id = Column(Integer, nullable=False)
    target_type = Column(String(20), nullable=False)
    target_id = Column(Integer, nullable=False)
    label = Column(String(200), default="")
    style = Column(String(20), default="solid")  # solid | dashed | dotted


class Config(Base):
    __tablename__ = "config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(engine)


def get_session():
    return Session(engine)
