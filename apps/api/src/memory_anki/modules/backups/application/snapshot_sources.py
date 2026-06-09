from __future__ import annotations

import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path

from memory_anki.core.config import REPO_ROOT


@dataclass
class PalaceSnapshot:
    palace_row: dict
    pegs: list[dict]
    chapter_ids: list[int]


def fetch_snapshot_from_sqlite(db_path: Path, palace_id: int) -> PalaceSnapshot | None:
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    try:
        palace_row = connection.execute(
            "SELECT * FROM palaces WHERE id = ?",
            (palace_id,),
        ).fetchone()
        if palace_row is None:
            return None
        pegs = [
            dict(row)
            for row in connection.execute(
                """
                SELECT id, palace_id, parent_id, name, content, sort_order
                FROM pegs
                WHERE palace_id = ?
                ORDER BY parent_id IS NOT NULL, sort_order, id
                """,
                (palace_id,),
            ).fetchall()
        ]
        chapter_ids = [
            int(row["chapter_id"])
            for row in connection.execute(
                "SELECT chapter_id FROM chapter_palaces WHERE palace_id = ? ORDER BY id",
                (palace_id,),
            ).fetchall()
        ]
        return PalaceSnapshot(
            palace_row=dict(palace_row),
            pegs=pegs,
            chapter_ids=chapter_ids,
        )
    finally:
        connection.close()


def export_git_snapshot_db(commit: str, destination: Path) -> Path:
    try:
        db_bytes = subprocess.check_output(
            ["git", "show", f"{commit}:data/memory_palace.db"],
            cwd=REPO_ROOT,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        raise FileNotFoundError(
            "指定提交中不存在 legacy 仓库数据库快照。当前版本已停止把运行数据提交到 Git，请改用本地 full/rescue 备份恢复。"
        ) from exc
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(db_bytes)
    return destination
