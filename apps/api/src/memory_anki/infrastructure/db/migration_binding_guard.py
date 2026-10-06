"""Read-only safety preflight for the existing destructive quiz binding revision.

Call with application writers stopped. This preflight and Alembic's subsequent
transaction are separate: it cannot protect against an external concurrent writer.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BINDING_REVISION = "0050_quiz_node_binding_single_palace"

_CROSS_PALACE = """
    EXISTS (
        SELECT 1 FROM palace_quiz_questions AS q
        WHERE q.id = b.question_id
          AND q.palace_id IS NOT NULL
          AND q.palace_id <> b.palace_id
    )
"""


def ensure_binding_migration_safe(config: Config, database_path: Path) -> None:
    """Refuse pending binding cleanup if it would delete any existing binding.

    Never create a database, execute migrations, repair bindings, or stamp revisions.
    An absent binding table is safe here: there are no existing bindings to delete.
    """
    if not database_path.exists():
        return
    try:
        with closing(sqlite3.connect(database_path.resolve().as_uri() + "?mode=ro", uri=True)) as conn:
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            tables = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            current = (
                tuple(row[0] for row in conn.execute("SELECT version_num FROM alembic_version"))
                if "alembic_version" in tables
                else ()
            )
            graph = ScriptDirectory.from_config(config)
            # Include unapplied sibling branches, not just descendants of current heads.
            pending = {
                revision.revision
                for revision in graph.iterate_revisions("head", current, implicit_base=True)
            }
            if BINDING_REVISION not in pending:
                return
            if "palace_quiz_question_node_bindings" not in tables:
                return
            cross_palace = conn.execute(
                "SELECT COUNT(*) FROM palace_quiz_question_node_bindings AS b WHERE "
                + _CROSS_PALACE
            ).fetchone()[0]
            # The second DELETE operates on rows surviving the first DELETE.
            duplicates = conn.execute(
                "WITH survivors AS ("
                "SELECT b.id, b.question_id, b.node_uid "
                "FROM palace_quiz_question_node_bindings AS b WHERE NOT "
                + _CROSS_PALACE
                + ") SELECT COUNT(*) FROM survivors WHERE id NOT IN "
                "(SELECT MIN(id) FROM survivors GROUP BY question_id, node_uid)"
            ).fetchone()[0]
            if cross_palace or duplicates:
                raise RuntimeError(
                    f"Migration {BINDING_REVISION} blocked to preserve quiz bindings: "
                    f"{cross_palace} cross-palace binding(s) and {duplicates} additional "
                    "duplicate binding(s) would be deleted. No migrations were run. "
                    "Stop all writers and request an explicit user decision on these bindings "
                    "before a separately reviewed repair. Do not stamp or bypass this guard."
                )
    except sqlite3.Error as exc:
        raise RuntimeError(
            f"Cannot safely inspect bindings before {BINDING_REVISION}; no migrations were run. "
            "Stop all writers and investigate the database/schema before retrying."
        ) from exc
