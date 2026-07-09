---
编号: 02-03
标题: backups 模块补建 presentation 层，把寄生在 palaces 路由里的 6 条 /backups/* 路由迁回
类型: 优化
范围: 架构
优先级: P0
预估工作量: M
依赖文档: [02-01]
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-03 backups 模块补建 presentation 层并迁移路由

## 1. 原始需求

`modules/backups/` 目前只有 `application/` 一层（8 个文件：backup_service.py、backup_lifecycle.py、storage_backup.py 等），没有 presentation 层。6 条备份路由寄生在 `apps/api/src/memory_anki/modules/palaces/presentation/router.py`（628 行）的第 **528–589 行**：

| 行号 | 路由 |
|---|---|
| 528 | `GET /backups`（api_list_backups） |
| 533 | `POST /backups/create`（api_create_backup） |
| 540 | `POST /backups/restore-database`（api_restore_backup） |
| 552 | `POST /backups/recover-palaces`（api_recover_palaces） |
| 562 | `POST /backups/restore-palace-from-backup`（api_restore_palace_from_backup） |
| 572 | `POST /backups/compare-palace-snapshots`（api_compare_palace_snapshots） |

模块归属混乱：备份功能的路由挂在宫殿模块里，palaces router 因此额外背了 6 个 backup_service 函数的 import。目标：新建 `modules/backups/presentation/router.py`，6 条路由原样迁移，`app/main.py` 挂载新 router，**URL 路径一个字符都不变**（前端 `apps/web/src/features/profile/api/profileApi.ts` 第 58/62/74 行调用 `/backups`、`/backups/create`、`/backups/restore-database`）。

依赖 02-01 的原因：`tools/check_architecture.py` 的 `check_backend_presentation_orm_usage` 禁止基线之外的 presentation 文件出现 `get_session` 字样，新文件不在基线 `BASELINE_PRESENTATION_SESSION_FILES` 里，因此必须使用 02-01 提供的 `memory_anki.infrastructure.db.deps.session_dep`（该 import 不含 `get_session` 字样，也不含 `.query(`/`.commit(`）。

## 2. 详细执行清单

> 硬约束：只允许改动 3 个文件——新建 `modules/backups/presentation/router.py`（及其 `__init__.py`）、修改 `modules/palaces/presentation/router.py`、修改 `app/main.py`。不要改 backup_service 的任何函数；不要改前端；不要改 URL；不要把 palaces router 里其余引用 backup_service 的路由（如 511 行 restore-version、多处 `maybe_create_rolling_backup`）一起搬走。

### 步骤 1：新建 backups presentation 包

新建 `apps/api/src/memory_anki/modules/backups/presentation/__init__.py`（空文件），再新建 `apps/api/src/memory_anki/modules/backups/presentation/router.py`，完整内容如下（6 个函数体从 palaces router 528–589 行**原样复制**，不做任何行为修改）：

```python
"""备份与恢复路由（从 palaces/presentation/router.py 迁入，URL 不变）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.application.backup_service import (
    create_full_backup,
    export_palace_snapshot_comparison,
    list_backups,
    recover_palaces_from_git_snapshot,
    restore_database_backup,
    restore_palace_from_backup,
)

router = APIRouter(tags=["backups"])


@router.get("/backups")
def api_list_backups():
    return {"items": list_backups()}


@router.post("/backups/create")
def api_create_backup(data: dict | None = None):
    reason = (data or {}).get("reason") or "manual"
    folder = create_full_backup(str(reason))
    return {"ok": True, "path": str(folder)}


@router.post("/backups/restore-database")
def api_restore_backup(data: dict, s: Session = Depends(session_dep)):
    backup_path = str(data.get("path") or "")
    if not backup_path:
        return {"error": "missing backup path"}
    try:
        rescue = restore_database_backup(backup_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "rescue_path": str(rescue)}
```

后 3 个路由（recover-palaces / restore-palace-from-backup / compare-palace-snapshots）同样从原文件 552–589 行原样复制追加到本文件（函数签名、返回值、异常转换保持逐字符一致）。

自查点：`cd apps/api && python -c "from memory_anki.modules.backups.presentation import router; print([r.path for r in router.router.routes])"` 输出 6 条 `/backups*` 路径。

### 步骤 2：从 palaces router 删除这 6 条路由

打开 `apps/api/src/memory_anki/modules/palaces/presentation/router.py`：

1. 删除第 528–589 行的 6 个路由函数（以 `@router.get("/backups")` 开始，到 `api_compare_palace_snapshots` 的 `return {"ok": True, **result}` 结束）。
2. 修剪第 14–26 行的 backup_service import：删除 `create_full_backup`、`export_palace_snapshot_comparison`、`list_backups`、`recover_palaces_from_git_snapshot`、`restore_database_backup`、`restore_palace_from_backup` 六项；**保留** `cleanup_duplicate_palace_versions`、`get_palace_version_detail`、`list_palace_versions`、`maybe_create_rolling_backup`、`restore_palace_version`（版本类路由仍在使用）。

不要做：不要删除 511 行 `POST /palaces/{palace_id}/restore-version` 等宫殿版本路由——它们属于宫殿资源，不在本次迁移范围。

自查点：`python -m ruff check src` 无 F401/F821；`rg "\"/backups" apps/api/src/memory_anki/modules/palaces` 无结果。

### 步骤 3：在 main.py 挂载新 router

打开 `apps/api/src/memory_anki/app/main.py`，在第 34 行附近 import 区加入：

```python
from memory_anki.modules.backups.presentation import router as backups_router
```

在第 155–165 行 include_router 区（`app.include_router(palace_router.router, prefix="/api/v1")` 之后）加入：

```python
app.include_router(backups_router.router, prefix="/api/v1")
```

自查点：`python -c "from memory_anki.app.main import app; print(sorted(r.path for r in app.routes if '/backups' in getattr(r, 'path', '')))"` 输出 6 条 `/api/v1/backups*` 路径，且总数与迁移前一致（迁移前先跑一遍记录）。

### 步骤 4：回归验证

依次执行第 3 节命令。特别注意 `tools/check_architecture.py`：新文件不得包含 `get_session`、`.query(`、`.commit(`、`memory_anki.infrastructure.db.models` 四种字样（步骤 1 的写法已满足；如自行调整过务必复查）。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：全部通过（现状无 backups 路由专属测试，靠全量回归兜底）
cd apps/api && python -m ruff check src tests    # 期望：0 错误
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：Architecture check passed.
```

行为验收（启动后端后逐条执行）：

- `GET http://127.0.0.1:8012/api/v1/backups` → 200，返回 `{"items": [...]}`。
- `POST /api/v1/backups/create`（body `{"reason":"doc-0203-check"}`）→ 200 且 `{"ok": true, "path": ...}`，`APP_HOME/data/backups/full/` 下出现新目录。
- 前端"备份与恢复"页（/profile/backups）：列表加载、手动创建备份两个操作正常。
- `POST /api/v1/backups/restore-database` 传不存在路径 → 与迁移前一致的错误响应（不要在本文档里"顺手"改错误风格，那是 02-04 的事）。

回归检查：

- `GET /api/v1/palaces`、`POST /api/v1/palaces/{id}/restore-version`、`GET /api/v1/palaces/{id}/versions` 等 palaces 路由全部不受影响。
- OpenAPI 路由总数不变：迁移前后各跑一次 `python -c "from memory_anki.app.main import app; print(len(app.routes))"` 数值一致。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：6 条路由实际位于 528–589 行（描述的 528–590 基本吻合）；除 list/create/restore-database/recover-palaces 外另两条为 restore-palace-from-backup 与 compare-palace-snapshots；前端只调用其中 3 条 |
| 2026-07-09 | Codex | 迁移 `/backups*` 路由 | 新建 `modules/backups/presentation/__init__.py` 与 `router.py`；6 条路由从 palaces router 迁入 backups router；`app/main.py` 挂载 `backups_router`；palaces router 删除旧 `/backups*` handler 并清理失效 import；未迁移 palace versions 路由，未修改 backup application 逻辑、前端或 URL |
| 2026-07-09 | Codex | 验证 | `PYTHONPATH=src python -c "from memory_anki.app.main import app; print(sorted(r.path for r in app.routes if '/backups' in getattr(r, 'path', '')))"` 输出 6 条 `/api/v1/backups*`；`rg --fixed-strings '\"/backups' -- apps/api/src/memory_anki/modules/palaces` 无匹配；`python -m ruff check src/memory_anki/modules/backups/presentation src/memory_anki/modules/palaces/presentation/router.py src/memory_anki/app/main.py` 通过；`PYTHONPATH=src python -m pytest tests/test_palace_routes.py tests/test_backup_lifecycle.py tests/test_verify_backup_tool.py -q` 通过（55 passed） |
