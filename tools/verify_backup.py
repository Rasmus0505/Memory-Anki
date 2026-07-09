"""备份恢复演练工具。

用法：python tools/verify_backup.py [备份目录路径]
不传参数时自动选取 FULL_BACKUPS_DIR 下最近一份含数据库的备份。

流程：复制备份数据库到临时目录 -> PRAGMA integrity_check ->
alembic_version 与生产库核对 -> 关键表行数对比 -> 输出报告。
只读操作：绝不改写生产库与备份目录。
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_SRC = _REPO_ROOT / "apps" / "api" / "src"
if _API_SRC.is_dir():
    sys.path.insert(0, str(_API_SRC))

from memory_anki.modules.backups.application.backup_verification import (  # noqa: E402
    verify_backup,
)


def main() -> int:
    backup_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    report, report_path = verify_backup(backup_dir)

    status = "PASS" if report["ok"] else "FAIL"
    backup_name = Path(report["backup_dir"]).name if report.get("backup_dir") else "未选择"
    print(f"[{status}] 备份：{backup_name}")
    if "backup_database" in report:
        print(f"  database: {report['backup_database']}")
    if "integrity_check" in report:
        print(f"  integrity_check: {report['integrity_check']}")
    if "alembic_version" in report:
        print(f"  alembic_version: {report['alembic_version']}")
    for problem in report["problems"]:
        print(f"  - {problem}")
    if report_path is not None:
        print(f"  报告已写入: {report_path}")
    return 0 if report["ok"] else 2 if report_path is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
