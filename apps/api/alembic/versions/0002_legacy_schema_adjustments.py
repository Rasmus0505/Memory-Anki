"""legacy schema adjustments and data migrations"""

from __future__ import annotations

from alembic import op

revision = "0002_legacy_schema_adjustments"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]) for row in rows}


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _index_sql(index_name: str) -> str:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    if row is None or row[0] is None:
        return ""
    return str(row[0])


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists("subjects"):
        columns = _table_columns("subjects")
        for column_name in ("editor_doc", "editor_config", "editor_local_config"):
            if column_name not in columns:
                bind.exec_driver_sql(f"ALTER TABLE subjects ADD COLUMN {column_name} TEXT")

    if _table_exists("palaces"):
        columns = _table_columns("palaces")
        palace_columns = (
            ("editor_doc", "TEXT"),
            ("editor_config", "TEXT"),
            ("editor_local_config", "TEXT"),
            ("primary_chapter_id", "INTEGER"),
            ("group_id", "INTEGER"),
            ("group_sort_order", "INTEGER DEFAULT 0"),
            ("title_mode", "VARCHAR(20) DEFAULT 'sync'"),
            ("manual_title", "VARCHAR(200) DEFAULT ''"),
            ("grouping_mode", "VARCHAR(20) DEFAULT 'auto'"),
            ("manual_group_chapter_id", "INTEGER"),
            ("mini_review_mode", "VARCHAR(20) DEFAULT 'independent'"),
            ("needs_practice", "BOOLEAN NOT NULL DEFAULT 0"),
            ("focus_node_uids_json", "TEXT NOT NULL DEFAULT '[]'"),
        )
        for column_name, column_type in palace_columns:
            if column_name not in columns:
                bind.exec_driver_sql(
                    f"ALTER TABLE palaces ADD COLUMN {column_name} {column_type}"
                )

    if _table_exists("chapter_palaces"):
        columns = _table_columns("chapter_palaces")
        if "is_explicit" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE chapter_palaces ADD COLUMN is_explicit BOOLEAN NOT NULL DEFAULT 1"
            )

    if _table_exists("time_records"):
        columns = _table_columns("time_records")
        if "source_kind" not in columns:
            bind.exec_driver_sql("ALTER TABLE time_records ADD COLUMN source_kind VARCHAR(32)")
        if "english_course_id" not in columns:
            bind.exec_driver_sql("ALTER TABLE time_records ADD COLUMN english_course_id INTEGER")
        if "palace_segment_id" not in columns:
            bind.exec_driver_sql("ALTER TABLE time_records ADD COLUMN palace_segment_id INTEGER")
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_source_kind_started "
            "ON time_records (source_kind, started_at)"
        )
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_english_course_started "
            "ON time_records (english_course_id, started_at)"
        )

    if _table_exists("palace_versions"):
        columns = _table_columns("palace_versions")
        for column_name in ("editor_config", "editor_local_config"):
            if column_name not in columns:
                bind.exec_driver_sql(
                    f"ALTER TABLE palace_versions ADD COLUMN {column_name} TEXT DEFAULT ''"
                )
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_versions_palace_id_created_at "
            "ON palace_versions (palace_id, created_at DESC)"
        )

    if _table_exists("palace_quiz_questions"):
        columns = _table_columns("palace_quiz_questions")
        if "mini_palace_id" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_quiz_questions ADD COLUMN mini_palace_id INTEGER NULL"
            )
        if "origin_question_id" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_quiz_questions ADD COLUMN origin_question_id INTEGER NULL"
            )

    if _table_exists("palace_mini_palace_review_schedules"):
        columns = _table_columns("palace_mini_palace_review_schedules")
        if "scheduled_at" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_mini_palace_review_schedules ADD COLUMN scheduled_at DATETIME"
            )
        if "completed_at" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_mini_palace_review_schedules ADD COLUMN completed_at DATETIME"
            )

    if _table_exists("mindmap_import_jobs"):
        columns = _table_columns("mindmap_import_jobs")
        if "progress_json" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE mindmap_import_jobs ADD COLUMN progress_json TEXT DEFAULT '{}'"
            )
        if "pause_requested" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE mindmap_import_jobs ADD COLUMN pause_requested BOOLEAN NOT NULL DEFAULT 0"
            )
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_mindmap_import_jobs_entity_fingerprint "
            "ON mindmap_import_jobs (entity_key, fingerprint)"
        )
        bind.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_mindmap_import_jobs_entity_created "
            "ON mindmap_import_jobs (entity_key, created_at)"
        )
        bind.exec_driver_sql(
            "UPDATE mindmap_import_jobs "
            "SET status = 'interrupted', pause_requested = 0, updated_at = CURRENT_TIMESTAMP "
            "WHERE status = 'running' AND deleted_at IS NULL"
        )

    if _table_exists("review_schedules"):
        columns = _table_columns("review_schedules")
        if "scheduled_at" not in columns:
            bind.exec_driver_sql("ALTER TABLE review_schedules ADD COLUMN scheduled_at DATETIME")
        if "completed_at" not in columns:
            bind.exec_driver_sql("ALTER TABLE review_schedules ADD COLUMN completed_at DATETIME")

    if _table_exists("palace_segment_review_schedules"):
        columns = _table_columns("palace_segment_review_schedules")
        if "scheduled_at" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_segment_review_schedules ADD COLUMN scheduled_at DATETIME"
            )
        if "completed_at" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE palace_segment_review_schedules ADD COLUMN completed_at DATETIME"
            )

    if _table_exists("session_progress"):
        columns = _table_columns("session_progress")
        if "updated_at" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            )
        if "palace_segment_id" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN palace_segment_id INTEGER"
            )
        if "palace_segment_review_schedule_id" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN palace_segment_review_schedule_id INTEGER"
            )
        if "mini_palace_id" not in columns:
            bind.exec_driver_sql("ALTER TABLE session_progress ADD COLUMN mini_palace_id INTEGER")
        if "mini_palace_review_schedule_id" not in columns:
            bind.exec_driver_sql(
                "ALTER TABLE session_progress ADD COLUMN mini_palace_review_schedule_id INTEGER"
            )

        review_index_sql = _index_sql("ix_session_progress_review")
        practice_index_sql = _index_sql("ix_session_progress_practice")
        if review_index_sql and "WHERE session_kind = 'review'" not in review_index_sql:
            bind.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_review")
        if practice_index_sql and "WHERE session_kind = 'practice'" not in practice_index_sql:
            bind.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_practice")

        duplicate_rows = bind.exec_driver_sql(
            """
            SELECT review_schedule_id, COUNT(*) AS row_count
            FROM session_progress
            WHERE session_kind = 'review' AND review_schedule_id IS NOT NULL
            GROUP BY review_schedule_id
            HAVING COUNT(*) > 1
            """
        ).fetchall()
        for review_schedule_id, _ in duplicate_rows:
            rows = bind.exec_driver_sql(
                """
                SELECT id
                FROM session_progress
                WHERE session_kind = 'review' AND review_schedule_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (review_schedule_id,),
            ).fetchall()
            keep_id = rows[0][0]
            for row in rows[1:]:
                if row[0] != keep_id:
                    bind.exec_driver_sql("DELETE FROM session_progress WHERE id = ?", (row[0],))

        bind.exec_driver_sql("DROP INDEX IF EXISTS ix_session_progress_review_palace_id")
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_practice "
            "ON session_progress (session_kind, palace_id) "
            "WHERE session_kind = 'practice' AND palace_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_review "
            "ON session_progress (session_kind, review_schedule_id) "
            "WHERE session_kind = 'review' AND review_schedule_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_practice "
            "ON session_progress (session_kind, palace_segment_id) "
            "WHERE session_kind = 'segment_practice' AND palace_segment_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_segment_review "
            "ON session_progress (session_kind, palace_segment_review_schedule_id) "
            "WHERE session_kind = 'segment_review' "
            "AND palace_segment_review_schedule_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_mini_practice "
            "ON session_progress (session_kind, mini_palace_id) "
            "WHERE session_kind = 'mini_practice' AND mini_palace_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_mini_review "
            "ON session_progress (session_kind, mini_palace_review_schedule_id) "
            "WHERE session_kind = 'mini_review' "
            "AND mini_palace_review_schedule_id IS NOT NULL"
        )
        bind.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_focus_practice "
            "ON session_progress (session_kind, palace_id) "
            "WHERE session_kind = 'focus_practice' AND palace_id IS NOT NULL"
        )

    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_external_ai_call_logs_job_created "
        "ON external_ai_call_logs (job_id, created_at)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_external_ai_call_logs_palace_created "
        "ON external_ai_call_logs (palace_id, created_at)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_external_ai_call_logs_created "
        "ON external_ai_call_logs (created_at)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("DROP INDEX IF EXISTS ix_external_ai_call_logs_created")
    bind.exec_driver_sql("DROP INDEX IF EXISTS ix_external_ai_call_logs_palace_created")
    bind.exec_driver_sql("DROP INDEX IF EXISTS ix_external_ai_call_logs_job_created")
