"""一次性把 APP_HOME 数据迁移到标准位置 (LOCALAPPDATA/MemoryAnki)。

背景：旧版 supervisor 系统把 MEMORY_ANKI_HOME 重定向到仓库内的 runtime-data/，
导致用户真实数据（memory_palace.db、attachments、english 等）混在代码仓库里。
本脚本解除重定向，把数据迁回标准 APP_HOME，为删除 supervisor 做准备。

安全策略：
- 全程复制，不删除源，直到校验通过后才可选删除。
- 目标若已有 memory_palace.db 且非空，先备份为 .pre-migration-bak。
- 校验：目标 db 可被 SQLite 打开，且表数/关键表行数与源一致。

可重复运行：已迁移过会显示"无需迁移"。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

# 这些是 config.py 里 APP_HOME 下的数据目录/文件（剔除 supervisor 专用产物）。
# 参考 config.py 的 DATA_DIR / ATTACHMENTS_DIR / ENGLISH_DIR 等 + ensure_runtime_dirs()。
APP_HOME_DATA_ENTRIES = [
    "data",            # memory_palace.db + attachments + backups
    "english",         # 英语模块媒体/任务
    "english_reading", # 英语阅读模块
    "import_jobs",     # 导入任务
    "voice_coach",     # 语音教练缓存
    "ai_call_logs",    # AI 调用日志
    "migration-state.json",  # 迁移状态（config.py MIGRATION_STATE_PATH）
]

# runtime-data 下这些是 supervisor 专用，迁移时跳过：
#   runtime/, snapshot-inspect/, switcher-logs/, logs/,
#   supervisor-state.json, switcher-state.json, startup-state.json


def resolve_standard_app_home() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MemoryAnki"
    return Path.home() / "AppData" / "Local" / "MemoryAnki"


def resolve_legacy_shared_home_config_path() -> Path:
    return resolve_standard_app_home() / "shared-home.txt"


def count_db_tables(db_path: Path) -> tuple[int, dict[str, int]]:
    """返回 (表数, {关键表名: 行数})。关键表用于校验数据一致性。"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        ]
        key_tables = ("palace", "palace_segment", "review", "review_log", "time_record")
        counts: dict[str, int] = {}
        for table in key_tables:
            try:
                counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.OperationalError:
                # 该表可能不存在（版本差异），跳过
                continue
        return len(tables), counts
    finally:
        conn.close()


def safe_copy_tree(src: Path, dst: Path) -> None:
    """合并复制目录树，已存在的文件保留源（更新的优先）。"""
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            safe_copy_tree(item, target)
        else:
            # 目标已存在且非空 db 时由调用方先备份，这里直接覆盖
            shutil.copy2(item, target)


def backup_existing_db(dst_data: Path) -> Path | None:
    """如果目标已有非空 memory_palace.db，备份它。返回备份路径或 None。"""
    dst_db = dst_data / "memory_palace.db"
    if not dst_db.exists() or dst_db.stat().st_size == 0:
        return None
    backup = dst_data / "memory_palace.db.pre-migration-bak"
    counter = 0
    while backup.exists():
        counter += 1
        backup = dst_data / f"memory_palace.db.pre-migration-bak{counter}"
    shutil.copy2(dst_db, backup)
    return backup


def main() -> int:
    # 强制使用标准 APP_HOME，忽略环境变量重定向
    if os.environ.get("MEMORY_ANKI_HOME"):
        print("[i] 检测到 MEMORY_ANKI_HOME 环境变量重定向，本脚本将强制使用标准 APP_HOME。")

    standard_home = resolve_standard_app_home()
    legacy_shared_home_file = resolve_legacy_shared_home_config_path()
    repo_root = Path(__file__).resolve().parents[1]
    source_home = repo_root / "runtime-data"

    print(f"源 APP_HOME (仓库内)     : {source_home}")
    print(f"目标标准 APP_HOME         : {standard_home}")
    print()

    if not source_home.exists():
        print("[i] runtime-data 目录不存在，无需迁移。")
        return 0

    src_data = source_home / "data"
    src_db = src_data / "memory_palace.db"
    if not src_db.exists():
        print("[i] 源目录没有 memory_palace.db，无需迁移数据。")
        # 仍清除重定向配置
    else:
        print(f"源数据库大小: {src_db.stat().st_size:,} 字节")
        src_tables, src_counts = count_db_tables(src_db)
        print(f"源数据库: {src_tables} 张表，关键表行数 {src_counts}")
        print()

        # 目标备份
        standard_home.mkdir(parents=True, exist_ok=True)
        dst_data = standard_home / "data"
        backup = backup_existing_db(dst_data)
        if backup:
            print(f"[i] 目标已有数据库，已备份到: {backup.name}")

        # 复制所有数据目录/文件
        print("[i] 复制数据到标准 APP_HOME ...")
        for entry_name in APP_HOME_DATA_ENTRIES:
            src_entry = source_home / entry_name
            if not src_entry.exists():
                continue
            dst_entry = standard_home / entry_name
            print(f"    -> {entry_name} ...", end=" ", flush=True)
            if src_entry.is_dir():
                safe_copy_tree(src_entry, dst_entry)
            else:
                dst_entry.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_entry, dst_entry)
            print("done")

        # 校验目标
        dst_db = dst_data / "memory_palace.db"
        dst_tables, dst_counts = count_db_tables(dst_db)
        print()
        print(f"目标数据库大小: {dst_db.stat().st_size:,} 字节")
        print(f"目标数据库: {dst_tables} 张表，关键表行数 {dst_counts}")

        if dst_tables != src_tables or dst_counts != src_counts:
            print()
            print("[!] 警告：目标数据库与源不一致！源数据已保留，请检查后重试。")
            return 1
        print("[ok] 校验通过：目标数据库与源一致。")

    # 清除旧版 shared-home 重定向（若存在）。新版不再读取该文件。
    if legacy_shared_home_file.exists():
        legacy_shared_home_file.unlink()
        print(f"[i] 已删除旧版 shared-home 重定向文件: {legacy_shared_home_file}")

    # 清除 MEMORY_ANKI_HOME 环境变量的持久化设置（如果存在）
    # 注意：当前进程的环境变量无法持久化清除，只能提示用户。
    # 实际重定向如果是进程级（由旧 start.bat 注入），新 start.bat 不再设置即可。

    print()
    print("[ok] 迁移完成。源 runtime-data/ 已保留，待验证后可手动删除。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[!] 迁移失败: {exc}", file=sys.stderr)
        raise
