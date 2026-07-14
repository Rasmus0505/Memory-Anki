from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable

DB_RELATIVE_PATH = Path("data") / "memory_palace.db"


def default_app_home() -> Path:
    explicit = os.environ.get("MEMORY_ANKI_HOME")
    if explicit:
        return Path(explicit).expanduser().resolve()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is unavailable; pass --home explicitly.")
    return (Path(local_app_data) / "MemoryAnki").resolve()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_value(value: Any) -> Any:
    return {"bytes": value.hex()} if isinstance(value, bytes) else value


def digest_rows(rows: Iterable[tuple[Any, ...]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps([normalized_value(value) for value in row], ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def sqlite_manifest(database_path: Path) -> dict[str, Any]:
    uri = f"file:{database_path.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        foreign_keys = [list(row) for row in connection.execute("PRAGMA foreign_key_check")]
        table_names = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        tables: dict[str, Any] = {}
        for table in table_names:
            table_info = list(connection.execute(f"PRAGMA table_info({quote_identifier(table)})"))
            columns = [row[1] for row in table_info]
            primary_keys = [row[1] for row in sorted(table_info, key=lambda item: item[5] or 10_000) if row[5]]
            order_columns = primary_keys or columns
            query = f"SELECT {', '.join(map(quote_identifier, columns))} FROM {quote_identifier(table)}"
            if order_columns:
                query += f" ORDER BY {', '.join(map(quote_identifier, order_columns))}"
            rows = list(connection.execute(query))
            primary_key_indexes = [columns.index(column) for column in primary_keys]
            key_rows = [tuple(row[index] for index in primary_key_indexes) for row in rows]
            tables[table] = {
                "rowCount": len(rows),
                "columns": columns,
                "primaryKeyColumns": primary_keys,
                "primaryKeyHash": digest_rows(key_rows),
                "contentHash": digest_rows(rows),
            }
    return {"path": DB_RELATIVE_PATH.as_posix(), "integrityCheck": integrity, "foreignKeyCheck": foreign_keys, "tables": tables}


def create_consistent_snapshot(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as source_connection:
        with sqlite3.connect(destination) as destination_connection:
            source_connection.backup(destination_connection)


def file_manifest(home: Path, excluded_root: Path | None = None) -> dict[str, Any]:
    files: dict[str, Any] = {}
    excluded = excluded_root.resolve() if excluded_root else None
    for path in sorted(candidate for candidate in home.rglob("*") if candidate.is_file()):
        resolved = path.resolve()
        if excluded and (resolved == excluded or excluded in resolved.parents):
            continue
        relative = path.relative_to(home).as_posix()
        if relative == DB_RELATIVE_PATH.as_posix() or relative.endswith(("-wal", "-shm")):
            continue
        files[relative] = {"size": path.stat().st_size, "sha256": sha256_file(path)}
    return files


def build_manifest(home: Path, snapshot_dir: Path | None = None) -> dict[str, Any]:
    home = home.resolve()
    database_path = home / DB_RELATIVE_PATH
    if not database_path.exists():
        raise FileNotFoundError(f"Memory Anki database not found: {database_path}")
    manifest_database = database_path
    if snapshot_dir:
        snapshot_dir = snapshot_dir.resolve()
        manifest_database = snapshot_dir / DB_RELATIVE_PATH.name
        create_consistent_snapshot(database_path, manifest_database)
    return {"schemaVersion": 1, "home": str(home), "database": sqlite_manifest(manifest_database), "files": file_manifest(home, snapshot_dir)}


def compare_manifests(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    differences: list[str] = []
    before_database = before.get("database", {})
    after_database = after.get("database", {})
    for table in sorted(set(before_database.get("tables", {})) | set(after_database.get("tables", {}))):
        if before_database.get("tables", {}).get(table) != after_database.get("tables", {}).get(table):
            differences.append(f"database table changed: {table}")
    for relative in sorted(set(before.get("files", {})) | set(after.get("files", {}))):
        if before.get("files", {}).get(relative) != after.get("files", {}).get(relative):
            differences.append(f"file changed: {relative}")
    for field in ("integrityCheck", "foreignKeyCheck"):
        if before_database.get(field) != after_database.get(field):
            differences.append(f"database validation changed: {field}")
    return differences


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Memory Anki runtime data without mutating the source.")
    parser.add_argument("--home", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--snapshot-dir", type=Path)
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    args = parser.parse_args()
    if args.compare:
        before = json.loads(args.compare[0].read_text(encoding="utf-8"))
        after = json.loads(args.compare[1].read_text(encoding="utf-8"))
        differences = compare_manifests(before, after)
        if differences:
            print("Data integrity manifests differ:")
            for difference in differences:
                print(f"- {difference}")
            return 1
        print("Data integrity manifests match.")
        return 0
    if args.output is None:
        parser.error("--output is required unless --compare is used")
    manifest = build_manifest((args.home or default_app_home()).expanduser(), args.snapshot_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    database = manifest["database"]
    if database["integrityCheck"] != ["ok"] or database["foreignKeyCheck"]:
        print("Data integrity audit failed.")
        return 1
    print(f"Data integrity manifest written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())