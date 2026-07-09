"""Whole-database export/import as a portable zip."""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Date, DateTime, Table, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables import Base, engine

ARCHIVE_FORMAT_VERSION = 1
DATA_JSON_NAME = "data.json"
MANIFEST_JSON_NAME = "manifest.json"
ATTACHMENTS_PREFIX = "attachments/"


class FullTransferError(ValueError):
    pass


def _current_alembic_revision(session: Session) -> str:
    try:
        row = session.execute(text("SELECT version_num FROM alembic_version")).fetchone()
        return str(row[0]) if row else ""
    except Exception:
        return ""


def _json_default(value: Any) -> str:
    if isinstance(value, datetime | date):
        return value.isoformat()
    return str(value)


def _dump_all_tables(session: Session) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for table in Base.metadata.sorted_tables:
        rows = session.execute(table.select()).mappings().all()
        result[table.name] = [dict(row) for row in rows]
    return result


def build_full_archive(session: Session) -> tuple[bytes, str]:
    """Return zip bytes and a suggested download filename."""
    data = _dump_all_tables(session)
    manifest = {
        "format_version": ARCHIVE_FORMAT_VERSION,
        "alembic_revision": _current_alembic_revision(session),
        "created_at": utc_now_naive().isoformat(timespec="seconds"),
        "table_counts": {name: len(rows) for name, rows in data.items()},
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            MANIFEST_JSON_NAME,
            json.dumps(manifest, ensure_ascii=False, indent=2),
        )
        archive.writestr(
            DATA_JSON_NAME,
            json.dumps(data, ensure_ascii=False, default=_json_default),
        )
        attachments_root = Path(ATTACHMENTS_DIR)
        if attachments_root.exists():
            for file_path in attachments_root.rglob("*"):
                if not file_path.is_file():
                    continue
                relative = file_path.relative_to(attachments_root).as_posix()
                archive.write(file_path, ATTACHMENTS_PREFIX + relative)
    filename = f"memory-anki-full-{date.today().strftime('%Y%m%d')}.zip"
    return buffer.getvalue(), filename


def inspect_archive(zip_bytes: bytes, session: Session) -> dict[str, Any]:
    """Validate an archive and return an import preview without writing data."""
    with _open_archive(zip_bytes) as archive:
        names = set(archive.namelist())
        if MANIFEST_JSON_NAME not in names or DATA_JSON_NAME not in names:
            raise FullTransferError("zip 内缺少 manifest.json 或 data.json，不是全量导出包。")
        manifest = _read_json_member(archive, MANIFEST_JSON_NAME)
        if not isinstance(manifest, dict):
            raise FullTransferError("manifest.json 格式不正确。")
        if int(manifest.get("format_version") or 0) != ARCHIVE_FORMAT_VERSION:
            raise FullTransferError("导出包格式版本不兼容。")
        _read_data_json(archive)
        current_revision = _current_alembic_revision(session)
        archive_revision = str(manifest.get("alembic_revision") or "")
        attachment_count = sum(
            1
            for name in names
            if name.startswith(ATTACHMENTS_PREFIX) and not name.endswith("/")
        )
        return {
            "manifest": manifest,
            "attachment_count": attachment_count,
            "schema_match": bool(current_revision) and archive_revision == current_revision,
            "current_alembic_revision": current_revision,
        }


def import_full_archive(zip_bytes: bytes, session: Session) -> dict[str, Any]:
    """Replace all managed tables and attachments with archive contents."""
    preview = inspect_archive(zip_bytes, session)
    if not preview["schema_match"]:
        raise FullTransferError(
            "导出包的数据库版本与当前程序不一致，请先把两台设备升级到同一版本再迁移。"
        )

    bind = session.get_bind() or engine
    session.close()

    with _open_archive(zip_bytes) as archive:
        data = _read_data_json(archive)
        imported_counts = _replace_tables(bind, data)
        restored_attachments = _replace_attachments(archive)

    return {
        "table_counts": imported_counts,
        "restored_attachments": restored_attachments,
    }


def _open_archive(zip_bytes: bytes) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise FullTransferError("上传的文件不是有效的 zip。") from exc


def _read_json_member(archive: zipfile.ZipFile, name: str) -> Any:
    try:
        return json.loads(archive.read(name))
    except (KeyError, json.JSONDecodeError) as exc:
        raise FullTransferError(f"{name} 不是有效的 JSON。") from exc


def _read_data_json(archive: zipfile.ZipFile) -> dict[str, list[dict[str, Any]]]:
    data = _read_json_member(archive, DATA_JSON_NAME)
    if not isinstance(data, dict):
        raise FullTransferError("data.json 格式不正确。")
    for table_name, rows in data.items():
        if not isinstance(table_name, str) or not isinstance(rows, list):
            raise FullTransferError("data.json 表数据格式不正确。")
        if any(not isinstance(row, dict) for row in rows):
            raise FullTransferError("data.json 行数据格式不正确。")
    return data


def _replace_tables(
    bind: Engine,
    data: dict[str, list[dict[str, Any]]],
) -> dict[str, int]:
    imported_counts: dict[str, int] = {}
    with bind.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        try:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
            for table in Base.metadata.sorted_tables:
                rows = data.get(table.name) or []
                if not rows:
                    imported_counts[table.name] = 0
                    continue
                cleaned = [_coerce_row_types(table, row) for row in rows]
                connection.execute(table.insert(), cleaned)
                imported_counts[table.name] = len(cleaned)
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    return imported_counts


def _coerce_row_types(table: Table, row: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    columns = {column.name: column for column in table.columns}
    for key, value in row.items():
        column = columns.get(key)
        if column is None:
            continue
        if value is not None and isinstance(column.type, DateTime) and isinstance(value, str):
            cleaned[key] = datetime.fromisoformat(value)
        elif value is not None and isinstance(column.type, Date) and isinstance(value, str):
            cleaned[key] = date.fromisoformat(value)
        else:
            cleaned[key] = value
    return cleaned


def _replace_attachments(archive: zipfile.ZipFile) -> int:
    attachments_root = Path(ATTACHMENTS_DIR)
    root_resolved = attachments_root.resolve()
    if attachments_root.exists():
        shutil.rmtree(attachments_root)
    attachments_root.mkdir(parents=True, exist_ok=True)

    restored_attachments = 0
    for name in archive.namelist():
        if not name.startswith(ATTACHMENTS_PREFIX) or name.endswith("/"):
            continue
        relative = name[len(ATTACHMENTS_PREFIX) :]
        target = (attachments_root / relative).resolve()
        if root_resolved not in target.parents and target != root_resolved:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(name))
        restored_attachments += 1
    return restored_attachments
