"""add freestyle history tables

Revision ID: 0012_freestyle_history
Revises: 0011_database_performance_indexes
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012_freestyle_history"
down_revision = "0011_database_performance_indexes"
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


def _drop_index_once(index_name: str) -> None:
    if not _index_exists(index_name):
        return
    op.drop_index(index_name)


def upgrade() -> None:
    if not _table_exists("freestyle_quiz_attempts"):
        op.create_table(
            "freestyle_quiz_attempts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "question_id",
                sa.Integer(),
                sa.ForeignKey("palace_quiz_questions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "palace_id",
                sa.Integer(),
                sa.ForeignKey("palaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("palace_title", sa.String(length=200), nullable=False, server_default=""),
            sa.Column(
                "mini_palace_id",
                sa.Integer(),
                sa.ForeignKey("palace_mini_palaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("mini_palace_name", sa.String(length=200), nullable=False, server_default=""),
            sa.Column(
                "chapter_id",
                sa.Integer(),
                sa.ForeignKey("chapters.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("chapter_name", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("mode", sa.String(length=20), nullable=False, server_default="free"),
            sa.Column("question_type", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("stem_snapshot", sa.Text(), nullable=False, server_default=""),
            sa.Column("answer_payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("is_correct", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    if not _table_exists("freestyle_ai_explanations"):
        op.create_table(
            "freestyle_ai_explanations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "question_id",
                sa.Integer(),
                sa.ForeignKey("palace_quiz_questions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "palace_id",
                sa.Integer(),
                sa.ForeignKey("palaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("palace_title", sa.String(length=200), nullable=False, server_default=""),
            sa.Column(
                "mini_palace_id",
                sa.Integer(),
                sa.ForeignKey("palace_mini_palaces.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("mini_palace_name", sa.String(length=200), nullable=False, server_default=""),
            sa.Column(
                "chapter_id",
                sa.Integer(),
                sa.ForeignKey("chapters.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("chapter_name", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("question_type", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("stem_snapshot", sa.Text(), nullable=False, server_default=""),
            sa.Column("user_question", sa.Text(), nullable=False, server_default=""),
            sa.Column("explanation_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("ai_call_log_id", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )

    _create_index_once("ix_freestyle_quiz_attempts_created", "freestyle_quiz_attempts", ["created_at", "id"])
    _create_index_once(
        "ix_freestyle_quiz_attempts_palace_created",
        "freestyle_quiz_attempts",
        ["palace_id", "created_at"],
    )
    _create_index_once(
        "ix_freestyle_quiz_attempts_question_created",
        "freestyle_quiz_attempts",
        ["question_id", "created_at"],
    )
    _create_index_once(
        "ix_freestyle_quiz_attempts_mode_created",
        "freestyle_quiz_attempts",
        ["mode", "created_at"],
    )
    _create_index_once(
        "ix_freestyle_ai_explanations_created",
        "freestyle_ai_explanations",
        ["created_at", "id"],
    )
    _create_index_once(
        "ix_freestyle_ai_explanations_palace_created",
        "freestyle_ai_explanations",
        ["palace_id", "created_at"],
    )
    _create_index_once(
        "ix_freestyle_ai_explanations_question_created",
        "freestyle_ai_explanations",
        ["question_id", "created_at"],
    )
    _create_index_once(
        "ix_freestyle_ai_explanations_log",
        "freestyle_ai_explanations",
        ["ai_call_log_id"],
    )


def downgrade() -> None:
    _drop_index_once("ix_freestyle_ai_explanations_log")
    _drop_index_once("ix_freestyle_ai_explanations_question_created")
    _drop_index_once("ix_freestyle_ai_explanations_palace_created")
    _drop_index_once("ix_freestyle_ai_explanations_created")
    _drop_index_once("ix_freestyle_quiz_attempts_mode_created")
    _drop_index_once("ix_freestyle_quiz_attempts_question_created")
    _drop_index_once("ix_freestyle_quiz_attempts_palace_created")
    _drop_index_once("ix_freestyle_quiz_attempts_created")
    if _table_exists("freestyle_ai_explanations"):
        op.drop_table("freestyle_ai_explanations")
    if _table_exists("freestyle_quiz_attempts"):
        op.drop_table("freestyle_quiz_attempts")
