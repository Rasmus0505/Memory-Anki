from __future__ import annotations

import importlib.util
import json
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db import maintenance as db_maintenance
from memory_anki.infrastructure.db._tables._base import _configure_sqlite_pragmas
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Attachment,
    Palace,
    PalaceQuizQuestion,
    Peg,
    ReviewLog,
    chapter_palace_table,
)
from memory_anki.modules.backups.application import backup_lifecycle, storage_backup
from memory_anki.modules.dashboard.application.service import (
    build_weekly_report_payload,
)
from memory_anki.modules.palaces.application.palace_maintenance import (
    restore_all_archived_palaces,
)
from memory_anki.modules.sessions.application.study_session_service import (
    STUDY_DASHBOARD_SCENES,
    current_week_bounds,
    get_all_time_study_session_duration_seconds,
    get_study_session_duration_seconds,
)
from support import RouterTestCase


class DatabasePerformanceOptimizationTests(RouterTestCase):
    def test_performance_indexes_are_declared_on_orm_tables(self):
        self.assertEqual(_index_columns(Palace, "ix_palaces_updated_at"), ["updated_at"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_created_at_id"), ["created_at", "id"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_primary_chapter_id"), ["primary_chapter_id"])
        self.assertEqual(_index_columns(Palace, "ix_palaces_mastered_archived"), ["mastered", "archived"])
        self.assertEqual(
            _index_columns(Palace, "ix_palaces_active_list"),
            ["deleted_at", "archived", "group_sort_order", "id"],
        )
        self.assertEqual(
            _index_columns(Palace, "ix_palaces_deleted_archived_updated"),
            ["deleted_at", "archived", "updated_at"],
        )
        self.assertEqual(
            _index_columns(Peg, "ix_pegs_palace_parent_sort"),
            ["palace_id", "parent_id", "sort_order"],
        )
        self.assertEqual(
            _index_columns(PalaceQuizQuestion, "ix_palace_quiz_questions_chapter_published"),
            ["source_chapter_id", "lifecycle_status", "deleted_at"],
        )
        self.assertEqual(
            _index_columns(PalaceQuizQuestion, "ix_palace_quiz_questions_palace_published_sort"),
            ["palace_id", "deleted_at", "lifecycle_status", "sort_order"],
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

            self.assertEqual(restore_all_archived_palaces(session), 1)
            palace = session.query(Palace).filter_by(title="Archived").one()
            self.assertFalse(palace.archived)

            palace.archived = True
            session.commit()
            self.assertEqual(restore_all_archived_palaces(session), 0)
            self.assertTrue(palace.archived)

        with self.SessionLocal() as session:
            self.assertEqual(restore_all_archived_palaces(session), 1)

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
                    self.assertEqual(cursor.execute("PRAGMA cache_size").fetchone()[0], -64000)
                    self.assertEqual(cursor.execute("PRAGMA temp_store").fetchone()[0], 2)
                    self.assertGreaterEqual(cursor.execute("PRAGMA mmap_size").fetchone()[0], 268435456)
                finally:
                    cursor.close()
            finally:
                connection.close()

    @unittest.skip('legacy ReviewSchedule dashboard path removed')
    def test_dashboard_review_unit_counts_preserve_next_pending_schedule_semantics(self):
        return


    @unittest.skip('legacy ReviewSchedule dashboard path removed')
    def test_dashboard_review_unit_counts_keeps_constant_query_count(self):
        return


    @unittest.skip('legacy ReviewSchedule dashboard path removed')
    def test_dashboard_payload_keeps_query_budget_with_many_due_palaces(self):
        return


    def test_weekly_report_uses_sql_aggregate_for_review_logs(self):
        from datetime import date

        today = date.today()
        week_start_date = today - timedelta(days=today.weekday() + 7)
        week_start, _week_end = current_week_bounds()
        week_start = week_start - timedelta(days=7)
        with self.SessionLocal() as session:
            palace = Palace(
                title="weekly-report-sql",
                created_at=week_start + timedelta(hours=1),
                updated_at=week_start + timedelta(hours=1),
            )
            session.add(palace)
            session.flush()
            session.add_all(
                [
                    ReviewLog(
                        palace_id=palace.id,
                        review_date=week_start_date + timedelta(days=index % 7),
                        score=index % 5,
                    )
                    for index in range(80)
                ]
            )
            session.commit()

            statements: list[str] = []

            def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
                if statement.lstrip().upper().startswith("SELECT"):
                    statements.append(statement)

            event.listen(self.engine, "before_cursor_execute", record_select)
            try:
                payload = build_weekly_report_payload(session, offset_weeks=1)
            finally:
                event.remove(self.engine, "before_cursor_execute", record_select)

        self.assertEqual(payload["review_count"], 80)
        self.assertEqual(payload["average_score"], 2.0)
        self.assertEqual(payload["new_palace_count"], 1)
        self.assertLessEqual(len(statements), 3)

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
                    # Started before the window, finished inside it → counts for the range.
                    _study_session(
                        "recovered-cross-day",
                        "completed",
                        "review",
                        start - timedelta(days=3),
                        80,
                        ended_at=start + timedelta(hours=6),
                    ),
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

        self.assertEqual(ranged_total, 200)
        self.assertEqual(all_time_total, 245)

    def test_storage_backup_checkpoints_wal_before_copying_database_file(self):
        events: list[str] = []
        backup_item = _BackupItem()

        with TemporaryDirectory() as temp_dir, patch.object(
            storage_backup,
            "ensure_runtime_dirs",
            side_effect=lambda: events.append("ensure"),
        ), patch.object(
            storage_backup,
            "checkpoint_sqlite_wal",
            side_effect=lambda **kwargs: events.append(
                f"checkpoint:{kwargs.get('require_complete')}"
            ),
        ), patch.object(
            storage_backup,
            "_select_backup_items",
            return_value=[backup_item],
        ), patch.object(
            storage_backup,
            "_copy_item_to_backup",
            side_effect=lambda item, destination: events.append(f"copy:{item.key}") or {"key": item.key},
        ), patch.object(
            storage_backup,
            "create_storage_backup_manifest",
            side_effect=lambda **_kwargs: events.append("manifest") or {"ok": True},
        ):
            storage_backup.write_storage_backup(Path(temp_dir), reason="rolling-edit", full=False)

        self.assertEqual(events, ["ensure", "checkpoint:True", "copy:database", "manifest"])

    def test_storage_backup_manifest_records_database_info(self):
        manifest = storage_backup.create_storage_backup_manifest(
            reason="unit-test",
            included_items=[],
            full=False,
        )

        self.assertIn("database", manifest)
        self.assertIn("relative_path", manifest["database"])
        self.assertIn("sidecars", manifest["database"])

    def test_storage_backup_copies_database_sidecars(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            app_home = root / "app-home"
            data_dir = app_home / "data"
            data_dir.mkdir(parents=True)
            db_path = data_dir / "memory_palace.db"
            wal_path = data_dir / "memory_palace.db-wal"
            shm_path = data_dir / "memory_palace.db-shm"
            db_path.write_bytes(b"sqlite")
            wal_path.write_bytes(b"wal")
            shm_path.write_bytes(b"shm")
            destination = root / "backup"
            item = _BackupItem()
            item.relative_path = "data/memory_palace.db"
            item.kind = "file"
            item.required = True

            with patch.object(storage_backup, "APP_HOME", app_home):
                result = storage_backup._copy_item_to_backup(item, destination)

            restored_home = root / "restored"
            manifest = {
                "included_items": [
                    {
                        **result,
                        "relative_path": "data/memory_palace.db",
                    }
                ]
            }
            (destination / storage_backup.BACKUP_MANIFEST_NAME).write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )
            with patch.object(storage_backup, "APP_HOME", restored_home), patch.object(
                storage_backup,
                "ensure_runtime_dirs",
            ):
                restored = storage_backup.restore_storage_backup(destination)
            backup_wal = (destination / "data" / "memory_palace.db-wal").read_bytes()
            restored_wal = (restored_home / "data" / "memory_palace.db-wal").read_bytes()
            restored_shm = (restored_home / "data" / "memory_palace.db-shm").read_bytes()

        self.assertIn("database", restored)
        self.assertEqual(backup_wal, b"wal")
        self.assertEqual(restored_wal, b"wal")
        self.assertEqual(restored_shm, b"shm")

    def test_storage_backup_stops_when_required_checkpoint_fails(self):
        with TemporaryDirectory() as temp_dir, patch.object(
            storage_backup,
            "ensure_runtime_dirs",
        ), patch.object(
            storage_backup,
            "checkpoint_sqlite_wal",
            side_effect=db_maintenance.DatabaseMaintenanceError("checkpoint busy"),
        ), patch.object(
            storage_backup,
            "_copy_item_to_backup",
        ) as copy_item_to_backup:
            with self.assertRaises(db_maintenance.DatabaseMaintenanceError):
                storage_backup.write_storage_backup(Path(temp_dir), reason="rolling-edit", full=False)

        copy_item_to_backup.assert_not_called()

    def test_full_backup_analyzes_after_successful_backup(self):
        events: list[str] = []
        backup_lock = _RecordingLock(events)

        def analyze_after_lock():
            self.assertFalse(backup_lock.locked())
            events.append("analyze")
            return True

        with TemporaryDirectory() as temp_dir, patch.object(
            backup_lifecycle,
            "FULL_BACKUPS_DIR",
            Path(temp_dir),
        ), patch.object(
            backup_lifecycle,
            "_BACKUP_LOCK",
            backup_lock,
        ), patch.object(
            backup_lifecycle,
            "timestamp_slug",
            return_value="20260706-100000",
        ), patch.object(
            backup_lifecycle,
            "write_storage_backup",
            side_effect=lambda *_args, **_kwargs: events.append("write"),
        ), patch.object(
            backup_lifecycle,
            "prune_old_backups",
            side_effect=lambda *_args, **_kwargs: events.append("prune") or 0,
        ), patch.object(
            backup_lifecycle,
            "analyze_database",
            side_effect=analyze_after_lock,
        ):
            folder = backup_lifecycle.create_full_backup("periodic")

        self.assertEqual(folder, Path(temp_dir) / "20260706-100000-periodic")
        self.assertEqual(events, ["lock-enter", "write", "prune", "lock-exit", "analyze"])

    def test_full_backup_does_not_analyze_when_backup_copy_fails(self):
        with TemporaryDirectory() as temp_dir, patch.object(
            backup_lifecycle,
            "FULL_BACKUPS_DIR",
            Path(temp_dir),
        ), patch.object(
            backup_lifecycle,
            "timestamp_slug",
            return_value="20260706-100000",
        ), patch.object(
            backup_lifecycle,
            "write_storage_backup",
            side_effect=RuntimeError("copy failed"),
        ), patch.object(
            backup_lifecycle,
            "analyze_database",
        ) as analyze_database:
            with self.assertRaises(RuntimeError):
                backup_lifecycle.create_full_backup("periodic")

        analyze_database.assert_not_called()

    def test_rolling_backup_checkpoints_but_does_not_analyze(self):
        events: list[str] = []
        with TemporaryDirectory() as temp_dir, patch.object(
            backup_lifecycle,
            "ROLLING_BACKUPS_DIR",
            Path(temp_dir),
        ), patch.object(
            backup_lifecycle,
            "timestamp_slug",
            return_value="20260706-100000",
        ), patch.object(
            backup_lifecycle,
            "write_storage_backup",
            side_effect=lambda *_args, **_kwargs: events.append("write"),
        ) as write_storage_backup, patch.object(
            backup_lifecycle,
            "prune_old_backups",
            side_effect=lambda *_args, **_kwargs: events.append("prune") or 0,
        ), patch.object(
            backup_lifecycle,
            "analyze_database",
            side_effect=lambda: events.append("analyze") or True,
        ) as analyze_database:
            backup_lifecycle.create_rolling_backup("rolling-edit")

        write_storage_backup.assert_called_once()
        self.assertFalse(write_storage_backup.call_args.kwargs["full"])
        analyze_database.assert_not_called()
        self.assertEqual(events, ["write", "prune"])

    def test_database_maintenance_runs_checkpoint_and_analyze_without_vacuum(self):
        statements: list[str] = []
        test_engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement.upper())

        event.listen(test_engine, "before_cursor_execute", record_statement)
        try:
            self.assertTrue(db_maintenance.checkpoint_sqlite_wal(test_engine))
            self.assertTrue(db_maintenance.analyze_database(test_engine))
        finally:
            event.remove(test_engine, "before_cursor_execute", record_statement)
            test_engine.dispose()

        self.assertTrue(any("PRAGMA WAL_CHECKPOINT" in statement for statement in statements))
        self.assertTrue(any("ANALYZE" in statement for statement in statements))
        self.assertFalse(any("VACUUM" in statement for statement in statements))

    def test_database_maintenance_reports_incomplete_checkpoint(self):
        incomplete_engine = _FakeCheckpointEngine((1, 3, 2))

        self.assertFalse(db_maintenance.checkpoint_sqlite_wal(incomplete_engine))
        with self.assertRaises(db_maintenance.DatabaseMaintenanceError):
            db_maintenance.checkpoint_sqlite_wal(
                incomplete_engine,
                require_complete=True,
            )

        for row in ((0, 3, 2), None, (0, 1), ("busy", 3, 3)):
            self.assertFalse(db_maintenance.checkpoint_sqlite_wal(_FakeCheckpointEngine(row)))

        self.assertTrue(db_maintenance.checkpoint_sqlite_wal(_FakeCheckpointEngine((0, 3, 3))))
        self.assertTrue(db_maintenance.checkpoint_sqlite_wal(_FakeCheckpointEngine((0, -1, -1))))

    def test_fsrs_queue_select_count_stays_flat_with_many_palaces(self):
        from memory_anki.modules.reviews.application.formal_review_service import (
            get_fsrs_queue_payload,
        )

        editor_doc = json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {
                            "data": {"uid": "n1", "text": "node-1"},
                            "children": [],
                        }
                    ],
                }
            },
            ensure_ascii=False,
        )
        with self.SessionLocal() as session:
            for index in range(12):
                session.add(
                    Palace(
                        title=f"queue-palace-{index}",
                        editor_doc=editor_doc,
                        archived=False,
                    )
                )
            session.commit()

            statements: list[str] = []

            def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
                if statement.lstrip().upper().startswith("SELECT"):
                    statements.append(statement)

            event.listen(self.engine, "before_cursor_execute", record_select)
            try:
                payload = get_fsrs_queue_payload(
                    session,
                    include_stats=False,
                    include_items=True,
                )
            finally:
                event.remove(self.engine, "before_cursor_execute", record_select)

        self.assertGreaterEqual(int(payload.get("due_count") or 0), 12)
        # Batch path: palace list + states + settings/config + optional counts — not O(N).
        self.assertLessEqual(len(statements), 12)

    def test_batch_due_rollup_matches_single_palace_rollup(self):
        from memory_anki.modules.reviews.application.node_due_rollup_batch import (
            project_due_rollups_batch,
        )
        from memory_anki.modules.reviews.application.node_memory_projection import (
            _clear_due_rollup_cache,
            get_palace_due_rollup,
        )

        editor_doc = json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "root"},
                    "children": [
                        {"data": {"uid": "a", "text": "A"}, "children": []},
                        {"data": {"uid": "b", "text": "B"}, "children": []},
                    ],
                }
            },
            ensure_ascii=False,
        )
        with self.SessionLocal() as session:
            left = Palace(title="batch-left", editor_doc=editor_doc)
            right = Palace(title="batch-right", editor_doc=editor_doc)
            session.add_all([left, right])
            session.commit()
            session.refresh(left)
            session.refresh(right)

            batch = project_due_rollups_batch(session, [left, right], include_nodes=True)
            _clear_due_rollup_cache(session)
            single_left = get_palace_due_rollup(session, left.id)
            single_right = get_palace_due_rollup(session, right.id)

        self.assertEqual(batch[left.id]["due_node_count"], single_left["due_node_count"])
        self.assertEqual(batch[right.id]["due_node_count"], single_right["due_node_count"])
        self.assertEqual(batch[left.id]["review_entry_mode"], single_left["review_entry_mode"])
        self.assertEqual(batch[right.id]["review_entry_mode"], single_right["review_entry_mode"])

    def test_list_palaces_loader_does_not_query_pegs_or_attachments(self):
        from memory_anki.modules.palaces.application.palace_service import list_palaces

        with self.SessionLocal() as session:
            session.add(Palace(title="list-light"))
            session.commit()
            statements: list[str] = []

            def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
                if statement.lstrip().upper().startswith("SELECT"):
                    statements.append(statement)

            event.listen(self.engine, "before_cursor_execute", record_select)
            try:
                palaces = list_palaces(session)
            finally:
                event.remove(self.engine, "before_cursor_execute", record_select)

        self.assertEqual(len(palaces), 1)
        joined = "\n".join(statements).lower()
        self.assertNotIn("from pegs", joined)
        self.assertNotIn("from attachments", joined)
        self.assertNotIn("join pegs", joined)
        self.assertNotIn("join attachments", joined)


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


