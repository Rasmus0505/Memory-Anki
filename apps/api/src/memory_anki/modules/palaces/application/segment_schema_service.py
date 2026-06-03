from __future__ import annotations


def ensure_segment_schema() -> None:
    from memory_anki.infrastructure.db.models import engine

    table_columns = {
        "session_progress": (
            ("palace_segment_id", "INTEGER"),
            ("palace_segment_review_schedule_id", "INTEGER"),
        ),
        "time_records": (
            ("palace_segment_id", "INTEGER"),
        ),
        "review_schedules": (
            ("scheduled_at", "DATETIME"),
            ("completed_at", "DATETIME"),
        ),
        "palace_segment_review_schedules": (
            ("scheduled_at", "DATETIME"),
            ("completed_at", "DATETIME"),
        ),
    }
    with engine.begin() as conn:
        existing_tables = {
            row[0]
            for row in conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "palace_segments" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_id INTEGER NOT NULL,
                    name VARCHAR(200) NOT NULL DEFAULT '',
                    color VARCHAR(24) NOT NULL DEFAULT '#14b8a6',
                    node_uids_json TEXT DEFAULT '[]',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    sort_order INTEGER DEFAULT 0,
                    FOREIGN KEY(palace_id) REFERENCES palaces(id) ON DELETE CASCADE
                )
                """
            )
        if "palace_segment_review_schedules" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segment_review_schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_segment_id INTEGER NOT NULL,
                    scheduled_date DATE NOT NULL,
                    scheduled_at DATETIME NULL,
                    interval_days INTEGER DEFAULT 0,
                    algorithm_used VARCHAR(30) DEFAULT 'ebbinghaus',
                    completed BOOLEAN DEFAULT 0,
                    completed_at DATETIME NULL,
                    review_number INTEGER DEFAULT 0,
                    review_type VARCHAR(20) DEFAULT 'standard',
                    anchor_date DATE NULL,
                    FOREIGN KEY(palace_segment_id) REFERENCES palace_segments(id) ON DELETE CASCADE
                )
                """
            )
        if "palace_segment_review_logs" not in existing_tables:
            conn.exec_driver_sql(
                """
                CREATE TABLE palace_segment_review_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    palace_segment_id INTEGER NOT NULL,
                    review_date DATE DEFAULT CURRENT_DATE,
                    score INTEGER DEFAULT 0,
                    review_mode VARCHAR(20) DEFAULT 'flashcard',
                    duration_seconds INTEGER DEFAULT 0,
                    FOREIGN KEY(palace_segment_id) REFERENCES palace_segments(id) ON DELETE CASCADE
                )
                """
            )

        for table_name, columns in table_columns.items():
            existing = {
                row[1]
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            }
            for column_name, column_type in columns:
                if column_name not in existing:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    )

        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_palace_segments_palace_sort "
            "ON palace_segments (palace_id, sort_order)"
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_segment_review_schedule_segment "
            "ON palace_segment_review_schedules (palace_segment_id, completed, review_number)"
        )
