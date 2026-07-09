---
编号: 02-03
标题: 为 backups 模块补建 presentation 层，把寄生在 palaces router 里的 6 条 /backups/* 路由迁回家
类型: 优化
范围: 架构
优先级: P0（必须）
预估工作量: S（<2h）
依赖文档: 无（若 02-01 已完成，session_dep 直接从共享模块 import，见步骤 1 说明）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-03 backups 补建 presentation 层

## 1. 原始需求

`modules/backups/` 目前只有 application 层（`backup_service.py` 等 8 个文件），没有 presentation 层。备份相关的 6 条 HTTP 路由寄生在 `apps/api/src/memory_anki/modules/palaces/presentation/router.py` 的 **528-590 行**：

| 行号 | 方法与路径 | handler |
|---|---|---|
| 528 | GET `/backups` | `api_list_backups` |
| 533 | POST `/backups/create` | `api_create_backup` |
| 540 | POST `/backups/restore-database` | `api_restore_backup` |
| 552 | POST `/backups/recover-palaces` | `api_recover_palaces` |
| 562 | POST `/backups/restore-palace-from-backup` | `api_restore_palace_from_backup` |
| 572 | POST `/backups/compare-palace-snapshots` | `api_compare_palace_snapshots` |

这既让 628 行的 palaces router 更臃肿（见 02-13），也破坏了"模块自持 presentation 层"的目录约定（其余 12 个模块都有自己的 presentation）。期望效果：新建 `modules/backups/presentation/router.py`，6 条路由原样迁入并挂载到 `main.py`，URL 前缀仍是 `/api/v1/backups/*`，前端调用路径零变化。

## 2. 详细执行清单

> 禁止事项：不要修改 6 个 handler 的任何逻辑（连返回 200+`{"error": ...}` 的旧风格也原样保留，统一错误响应由 02-04 负责）；不要动 palaces router 中其余的 palace-versions 路由（484-525 行的 versions/restore-version 属于宫殿维度，不迁移）；不要改前端任何文件。

### 步骤 1：新建 backups presentation 包

新建 `apps/api/src/memory_anki/modules/backups/presentation/__init__.py`（空文件）。

新建 `apps/api/src/memory_anki/modules/backups/presentation/router.py`，内容为：

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.backups.application.backup_service import (
    create_full_backup,
    export_palace_snapshot_comparison,
    list_backups,
    recover_palaces_from_git_snapshot,
    restore_database_backup,
    restore_palace_from_backup,
)

router = APIRouter(tags=["backups"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()
```

然后把 palaces router 528-590 行的 6 个 handler **原样剪切**到该文件末尾（函数体一字不改）。

**与 02-01 的衔接**：若 02-01 已完成（存在 `infrastructure/db/deps.py`），上面的本地 `session_dep` 与 `get_session` import 改为一行 `from memory_anki.infrastructure.db.deps import session_dep`。

自查点：`cd apps/api && python -c "from memory_anki.modules.backups.presentation.router import router; print([r.path for r in router.routes])"` 输出包含 6 条 `/backups*` 路径。

### 步骤 2：在 main.py 挂载

打开 `apps/api/src/memory_anki/app/main.py`：

1. 在 import 区（29 行 `from memory_anki.modules.backups.application.backup_service import ...` 之后）新增：

```python
from memory_anki.modules.backups.presentation import router as backups_router
```

2. 在 165 行 `app.include_router(dashboard_router.router, prefix="/api/v1")` 之后新增：

```python
app.include_router(backups_router.router, prefix="/api/v1")
```

自查点：启动应用后 `curl http://127.0.0.1:8012/api/v1/backups` 返回 200 与 `{"items": [...]}`。

### 步骤 3：从 palaces router 删除旧路由与失效 import

打开 `apps/api/src/memory_anki/modules/palaces/presentation/router.py`：

1. 删除 528-590 行的 6 个 handler（即上表全部）。
2. 修剪 14-26 行的 `from memory_anki.modules.backups.application.backup_service import (...)`：删除只被这 6 个 handler 使用的 6 个名字——`create_full_backup`、`export_palace_snapshot_comparison`、`list_backups`、`recover_palaces_from_git_snapshot`、`restore_database_backup`、`restore_palace_from_backup`。**必须保留**仍被其余路由使用的：`cleanup_duplicate_palace_versions`、`get_palace_version_detail`、`list_palace_versions`、`maybe_create_rolling_backup`、`restore_palace_version`。
3. 若删除后 `HTTPException` 仍被其他 handler 使用（是的，350 行附近等处在用），不要动第 7 行的 fastapi import。

自查点：`python -m ruff check src/memory_anki/modules/palaces` 无 F401/F821；`rg -n "backups" src/memory_anki/modules/palaces/presentation/router.py` 只剩 `maybe_create_rolling_backup` 等 application 引用，无 `@router.*/backups` 路由定义。

### 步骤 4：确认前端路径不变

前端通过相对路径调用（如 `apps/web/src` 内 `request('/backups...')` 经 `/api/v1` 基址）。执行 `rg -n "backups" D:\322321\Memory-Anki\apps\web\src --glob "*.ts" --glob "*.tsx"` 确认调用的路径全部是 `/backups`、`/backups/create` 等——与迁移后的挂载点一致，无需改动前端。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`）：

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src` | 0 错误 |
| `lint-imports` | 契约 KEPT |
| `rg -n "@router\.(get\|post)\(\"/backups" src/memory_anki/modules/palaces` | 零匹配 |
| `rg -c "@router\." src/memory_anki/modules/backups/presentation/router.py` | 6 |

行为验收（后端运行于 8012）：
- `curl http://127.0.0.1:8012/api/v1/backups` → 200，`{"items":[...]}`。
- `curl -X POST http://127.0.0.1:8012/api/v1/backups/create -H "Content-Type: application/json" -d "{\"reason\":\"manual-test\"}"` → 200，`{"ok":true,"path":"..."}`，且备份目录出现新文件夹。
- 前端"设置 → 备份管理"页面列表、手动备份按钮工作正常。

回归检查：palaces 相关全部路由（`/palaces*`、`/palace-segments*`、`/attachments*`）不受影响；`main.py` 生命周期内的备份定时任务（`start_periodic_backup_loop` 等）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 | Codex | 迁移 `/backups*` 路由 | 新建 `modules/backups/presentation/__init__.py` 与 `router.py`；6 条路由从 palaces router 迁入 backups router；`app/main.py` 挂载 `backups_router`；palaces router 删除旧 `/backups*` handler 并清理失效 import；未迁移 palace versions 路由，未修改 backup application 逻辑、前端或 URL |
| 2026-07-09 | Codex | 验证 | `PYTHONPATH=src python -c "from memory_anki.app.main import app; print(sorted(r.path for r in app.routes if '/backups' in getattr(r, 'path', '')))"` 输出 6 条 `/api/v1/backups*`；`rg --fixed-strings '\"/backups' -- apps/api/src/memory_anki/modules/palaces` 无匹配；`python -m ruff check src/memory_anki/modules/backups/presentation src/memory_anki/modules/palaces/presentation/router.py src/memory_anki/app/main.py` 通过；`PYTHONPATH=src python -m pytest tests/test_palace_routes.py tests/test_backup_lifecycle.py tests/test_verify_backup_tool.py -q` 通过（55 passed） |
