"""启动时备份入口脚本，供 start-production.ps1 调用。

用法：python tools/create_startup_backup.py <reason>
委派给 memory_anki.modules.backups.application.backup_lifecycle.create_full_backup，
从而复用统一的差异化备份逻辑与保留策略（MAX_FULL_BACKUPS 自动清理旧备份），
避免 PowerShell 与 Python 两套复制逻辑漂移。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# 把仓库 apps/api/src 加入 sys.path，使其可在 runtime snapshot 启动前
# 直接引用仓库源码（启动时刻 runtime/current 尚未生成）。
_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "apps" / "api" / "src"
if _API_SRC.is_dir():
    sys.path.insert(0, str(_API_SRC))

from memory_anki.modules.backups.application.backup_lifecycle import (  # noqa: E402
    create_full_backup,
)


def main() -> int:
    reason = sys.argv[1] if len(sys.argv) > 1 else "startup"
    # MEMORY_ANKI_HOME 由 start-production.ps1 通过环境变量注入。
    path = create_full_backup(reason)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
