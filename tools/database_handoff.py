"""Offline handoff of Memory Anki's SQLite writer. No network or live-file sync.

EXPERIMENTAL AND DISABLED (2026-11-21). This module fences a shared legacy
database with INSERT/UPDATE/DELETE triggers, freezes it, and installs a copy as
the device-local live database. That fence cannot stop an older build or a
direct SQLite client from using DDL/VACUUM/PRAGMA, the offline probe only checks
whether port 8012 answers, and no cross-version run has ever been performed.
The CLI therefore refuses every command, including ``status``, until the
workflow is validated end to end. The runtime no longer imports this layer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import stat
import sys
import tempfile
import uuid
import zipfile
from contextlib import closing
from dataclasses import asdict, replace
from pathlib import Path

API_SRC = Path(__file__).resolve().parents[1] / "apps" / "api" / "src"
if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from memory_anki.core.database_placement import (  # noqa: E402
    DatabaseHandoffError,
    WriterState,
    device_database_root,
    exclusive_database_lifecycle,
    get_device_id,
    installed_database,
    is_device_id,
    local_database_directory,
    placement_marker,
    read_writer_state,
    sqlite_read_only,
)
from memory_anki.core.local_config import load_local_runtime_config  # noqa: E402
from memory_anki.core.runtime_paths import (  # noqa: E402
    APP_HOME_ENV,
    DATABASE_FILE_NAME,
    database_file_path,
)

MANIFEST_NAME = "manifest.json"
SNAPSHOT_FORMAT = "memory-anki-database-handoff-v1"
SECRET_KEY_SQL = "(instr(lower(key), 'api_key') > 0 OR instr(lower(key), 'api_token') > 0)"


def _sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _flush(path: Path) -> None:
    with path.open("r+b") as stream:
        os.fsync(stream.fileno())


def _flush_parent(path: Path) -> None:
    if os.name != "nt":
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _init_device() -> str:
    root = device_database_root()
    root.mkdir(parents=True, exist_ok=True)
    value = get_device_id(root)
    if value is None:
        value = uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix=".init-device-", dir=root) as stage:
            temporary = Path(stage) / "device-id"
            temporary.write_text(value + "\n", encoding="ascii")
            _flush(temporary)
            temporary.rename(root / "device-id")
            _flush_parent(root / "device-id")
    return value


def _legacy_databases(home: Path) -> list[Path]:
    return [p for p in (database_file_path(home), home / "data" / DATABASE_FILE_NAME) if os.path.lexists(p)]


def _sidecars(path: Path) -> list[Path]:
    return [p for suffix in ("-wal", "-shm", "-journal") if os.path.lexists(p := path.with_name(path.name + suffix))]


def _require_offline() -> None:
    # Compatibility with pre-handoff launchers that did not take the lifecycle lock.
    try:
        with socket.create_connection(("127.0.0.1", 8012), timeout=0.35):
            pass
    except ConnectionRefusedError:
        return
    raise DatabaseHandoffError("本机服务端口 8012 仍在使用；请关闭桌面/PWA 服务后再试。")


def _integrity(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA trusted_schema = OFF")
    result = connection.execute("PRAGMA integrity_check").fetchall()
    if result != [("ok",)]:
        raise DatabaseHandoffError("SQLite 完整性检查失败。")
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
    if not {"config", "palaces", "palace_segments", "alembic_version"} <= tables:
        raise DatabaseHandoffError("不是可识别的 Memory Anki 数据库。")


def _read_state(path: Path, *, immutable: bool = False) -> WriterState:
    with closing(sqlite_read_only(path, immutable=immutable)) as connection:
        return read_writer_state(connection)


def _set_state(connection: sqlite3.Connection, state: WriterState, *, create: bool = False) -> None:
    if create:
        connection.execute(
            "CREATE TABLE memory_anki_handoff (singleton INTEGER PRIMARY KEY CHECK(singleton=1),"
            " lineage TEXT NOT NULL, generation INTEGER NOT NULL, device TEXT NOT NULL,"
            " recipient TEXT, base_digest TEXT NOT NULL)"
        )
    connection.execute(
        "INSERT OR REPLACE INTO memory_anki_handoff VALUES (1, ?, ?, ?, ?, ?)",
        (state.lineage, state.generation, state.device, state.recipient, state.base_digest),
    )


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _freeze_legacy_writes(path: Path) -> None:
    """Fence the old DB before snapshotting it so later writes cannot be lost.

    The triggers live inside SQLite itself, so an older app build that does not
    know the handoff protocol still cannot mutate any existing application table.
    """
    with closing(sqlite3.connect(path, timeout=30)) as connection:
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS handoff_guard_state "
            "(key TEXT PRIMARY KEY, frozen INTEGER NOT NULL CHECK(frozen IN (0,1)))"
        )
        connection.execute(
            "INSERT INTO handoff_guard_state(key, frozen) VALUES ('singleton', 0) "
            "ON CONFLICT(key) DO NOTHING"
        )
        table_rows = connection.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "AND name != 'handoff_guard_state'"
        ).fetchall()
        existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
        for table_name, create_sql in table_rows:
            if not create_sql or create_sql.lstrip().upper().startswith("CREATE VIRTUAL TABLE"):
                continue
            table = _quote_identifier(str(table_name))
            digest = hashlib.sha256(str(table_name).encode("utf-8")).hexdigest()[:20]
            for operation in ("INSERT", "UPDATE", "DELETE"):
                trigger_name = f"handoff_block_{digest}_{operation.lower()}"
                trigger = _quote_identifier(trigger_name)
                if trigger_name in existing:
                    sql = connection.execute(
                        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?", (trigger_name,)
                    ).fetchone()
                    if not sql or "handoff_guard_state" not in sql[0] or "RAISE(ABORT" not in sql[0]:
                        raise DatabaseHandoffError("旧数据库中存在冲突的冻结触发器；未变更写入权限。")
                    continue
                connection.execute(
                    f"CREATE TRIGGER {trigger} BEFORE {operation} ON {table} "
                    "WHEN (SELECT frozen FROM handoff_guard_state WHERE key='singleton') = 1 "
                    "BEGIN SELECT RAISE(ABORT, 'Memory Anki database writer was relinquished'); END"
                )
        connection.execute("UPDATE handoff_guard_state SET frozen=1 WHERE key='singleton'")
        connection.commit()
        checkpoint = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if checkpoint is not None and checkpoint[0] != 0:
            raise DatabaseHandoffError("共享旧数据库仍被其他进程打开；已阻止写入，关闭其他设备服务后重试迁移。")
        journal_mode = connection.execute("PRAGMA journal_mode=DELETE").fetchone()
        if journal_mode != ("delete",):
            raise DatabaseHandoffError("共享旧数据库仍使用 WAL；已阻止写入，关闭其他设备服务后重试迁移。")


def _remove_legacy_write_guard(path: Path) -> None:
    """Remove the compatibility barrier from a private local clone only."""
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        triggers = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'handoff_block_%'"
        ).fetchall()
        connection.execute("UPDATE handoff_guard_state SET frozen=0 WHERE key='singleton'")
        for (name,) in triggers:
            connection.execute(f"DROP TRIGGER {_quote_identifier(str(name))}")
        connection.execute("DROP TABLE handoff_guard_state")
        connection.commit()


def _base_digest(path: Path) -> str:
    """Fingerprint all app tables except the handoff protocol tables."""
    digest = hashlib.sha256()
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        tables = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'handoff_%' ORDER BY name"
        ).fetchall()
        for (table_name,) in tables:
            name = str(table_name)
            quoted = _quote_identifier(name)
            digest.update(name.encode("utf-8"))
            digest.update(b"\\0")
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted})")]
            order = [row[1] for row in sorted(connection.execute(f"PRAGMA table_info({quoted}").fetchall(), key=lambda row: row[5] or 1_000_000) if row[5]] or columns
            if not columns:
                continue
            query = f"SELECT {', '.join(_quote_identifier(column) for column in columns)} FROM {quoted}"
            if order:
                query += " ORDER BY " + ", ".join(_quote_identifier(column) for column in order)
            for values in connection.execute(query):
                digest.update(json.dumps([value.hex() if isinstance(value, bytes) else value for value in values], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
                digest.update(b"\\n")
    return digest.hexdigest()


def _copy_database(source: Path, target: Path) -> None:
    from memory_anki.core.windows_wmi import disable_hanging_windows_wmi

    disable_hanging_windows_wmi()
    from memory_anki.modules.backups.application.storage_backup import _sqlite_online_backup

    # Experimental: the workflow is disabled at the CLI. If it is re-enabled,
    # verify the snapshot instead of relying on a raw byte fallback.
    _sqlite_online_backup(source, target)


def _switch_to_standalone(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA trusted_schema=OFF")
    if connection.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
        raise DatabaseHandoffError("无法生成不依赖日志文件的独立 SQLite 快照。")
    connection.execute("PRAGMA synchronous=FULL")


def _install_first(stage: Path) -> Path:
    # Placement marker and database survive one-device app-home configuration changes.
    root = device_database_root()
    local = local_database_directory()
    if os.path.lexists(local):
        raise DatabaseHandoffError(f"本机数据库目录已存在：{local}")
    _flush_parent(stage / DATABASE_FILE_NAME)
    stage.rename(local)
    _flush_parent(local)
    marker = root / "placement-enabled"
    marker_tmp = root / ".placement-enabled.tmp"
    marker_tmp.write_text("sqlite-handoff-v1\n", encoding="ascii")
    _flush(marker_tmp)
    marker_tmp.replace(marker)
    _flush_parent(marker)
    return local / DATABASE_FILE_NAME


def migrate_to_local(home: Path) -> Path:
    with exclusive_database_lifecycle():
        _require_offline()
        if installed_database(allow_missing_enabled=True) is not None:
            raise DatabaseHandoffError("已启用本机数据库；不会重复迁移或覆盖。")
        if placement_marker().exists():
            raise DatabaseHandoffError("本机库已启用但缺失；先恢复原快照，不会用旧库覆盖或重建。")
        sources = _legacy_databases(home)
        if len(sources) != 1 or not sources[0].is_file():
            raise DatabaseHandoffError("旧位置必须只有一份明确的 Memory Anki 数据库。")
        device = _init_device()
        with tempfile.TemporaryDirectory(prefix=".migrate-", dir=device_database_root()) as work:
            stage = Path(work) / "db"
            stage.mkdir()
            db = stage / DATABASE_FILE_NAME
            _freeze_legacy_writes(sources[0])
            _copy_database(sources[0], db)
            with closing(sqlite3.connect(db)) as connection:
                _remove_legacy_write_guard(db)
                _switch_to_standalone(connection)
                _integrity(connection)
                _set_state(
                    connection,
                    WriterState(uuid.uuid4().hex, 0, device, None, uuid.uuid4().hex),
                    create=True,
                )
                connection.commit()
            _flush(db)
            return _install_first(stage)


def _reminder_payload(connection: sqlite3.Connection) -> dict:
    result = connection.execute("SELECT value FROM config WHERE key='reminders.settings'").fetchone()
    if not result or not result[0]:
        return {}
    payload = json.loads(result[0])
    if not isinstance(payload, dict):
        raise DatabaseHandoffError("提醒设置无法校验；请先修正本机提醒设置。")
    return payload


def _scrub(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA secure_delete=ON")
    connection.execute(f"DELETE FROM config WHERE {SECRET_KEY_SQL} OR key GLOB 'api_mutation.*'")
    payload = _reminder_payload(connection)
    if "bark_key" in payload:
        payload.pop("bark_key")
        connection.execute("UPDATE config SET value=? WHERE key='reminders.settings'", (json.dumps(payload),))
    connection.commit()
    # Remove historical key values in unused pages and b-tree slack; the
    # unredacted working copy never enters the user-selected transfer folder.
    connection.execute("VACUUM")


def _restore_local_keys(source: Path, target: sqlite3.Connection) -> None:
    with closing(sqlite_read_only(source, immutable=True)) as current:
        rows = current.execute(f"SELECT key, value FROM config WHERE {SECRET_KEY_SQL}").fetchall()
        bark_key = _reminder_payload(current).get("bark_key")
    target.executemany("INSERT INTO config(key, value) VALUES (?, ?)", rows)
    if bark_key:
        payload = _reminder_payload(target)
        payload["bark_key"] = bark_key
        target.execute(
            "INSERT INTO config(key, value) VALUES ('reminders.settings', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(payload),),
        )


def _publish(source: Path, output: Path) -> None:
    # Atomic and no-clobber even with a concurrent publisher.
    if os.name == "nt":
        source.rename(output)
    else:
        os.link(source, output)
    _flush_parent(output)


def export_snapshot(output: Path, recipient: str) -> WriterState:
    if not is_device_id(recipient):
        raise DatabaseHandoffError("接收设备编号无效。")
    output = output.absolute()
    with exclusive_database_lifecycle():
        _require_offline()
        root = device_database_root()
        device = get_device_id(root)
        source = installed_database()
        if source is None or device is None:
            raise DatabaseHandoffError("请先显式迁移到本机数据库，或导入交接快照。")
        if output.resolve(strict=False).is_relative_to(root.resolve()):
            raise DatabaseHandoffError("请选择本机数据库目录以外的快照文件（建议扩展名 .zip）。")
        if output.name.casefold().endswith((".db", "-wal", "-shm", "-journal")):
            raise DatabaseHandoffError("快照使用 .zip 扩展名，不会作为活动数据库或 SQLite 日志共享。")
        if not output.parent.is_dir():
            raise DatabaseHandoffError("快照目标目录必须已存在。")
        output.parent.mkdir(parents=True, exist_ok=True)
        if os.path.lexists(output):
            raise DatabaseHandoffError(f"快照文件已存在，不会覆盖：{output}")
        state = _read_state(source)
        if state.device != device or recipient == device or (state.recipient is not None and state.recipient != recipient):
            raise DatabaseHandoffError("这台设备不是写入者，或已经交接给另一台设备；不能导出到此设备。")
        pending = replace(state, generation=state.generation + 1, recipient=recipient) if state.recipient is None else state
        with tempfile.TemporaryDirectory(prefix=".export-", dir=root) as work:
            snapshot = Path(work) / DATABASE_FILE_NAME
            _copy_database(source, snapshot)
            with closing(sqlite3.connect(snapshot)) as connection:
                _switch_to_standalone(connection)
                _integrity(connection)
                _scrub(connection)
                _set_state(connection, pending)
                connection.commit()
                _integrity(connection)
            manifest = {"format": SNAPSHOT_FORMAT, "writer": asdict(pending), "size": snapshot.stat().st_size, "sha256": _sha256(snapshot)}
            transfer = Path(work) / "snapshot.zip"
            with zipfile.ZipFile(transfer, "x", compression=zipfile.ZIP_STORED) as bundle:
                bundle.writestr(MANIFEST_NAME, json.dumps(manifest))
                bundle.write(snapshot, DATABASE_FILE_NAME)
            # No transfer bytes may reach a shared folder before relinquishing.
            with tempfile.TemporaryDirectory(prefix=".handoff-stage-", dir=output.parent) as publication:
                if state.recipient is None:
                    with closing(sqlite3.connect(source)) as connection:
                        connection.execute("PRAGMA synchronous=FULL")
                        _set_state(connection, pending)
                        connection.commit()
                staged = Path(publication) / "snapshot.tmp"
                shutil.copyfile(transfer, staged)
                _flush(staged)
                _publish(staged, output)
        return pending


def _validate_bundle(bundle_path: Path, staged: Path) -> WriterState:
    with zipfile.ZipFile(bundle_path) as bundle:
        if sorted(bundle.namelist()) != sorted([MANIFEST_NAME, DATABASE_FILE_NAME]):
            raise DatabaseHandoffError("快照只能包含清单和一份 SQLite 数据库。")
        if bundle.getinfo(MANIFEST_NAME).file_size > 4096:
            raise DatabaseHandoffError("快照清单过大。")
        manifest = json.loads(bundle.read(MANIFEST_NAME))
        if not isinstance(manifest, dict) or manifest.get("format") != SNAPSHOT_FORMAT:
            raise DatabaseHandoffError("快照格式不受支持。")
        db_info = bundle.getinfo(DATABASE_FILE_NAME)
        if (db_info.compress_type != zipfile.ZIP_STORED or type(manifest.get("size")) is not int
                or manifest["size"] != db_info.file_size or db_info.file_size > bundle_path.stat().st_size):
            raise DatabaseHandoffError("快照长度不匹配。")
        with bundle.open(db_info) as source, staged.open("xb") as destination:
            shutil.copyfileobj(source, destination, length=1024 * 1024)
    if manifest.get("sha256") != _sha256(staged):
        raise DatabaseHandoffError("快照 SHA-256 不匹配。")
    with staged.open("rb") as stream:
        header = stream.read(20)
    if header[:16] != b"SQLite format 3\x00" or header[18:20] != b"\x01\x01":
        raise DatabaseHandoffError("快照不是独立 SQLite 文件。")
    with closing(sqlite_read_only(staged, immutable=True)) as connection:
        _integrity(connection)
        state = read_writer_state(connection)
        if connection.execute("PRAGMA journal_mode").fetchone() != ("delete",):
            raise DatabaseHandoffError("快照不是独立 SQLite 文件。")
        if state.recipient is None or state.generation < 1 or asdict(state) != manifest.get("writer"):
            raise DatabaseHandoffError("交接快照的写入权记录与清单不符。")
        if connection.execute(f"SELECT 1 FROM config WHERE {SECRET_KEY_SQL} OR key GLOB 'api_mutation.*' LIMIT 1").fetchone() or "bark_key" in _reminder_payload(connection):
            raise DatabaseHandoffError("快照含本机凭据或请求缓存，不会导入。")
    return state


def verify_snapshot(bundle_path: Path) -> WriterState:
    with tempfile.TemporaryDirectory(prefix="memory-anki-verify-") as stage:
        return _validate_bundle(bundle_path, Path(stage) / DATABASE_FILE_NAME)


def import_snapshot(home: Path, bundle: Path, *, leave_legacy: bool = False) -> Path:
    with exclusive_database_lifecycle():
        _require_offline()
        device = _init_device()
        current = installed_database()
        if current is None and _legacy_databases(home) and not leave_legacy:
            raise DatabaseHandoffError("仍有旧位置数据库；确认不覆盖且不再打开旧库后，加 --leave-legacy。")
        if current is not None and _sidecars(current):
            raise DatabaseHandoffError("本机数据库仍有 SQLite 日志文件；禁止覆盖。请先正常关闭服务并检查旧库。")
        with tempfile.TemporaryDirectory(prefix=".import-", dir=device_database_root()) as work:
            stage = Path(work) / "db"
            stage.mkdir()
            db = stage / DATABASE_FILE_NAME
            incoming = _validate_bundle(bundle, db)
            if incoming.recipient != device:
                raise DatabaseHandoffError("快照不是交接给本机的。")
            if current is not None:
                previous = _read_state(current, immutable=True)
                if previous.device != device or previous.recipient is None:
                    raise DatabaseHandoffError("本机仍有写入权；不会覆盖正在使用的数据。")
                if incoming.lineage != previous.lineage or incoming.generation <= previous.generation:
                    raise DatabaseHandoffError("快照属于另一条数据历史或版本不够新；不会覆盖本机数据。")
            with closing(sqlite3.connect(db)) as connection:
                _switch_to_standalone(connection)
                connection.execute("PRAGMA trusted_schema=OFF")
                _set_state(connection, replace(incoming, device=device, recipient=None))
                if current is not None:
                    _restore_local_keys(current, connection)
                connection.commit()
                _integrity(connection)
            _flush(db)
            legacy_sources = _legacy_databases(home)
            for legacy in legacy_sources:
                if legacy.resolve() not in {current.resolve() if current else None, db.resolve()}:
                    _freeze_legacy_writes(legacy)
            if current is None:
                return _install_first(stage)
            if _sidecars(current):
                raise DatabaseHandoffError("本机 SQLite 日志文件重新出现；停止导入。")
            db.replace(current)
            _flush_parent(current)
            return current


def _app_home() -> Path:
    value = os.environ.get(APP_HOME_ENV, "").strip()
    if value:
        return Path(os.path.expandvars(value)).expanduser().resolve()
    return load_local_runtime_config(write_device_id=False).local_app_home.resolve()


HANDOFF_WORKFLOW_ENABLED = False


def main(argv: list[str] | None = None) -> int:
    if not HANDOFF_WORKFLOW_ENABLED:
        print(
            "数据库交接流程尚未验证，已默认停用：不执行任何命令（包括 status）。\n"
            "它会在共享旧库上安装冻结触发器并改写旧库，且无法阻止旧版本或直接 SQLite 写入。\n"
            "在完成跨版本验证前，请继续使用普通启动、Alembic 迁移和备份恢复。",
            file=sys.stderr,
        )
        return 2
    parser = argparse.ArgumentParser(description="显式交接 Memory Anki 的本机数据库写入权。")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="查看本机设备编号和写入状态")
    commands.add_parser("migrate-to-local", help="保留旧库，显式启用本机数据库")
    exporter = commands.add_parser("export", help="停用本机写入，生成给指定设备的已校验快照")
    exporter.add_argument("snapshot", type=Path)
    exporter.add_argument("--to-device", required=True)
    verifier = commands.add_parser("verify", help="校验快照，不改本机数据库")
    verifier.add_argument("snapshot", type=Path)
    importer = commands.add_parser("import", help="校验并接收快照及写入权")
    importer.add_argument("snapshot", type=Path)
    importer.add_argument("--leave-legacy", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            with exclusive_database_lifecycle():
                device = _init_device()
                db = installed_database()
                print(f"设备编号：{device}")
                if db is None:
                    print(f"本机数据库未启用。旧数据目录：{_app_home()}")
                else:
                    state = _read_state(db)
                    print(f"本机数据库：{db}\n交接版本：{state.generation}")
                    if state.recipient:
                        print(f"已停止写入；接收设备：{state.recipient}")
                    else:
                        print("本机拥有写入权。" if state.device == device else "本机没有写入权。")
        elif args.command == "migrate-to-local":
            print(f"已启用本机数据库，旧库已保留：{migrate_to_local(_app_home())}")
        elif args.command == "export":
            state = export_snapshot(args.snapshot, args.to_device.strip().lower())
            print(f"已导出版本 {state.generation}，本机已停止写入：{args.snapshot}")
        elif args.command == "verify":
            state = verify_snapshot(args.snapshot)
            print(f"快照版本 {state.generation} 校验通过；接收设备：{state.recipient}")
        elif args.command == "import":
            print(f"已接收本机写入权：{import_snapshot(_app_home(), args.snapshot, leave_legacy=args.leave_legacy)}")
    except (OSError, RuntimeError, ValueError, sqlite3.Error, zipfile.BadZipFile) as exc:
        print(f"操作未完成：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
