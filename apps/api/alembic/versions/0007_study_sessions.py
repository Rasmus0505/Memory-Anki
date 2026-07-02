"""add study sessions

Revision ID: 0007_study_sessions
Revises: 0006_study_startup_indexes
"""

from __future__ import annotations

import json
from datetime import datetime

from alembic import op
import sqlalchemy as sa

revision = "0007_study_sessions"
down_revision = "0006_study_startup_indexes"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    return row is not None


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _table_exists(table_name) or _index_exists(index_name):
        return
    op.create_index(index_name, table_name, columns)


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _scene_from_time_record(kind: str | None, source_kind: str | None) -> str:
    if source_kind == "english":
        return "english"
    if source_kind == "english_reading":
        return "english_reading"
    if kind == "palace_edit":
        return "palace_edit"
    if kind == "quiz":
        return "quiz"
    if kind == "review":
        return "review"
    if kind == "practice":
        return "practice"
    return str(kind or "practice")


def _target_from_time_record(row) -> tuple[str, int | None]:
    if row.english_course_id is not None:
        return "english_course", row.english_course_id
    if row.palace_segment_id is not None:
        return "palace_segment", row.palace_segment_id
    if row.palace_id is not None:
        return "palace", row.palace_id
    return "none", None


def _scene_target_from_progress(row) -> tuple[str, str, int | None]:
    kind = str(row.session_kind or "")
    if kind == "practice":
        return "practice", "palace", row.palace_id
    if kind == "focus_practice":
        return "focus_practice", "palace", row.palace_id
    if kind == "segment_practice":
        return "segment_practice", "palace_segment", row.palace_segment_id
    if kind == "mini_practice":
        return "mini_practice", "mini_palace", row.mini_palace_id
    if kind == "review":
        return "review", "review_schedule", row.review_schedule_id
    if kind == "segment_review":
        return "segment_review", "segment_review_schedule", row.palace_segment_review_schedule_id
    if kind == "mini_review":
        return "mini_review", "mini_review_schedule", row.mini_palace_review_schedule_id
    return kind or "practice", "none", None


def _insert_study_session(bind, payload: dict) -> None:
    bind.execute(
        sa.text(
            """
            INSERT OR IGNORE INTO study_sessions (
                id, status, scene, target_type, target_id,
                palace_id, palace_segment_id, mini_palace_id,
                english_course_id, english_reading_material_id, title,
                started_at, ended_at, effective_seconds, idle_seconds,
                pause_count, completion_method, progress_json, events_json,
                summary_json, deleted_at, deleted_reason, created_at, updated_at
            ) VALUES (
                :id, :status, :scene, :target_type, :target_id,
                :palace_id, :palace_segment_id, :mini_palace_id,
                :english_course_id, :english_reading_material_id, :title,
                :started_at, :ended_at, :effective_seconds, :idle_seconds,
                :pause_count, :completion_method, :progress_json, :events_json,
                :summary_json, :deleted_at, :deleted_reason, :created_at, :updated_at
            )
            """
        ),
        payload,
    )


def _backfill_from_time_records() -> None:
    if not _table_exists("time_records"):
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT * FROM time_records ORDER BY started_at, id")).fetchall()
    for row in rows:
        scene = _scene_from_time_record(row.kind, row.source_kind)
        target_type, target_id = _target_from_time_record(row)
        started_at = row.started_at or row.created_at or datetime.now()
        ended_at = row.ended_at or started_at
        events = row.events_json or "[]"
        summary = {
            "migrated_from": "time_records",
            "source_kind": row.source_kind,
            "duration_edited": bool(row.duration_edited),
        }
        _insert_study_session(
            bind,
            {
                "id": f"time-record-{row.id}",
                "status": "completed" if row.deleted_at is None else "abandoned",
                "scene": scene,
                "target_type": target_type,
                "target_id": target_id,
                "palace_id": row.palace_id,
                "palace_segment_id": row.palace_segment_id,
                "mini_palace_id": None,
                "english_course_id": row.english_course_id,
                "english_reading_material_id": None,
                "title": row.title or "",
                "started_at": started_at,
                "ended_at": ended_at,
                "effective_seconds": int(row.effective_seconds or 0),
                "idle_seconds": 0,
                "pause_count": int(row.pause_count or 0),
                "completion_method": row.completion_method or "manual_complete",
                "progress_json": "{}",
                "events_json": events,
                "summary_json": _json_dumps(summary),
                "deleted_at": row.deleted_at,
                "deleted_reason": row.deleted_reason,
                "created_at": row.created_at or started_at,
                "updated_at": row.updated_at or ended_at,
            },
        )


