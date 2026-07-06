from __future__ import annotations

import importlib.util
import unittest
from datetime import datetime, time, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db._tables._base import _configure_sqlite_pragmas
from memory_anki.infrastructure.db.models import (
    Attachment,
    Base,
    Chapter,
    Palace,
    PalaceMiniPalace,
    PalaceQuizQuestion,
    Peg,
    ReviewLog,
    ReviewSchedule,
    StudySession,
    Subject,
    chapter_palace_table,
)
from memory_anki.modules.dashboard.application.service import _dashboard_review_unit_counts
from memory_anki.modules.palaces.application.palace_service import restore_archived_palaces
from memory_anki.modules.sessions.application.study_session_service import (
    STUDY_DASHBOARD_SCENES,
    get_all_time_study_session_duration_seconds,
    get_study_session_duration_seconds,
)


class DatabasePerformanceOptimizationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_performance_indexes_are_declared_on_orm_tables(self):
        self.assertEqual(_index_columns(Palace, "ix_palaces_updated_at"), ["updated_at"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_created_at_id"), ["created_at", "id"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_primary_chapter_id"), ["primary_chapter_id"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_mastered_archived"), ["mastered", "archived"])
        self.assertEqual(
            _index_columns(Peg, "ix_pegs_palace_parent_sort"),
            ["palace_id", "parent_id", "sort_order"],
        )
        self.assertEqual(_index_columns(Attachment, "ix_attachments_palace_id"), ["palace_id"])
        self.assertEqual(
            _index_columns(ReviewLog, "ix_review_logs_palace_date_id"),
            ["palace_id", "review_date", "id"],
        )
        self.assertEqual(_index_columns(ReviewLog, "ix_review_logs_date"), ["review_date"])
        self.assertEqual(_index_columns(Chapter, "ix_chapters_subject_sort"), ["subject_id", "sort_order"])
        self.assertEqual(_index_columns(Chapter, "ix_chapters_parent_sort"), ["parent_id", "sort_order"])
        self.assertEqual(
            _index_columns(StudySession, "ix_study_sessions_deleted_started"),
            ["deleted_at", "started_at"],
        )
        self.assertEqual(
            _table_index_columns(chapter_palace_table, "ux_chapter_palaces_chapter_palace"),
            ["chapter_id", "palace_id"],
        )
        self.assertTrue(_table_index(chapter_palace_table, "ux_chapter_palaces_chapter_palace").unique)
        self.assertEqual(
            _table_index_columns(chapter_palace_table, "ix_chapter_palaces_palace_chapter"),
            ["palace_id", "chapter_id"],
        )

    def test_chapter_palace_deduplication_keeps_explicit_relationship(self):
        performance_indexes = _load_performance_indexes_migration()

        with self.SessionLocal() as session:
            subject = Subject(name="Subject")
            chapter = Chapter(subject=subject, name="Chapter")
            palace = Palace(title="Palace")
            session.add_all([subject, chapter, palace])
            session.commit()
            chapter_id = chapter.id
            palace_id = palace.id

        with self.engine.begin() as connection:
            connection.exec_driver_sql("DROP INDEX IF EXISTS ux_chapter_palaces_chapter_palace")
            connection.exec_driver_sql(
                "INSERT INTO chapter_palaces (id, chapter_id, palace_id, is_explicit) VALUES (?, ?, ?, 0)",
                (1, chapter_id, palace_id),
            )
            connection.exec_driver_sql(
                "INSERT INTO chapter_palaces (id, chapter_id, palace_id, is_explicit) VALUES (?, ?, ?, 1)",
                (2, chapter_id, palace_id),
            )
            connection.exec_driver_sql(
                "INSERT INTO chapter_palaces (id, chapter_id, palace_id, is_explicit) VALUES (?, NULL, ?, 1)",
                (3, palace_id),
            )

            original_op = performance_indexes.op
            performance_indexes.op = _MigrationOp(connection)
            try:
                performance_indexes._deduplicate_chapter_palaces()
            finally:
                performance_indexes.op = original_op

            rows = connection.exec_driver_sql(
                "SELECT id, chapter_id, palace_id, is_explicit FROM chapter_palaces"
            ).fetchall()

        self.assertEqual(rows, [(1, chapter_id, palace_id, 1)])

    def test_chapter_relationships_do_not_join_by_default(self):
        from sqlalchemy.orm.interfaces import RelationshipDirection

        relationships = [
            Palace.primary_chapter.property,
            PalaceQuizQuestion.source_chapter.property,
            PalaceQuizQuestion.classified_chapter.property,
        ]
        for relationship in relationships:
            self.assertEqual(relationship.direction, RelationshipDirection.MANYTOONE)
            self.assertEqual(relationship.lazy, "select")

    def test_restore_archived_palaces_runs_once_per_session(self):
        with self.SessionLocal() as session:
            session.add(Palace(title="Archived", archived=True))
            session.commit()

            self.assertEqual(restore_archived_palaces(session), 1)
            palace = session.query(Palace).filter_by(title="Archived").one()
            self.assertFalse(palace.archived)

            palace.archived = True
            session.commit()
            self.assertEqual(restore_archived_palaces(session), 0)
            self.assertTrue(palace.archived)

        with self.SessionLocal() as session:
            self.assertEqual(restore_archived_palaces(session), 1)

    def test_sqlite_pragmas_are_configured_for_file_database_connections(self):
        import sqlite3

        with TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "pragma-test.db"
            connection = sqlite3.connect(str(db_path))
            try:
                _configure_sqlite_pragmas(connection, None)
                cursor = connection.cursor()
                try:
                    self.assertEqual(cursor.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                    self.assertEqual(cursor.execute("PRAGMA busy_timeout").fetchone()[0], 30000)
                    self.assertEqual(cursor.execute("PRAGMA journal_mode").fetchone()[0].lower(), "wal")
                    self.assertEqual(cursor.execute("PRAGMA cache_size").fetchone()[0], -32000)
                    self.assertEqual(cursor.execute("PRAGMA temp_store").fetchone()[0], 2)
                    self.assertGreaterEqual(cursor.execute("PRAGMA mmap_size").fetchone()[0], 268435456)
                finally:
                    cursor.close()
            finally:
                connection.close()

    def test_dashboard_review_unit_counts_preserve_next_pending_schedule_semantics(self):
        current = datetime(2026, 7, 6, 10, 0, 0)
        with self.SessionLocal() as session:
            due_palace = Palace(title="due", created_at=current - timedelta(days=2))
            later_palace = Palace(title="later", created_at=current)
            blocked_by_future_first = Palace(title="future-first", created_at=current)
            practice_palace = Palace(title="practice", needs_practice=True)
            session.add_all([due_palace, later_palace, blocked_by_future_first, practice_palace])
            session.flush()
            session.add_all(
                [
                    ReviewSchedule(
                        palace_id=due_palace.id,
                        scheduled_date=current.date() - timedelta(days=1),
                        review_number=0,
                        completed=False,
                    ),
                    ReviewSchedule(
                        palace_id=later_palace.id,
                        scheduled_date=current.date(),
                        scheduled_at=datetime.combine(current.date(), time(23, 59, 59)),
                        review_number=0,
                        completed=False,
                    ),
                    ReviewSchedule(
                        palace_id=blocked_by_future_first.id,
                        scheduled_date=current.date() + timedelta(days=1),
                        review_number=0,
                        completed=False,
                    ),
                    ReviewSchedule(
                        palace_id=blocked_by_future_first.id,
                        scheduled_date=current.date() - timedelta(days=1),
                        review_number=1,
                        completed=False,
                    ),
                    PalaceMiniPalace(
                        palace_id=practice_palace.id,
                        name="mini",
                        needs_practice=True,
                    ),
                ]
            )
            session.commit()

            counts = _dashboard_review_unit_counts(session, now=current)

        self.assertEqual(counts["due_now_count"], 1)
        self.assertEqual(counts["due_later_today_count"], 1)
        self.assertEqual(counts["needs_practice_count"], 2)

    def test_study_session_duration_uses_sql_sum_and_keeps_positive_seconds_semantics(self):
        start = datetime(2026, 7, 6, 0, 0, 0)
        end = start + timedelta(days=1)
        with self.SessionLocal() as session:
            session.add_all(
                [
                    _study_session("included", "completed", "review", start, 120),
                    _study_session("negative", "completed", "review", start + timedelta(hours=1), -30),
                    _study_session("active", "active", "review", start + timedelta(hours=2), 60),
                    _study_session("other-scene", "completed", "english", start + timedelta(hours=3), 90),
                    _study_session("end-boundary", "completed", "review", end, 45),
                    _study_session(
                        "deleted",
                        "completed",
                        "review",
                        start + timedelta(hours=4),
                        30,
                        deleted_at=start + timedelta(hours=5),
                    ),
                ]
            )
            session.commit()

            ranged_total = get_study_session_duration_seconds(
                session,
                scenes=STUDY_DASHBOARD_SCENES,
                start=start,
                end=end,
            )
            all_time_total = get_all_time_study_session_duration_seconds(
                session,
                scenes=STUDY_DASHBOARD_SCENES,
            )

        self.assertEqual(ranged_total, 120)
        self.assertEqual(all_time_total, 165)


def _index_columns(model, index_name: str) -> list[str]:
    return _table_index_columns(model.__table__, index_name)


def _table_index_columns(table, index_name: str) -> list[str]:
    index = _table_index(table, index_name)
    return [column.name for column in index.columns]


def _table_index(table, index_name: str):
    for index in table.indexes:
        if index.name == index_name:
            return index
    raise AssertionError(f"Index {index_name!r} was not declared on {table.name!r}.")


def _load_performance_indexes_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0011_database_performance_indexes.py"
    )
    spec = importlib.util.spec_from_file_location(
        "database_performance_indexes_migration",
        migration_path,
    )
    if spec is None or spec.loader is None:
        raise AssertionError(f"Could not load migration from {migration_path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _MigrationOp:
    def __init__(self, connection) -> None:
        self._connection = connection

    def get_bind(self):
        return self._connection


def _study_session(
    session_id: str,
    status: str,
    scene: str,
    started_at: datetime,
    effective_seconds: int,
    *,
    deleted_at: datetime | None = None,
) -> StudySession:
    return StudySession(
        id=session_id,
        status=status,
        scene=scene,
        target_type="none",
        started_at=started_at,
        effective_seconds=effective_seconds,
        deleted_at=deleted_at,
    )


if __name__ == "__main__":
    unittest.main()