class _BackupItem:
    key = "database"
    relative_path = "memory_palace.db"
    kind = "file"
    required = True

    def absolute_path(self, app_home: Path) -> Path:
        return app_home / self.relative_path


class _RecordingLock:
    def __init__(self, events: list[str]) -> None:
        self._events = events
        self._locked = False

    def __enter__(self):
        self._locked = True
        self._events.append("lock-enter")
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        self._events.append("lock-exit")
        self._locked = False
        return False

    def locked(self) -> bool:
        return self._locked


class _FakeCheckpointEngine:
    class _Dialect:
        name = "sqlite"

    class _Result:
        def __init__(self, row) -> None:
            self._row = row

        def first(self):
            return self._row

    class _Connection:
        def __init__(self, row) -> None:
            self._row = row

        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _traceback):
            return False

        def execute(self, _statement):
            return _FakeCheckpointEngine._Result(self._row)

    dialect = _Dialect()

    def __init__(self, row) -> None:
        self._row = row

    def begin(self):
        return self._Connection(self._row)


def _study_session(
    session_id: str,
    status: str,
    scene: str,
    started_at: datetime,
    effective_seconds: int,
    *,
    ended_at: datetime | None = None,
    deleted_at: datetime | None = None,
) -> StudySession:
    return StudySession(
        id=session_id,
        status=status,
        scene=scene,
        target_type="none",
        started_at=started_at,
        ended_at=ended_at,
        effective_seconds=effective_seconds,
        deleted_at=deleted_at,
    )


if __name__ == "__main__":
    unittest.main()