def _backfill_from_session_progress() -> None:
    if not _table_exists("session_progress"):
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT * FROM session_progress
            WHERE completed = 0 OR completed IS NULL
            ORDER BY updated_at, id
            """
        )
    ).fetchall()
    for row in rows:
        scene, target_type, target_id = _scene_target_from_progress(row)
        updated_at = row.updated_at or datetime.now()
        progress = {
            "reveal_map": json.loads(row.reveal_map or "{}"),
            "red_node_ids": json.loads(row.red_node_ids or "[]"),
            "completed": bool(row.completed),
        }
        _insert_study_session(
            bind,
            {
                "id": f"session-progress-{row.id}",
                "status": "active",
                "scene": scene,
                "target_type": target_type,
                "target_id": target_id,
                "palace_id": row.palace_id,
                "palace_segment_id": row.palace_segment_id,
                "mini_palace_id": row.mini_palace_id,
                "english_course_id": None,
                "english_reading_material_id": None,
                "title": "",
                "started_at": updated_at,
                "ended_at": None,
                "effective_seconds": 0,
                "idle_seconds": 0,
                "pause_count": 0,
                "completion_method": "",
                "progress_json": _json_dumps(progress),
                "events_json": _json_dumps(
                    [{"type": "migrated_progress", "at": updated_at.isoformat()}]
                ),
                "summary_json": _json_dumps({"migrated_from": "session_progress"}),
                "deleted_at": None,
                "deleted_reason": None,
                "created_at": updated_at,
                "updated_at": updated_at,
            },
        )


def upgrade() -> None:
    if not _table_exists("study_sessions"):
        op.create_table(
            "study_sessions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            sa.Column("scene", sa.String(length=40), nullable=False),
            sa.Column("target_type", sa.String(length=40), nullable=False, server_default="none"),
            sa.Column("target_id", sa.Integer(), nullable=True),
            sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="SET NULL")),
            sa.Column(
                "palace_segment_id",
                sa.Integer(),
                sa.ForeignKey("palace_segments.id", ondelete="SET NULL"),
            ),
            sa.Column(
                "mini_palace_id",
                sa.Integer(),
                sa.ForeignKey("palace_mini_palaces.id", ondelete="SET NULL"),
            ),
            sa.Column("english_course_id", sa.Integer(), nullable=True),
            sa.Column("english_reading_material_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=300), nullable=False, server_default=""),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("ended_at", sa.DateTime(), nullable=True),
            sa.Column("effective_seconds", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("idle_seconds", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("pause_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completion_method", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("progress_json", sa.Text(), nullable=True, server_default="{}"),
            sa.Column("events_json", sa.Text(), nullable=True, server_default="[]"),
            sa.Column("summary_json", sa.Text(), nullable=True, server_default="{}"),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("deleted_reason", sa.String(length=32), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
    _create_index_once("ix_study_sessions_status_updated", "study_sessions", ["status", "updated_at"])
    _create_index_once("ix_study_sessions_scene_started", "study_sessions", ["scene", "started_at"])
    _create_index_once(
        "ix_study_sessions_target_status",
        "study_sessions",
        ["target_type", "target_id", "status"],
    )
    _create_index_once("ix_study_sessions_palace_started", "study_sessions", ["palace_id", "started_at"])
    _backfill_from_time_records()
    _backfill_from_session_progress()


def downgrade() -> None:
    # Forward-compatible migration: keep the additive table if a downgrade is invoked.
    return
