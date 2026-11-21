"""EXPERIMENTAL, DISABLED local-database placement (2026-11-21).

Nothing in the running app imports this module any more. The runtime always
resolves the database under the requested ``APP_HOME`` (see
``runtime_paths.resolve_database_file``). The handoff CLI that used this layer
refuses to run until the cross-version workflow is validated; see
``tools/database_handoff.py``. Keep this file as lab material, not as a
supported startup path.
"""
from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import AbstractContextManager, closing, contextmanager
from dataclasses import dataclass
from pathlib import Path

from memory_anki.core.runtime_paths import DATABASE_FILE_NAME, default_device_storage


class DatabaseHandoffError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class WriterState:
    lineage: str
    generation: int
    device: str
    recipient: str | None
    base_digest: str


def device_database_root() -> Path:
    storage = default_device_storage()
    base = storage.parent.resolve() / storage.name
    root = base / "database-handoff"
    if root.resolve() != root:
        raise DatabaseHandoffError("本机数据库目录不能通过符号链接或目录联接重定向。")
    if os.name == "nt":
        import ctypes

        # Fixed disk only: not a mapped share, USB drive or redirected profile.
        if ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(root.anchor)) != 3:
            raise DatabaseHandoffError("本机数据库必须位于本机固定磁盘。")
    return root


def local_database_directory() -> Path:
    return device_database_root() / "live"


def placement_marker() -> Path:
    return device_database_root() / "placement-enabled"


def installed_database(*, allow_missing_enabled: bool = False) -> Path | None:
    directory = local_database_directory()
    if not os.path.lexists(directory):
        if placement_marker().exists() and not allow_missing_enabled:
            raise DatabaseHandoffError(
                "本机数据库丢失；检测到已启用的本机放置标记，不会重新打开共享旧库。"
            )
        return None
    path = directory / DATABASE_FILE_NAME
    if directory.resolve() != directory or not path.is_file() or path.resolve() != path:
        raise DatabaseHandoffError(f"本机数据库缺失或路径异常；不会改用旧库：{path}")
    return path


@contextmanager
def exclusive_file(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Keep the lock file after exit: unlinking it can let two processes lock
    # different inodes. The OS releases the handle even if a process crashes.
    with path.open("a+b") as handle:
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise DatabaseHandoffError("数据库正在使用；请关闭本机 Memory Anki 服务后再试。") from exc
        yield


def exclusive_database_lifecycle() -> AbstractContextManager[None]:
    # One lock for launch/prepare/handoff, not for individual SQLite writes.
    return exclusive_file(device_database_root() / "service.lock")


def sqlite_read_only(path: Path, *, immutable: bool = False) -> sqlite3.Connection:
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro" + ("&immutable=1" if immutable else ""), uri=True)


def read_writer_state(connection: sqlite3.Connection) -> WriterState:
    row = connection.execute(
        "SELECT lineage, generation, device, recipient, base_digest FROM memory_anki_handoff"
    ).fetchall()
    if len(row) != 1:
        raise DatabaseHandoffError("本机数据库缺少有效的写入权记录。")
    lineage, generation, device, recipient, base_digest = row[0]
    if (
        not is_device_id(lineage) or type(generation) is not int or generation < 0
        or not is_device_id(device)
        or (recipient is not None and (not is_device_id(recipient) or recipient == device))
        or not is_device_id(base_digest)
    ):
        raise DatabaseHandoffError("本机数据库的写入权记录无效。")
    return WriterState(lineage, generation, device, recipient, base_digest)


def is_device_id(value: object) -> bool:
    return isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def get_device_id(root: Path) -> str | None:
    file = root / "device-id"
    try:
        value = file.read_text(encoding="ascii").strip()
    except FileNotFoundError:
        return None
    if not is_device_id(value):
        raise DatabaseHandoffError(f"本机设备编号无效：{file}")
    return value


def assert_database_can_serve(configured: Path) -> None:
    """Fail closed on any locally frozen shared database before startup writes."""
    from memory_anki.core.runtime_paths import database_file_path

    local = installed_database()
    if local is not None:
        if configured.resolve() != local:
            raise DatabaseHandoffError("本机数据库放置在启动过程中发生变化，请重新启动。")
        with closing(sqlite_read_only(local)) as connection:
            state = read_writer_state(connection)
        if state.device != get_device_id(device_database_root()) or state.recipient is not None:
            raise DatabaseHandoffError("这台设备没有数据库写入权。请先导入交接快照再启动。")
        return

    # Legacy builds have no placement marker. A fail-closed SQLite insert trigger
    # embedded into the exact old DB blocks all normal writes from those builds.
    # Check both historical paths because the old root-layout migration can
    # otherwise relocate the database before this guard runs.
    from memory_anki.core.runtime_paths import REPO_ROOT

    app_home = Path(configured).parents[1]
    candidates = (
        configured,
        database_file_path(app_home),
        app_home / "data" / configured.name,
        REPO_ROOT / "data" / DATABASE_FILE_NAME,
    )
    for candidate in dict.fromkeys(path for path in candidates if path.exists()):
        try:
            with closing(sqlite_read_only(candidate)) as connection:
                has_guard = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='handoff_guard_state'"
                ).fetchone()
                if not has_guard:
                    continue
                row = connection.execute(
                    "SELECT frozen FROM handoff_guard_state WHERE key='singleton'"
                ).fetchone()
        except sqlite3.Error as exc:
            if "handoff_guard_state" in str(exc):
                raise DatabaseHandoffError("共享旧数据库的冻结标记无法校验；拒绝启动。") from exc
            continue
        if row != (1,):
            raise DatabaseHandoffError("共享旧数据库的冻结标记无效；拒绝启动。")
        raise DatabaseHandoffError(
            "共享旧数据库已冻结写入。请通过 database_handoff.py import 接收本机快照，不能直接启动旧数据库。"
        )
