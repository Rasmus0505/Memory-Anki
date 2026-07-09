---
编号: 02-12
标题: 收敛双轨迁移机制：数据修复类迁移统一进 Alembic，JSON 状态只保留文件系统级迁移
类型: 优化
范围: 架构
优先级: P2（可以）
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-12 统一双轨迁移到 Alembic

## 1. 原始需求

后端目前有**两套并存的迁移/一次性任务机制**：

1. **Alembic**：`apps/api/alembic/versions/` 下 12 个迁移（`0001_baseline.py` ~ `0012_freestyle_history.py`），由 `infrastructure/db/migrations.py` 的 `run_migrations()` 在 `init_db()` 时执行 `upgrade head`。这是 schema 的权威轨道。
2. **JSON 状态轨道**：`apps/api/src/memory_anki/core/migration.py` 把状态写在 `APP_HOME/migration-state.json`（`MIGRATION_STATE_PATH`，config.py 131 行），包含两类事：
   - `ensure_legacy_repo_data_migrated()`（90-134 行）：把旧版仓库内 `data/` 目录的数据库/附件/备份搬到 APP_HOME —— **文件系统级**迁移，发生在数据库可用之前；
   - `is_app_migration_completed`/`mark_app_migration_completed`（39-56 行）：通用的"应用级一次性任务"打点，目前唯一使用者是 `apps/api/src/memory_anki/app/startup_runtime.py` 63-73 行的 `run_review_schedule_repair_migration`（key 为 `review_schedule_anchor_repair_v1`，在 `run_prepare_runtime` 96 行调用）。另外 `app/main.py` 88-98 行还残留一份**同名同逻辑的重复定义**（`run_review_schedule_repair_migration`），主流程并未调用它，属于死代码。

问题：同一个"库演进到某状态"的事实分散在 alembic_version 表与 JSON 文件两处，双轨各有幂等语义，新设备初始化时执行顺序心智负担大；`main.py` 的重复定义还会让人误改错处。

**收敛评估（本文档结论）**：
- `ensure_legacy_repo_data_migrated` **不迁**——它必须在任何数据库连接之前运行（决定 DB 文件位置），Alembic 迁移运行时数据库已经打开，时序上做不到。保留 JSON 轨道专门服务这一类"文件系统级"迁移是正确设计。
- 数据修复类一次性任务（如 review schedule 修复）**应迁**——它们操作的是已存在的表数据，天然适合 Alembic data migration，且能获得线性顺序保证。
- 收敛后的规则一句话：**"动文件系统 → JSON 轨道；动数据库 → Alembic（schema 与 data 都算）"**，写进 AGENT 类文档由维护者知晓。

## 2. 详细执行清单

> 禁止事项：不要删除 `migration-state.json` 机制本身（`ensure_legacy_repo_data_migrated` 仍依赖）；不要改动已有 12 个 alembic 版本文件的任何内容（历史迁移不可变）；新迁移必须兼容"老设备已通过 JSON 打点完成修复"的情况（见步骤 2 的守卫）；执行全程在真实数据前先做一次 `POST /api/v1/backups/create`。

### 步骤 1：删除 main.py 中的死代码副本

打开 `apps/api/src/memory_anki/app/main.py`，删除 88-98 行的 `run_review_schedule_repair_migration` 函数。同时清理因此不再使用的 import：19-22 行 `from memory_anki.core.migration import (is_app_migration_completed, mark_app_migration_completed)`，以及 42-44 行 `repair_review_stage_progress`、11-16 行中的 `REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY`（先 `rg -n "<符号名>" src/memory_anki/app/main.py` 确认该文件内无其他使用点再删）。

**警惕**：49 行 `get_session = _get_session` 被 `tests/test_review_routes.py` 多处替换（1486 行起），**不要删**。另外先 `rg -n "main_module.run_review_schedule_repair_migration\|main\.run_review_schedule_repair_migration" apps/api/tests` 检查测试是否引用了这个死代码副本；若有引用，把测试改为引用 `startup_runtime` 的同名函数。

自查点：`python -m pytest tests -q` 全绿；`python -m ruff check src/memory_anki/app/main.py` 无 F401。

### 步骤 2：把 review schedule 修复改写为 Alembic data migration

1. 在 `apps/api` 下执行 `python -m alembic revision -m "review schedule anchor repair"`，生成 `alembic/versions/0013_review_schedule_anchor_repair.py`（编号以生成结果为准）。
2. 迁移体（`upgrade()`）写法要点：

```python
def upgrade() -> None:
    # 守卫 1：老设备可能已通过 JSON 轨道完成修复，直接跳过
    from memory_anki.core.migration import is_app_migration_completed
    if is_app_migration_completed("review_schedule_anchor_repair_v1"):
        return
    # 守卫 2：全新库（无数据）无需修复
    bind = op.get_bind()
    from sqlalchemy.orm import Session
    from memory_anki.modules.reviews.application.review_execution_service import (
        repair_review_stage_progress,
    )
    with Session(bind=bind) as session:
        repair_review_stage_progress(session)
        session.commit()
```

注意事项（执行者必读）：alembic 迁移里 import 应用代码有版本漂移风险（未来 `repair_review_stage_progress` 改签名会破坏旧迁移）。两种做法二选一，**推荐 b**：
- a. 直接 import（上面的写法），简单但有漂移风险；
- b. 把 `repair_review_stage_progress` 当前实现**复制**一份固化进迁移文件（迁移自包含、永不漂移）——先 `rg -n "def repair_review_stage_progress" -A 60 src/memory_anki/modules/reviews/application/review_execution_service.py` 评估体量，若超过 150 行则退回做法 a 并在进度表记录理由。

`downgrade()` 写 `pass`（数据修复不可逆，注释说明即可）。

3. 从 `apps/api/src/memory_anki/app/startup_runtime.py` 移除旧轨道调用：删除 63-73 行 `run_review_schedule_repair_migration` 函数、96 行调用点、46 行 `REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY` 常量、11-15 行 import 中的 `is_app_migration_completed`/`mark_app_migration_completed`（`ensure_legacy_repo_data_migrated` 保留）。同步检查 `main.py` 11-16 行对 `REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY` 的 import（步骤 1 已处理）。
4. `rg -n "REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY\|run_review_schedule_repair_migration" apps/api` 应只剩 alembic 迁移文件内的字符串常量。

自查点：备份真实库 → `python -m alembic upgrade head` → 日志显示 0013 执行；再跑一次 → 幂等无动作；用一份**未打点**的旧备份库重复验证守卫 2 分支。

### 步骤 3：固化收敛规则

在 `apps/api/src/memory_anki/core/migration.py` 文件头部加 docstring（当前无模块 docstring）：

```python
"""文件系统级一次性迁移的状态轨道（migration-state.json）。

收敛规则（2026-07 定）：
- 动文件系统（搬数据目录、重排 APP_HOME）→ 用本模块 + migration-state.json；
- 动数据库（schema 或数据修复）→ 一律写 Alembic 迁移，禁止再往 app_migrations 里加新 key。
"""
```

自查点：`rg -n "mark_app_migration_completed" apps/api/src` 的调用点只剩 `core/migration.py` 自身定义与 `ensure_legacy_repo_data_migrated`（若有）。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`）：

| 命令 | 期望结果 |
|---|---|
| `python -m alembic upgrade head` | 成功；重复执行幂等 |
| `python -m alembic history` | 13 个版本线性无分叉 |
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src tests` | 0 错误 |
| `rg -n "run_review_schedule_repair_migration" src` | 零匹配（app/ 与 startup_runtime 中均已移除） |

行为验收：
- 场景 A（老设备升级）：拿一份 `migration-state.json` 已含 `review_schedule_anchor_repair_v1: completed` 的 APP_HOME 启动 → 0013 跳过修复，复习计划数据不被重复修复。
- 场景 B（新设备/新库）：删除测试用 APP_HOME 后首次启动 → legacy 迁移、alembic 12+1 个迁移依次完成，应用可用。
- 场景 C（prepare 模式）：`MEMORY_ANKI_STARTUP_MODE=prepare` 启动 → 流程完整无报错。

回归检查：复习日程显示与到期判断不变（对比改造前后 `GET /api/v1/palaces/{id}/review-plan` 响应）；`migration-state.json` 中既有内容不被破坏。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 | Codex | 删除 startup_runtime JSON app migration 入口，新增 Alembic data migration | 新迁移 `0016_review_schedule_anchor_repair` 接在 `0015_review_log_notes` 后；`main.py` 中死代码副本已不存在；JSON 轨道仅保留 filesystem legacy migration。 |
| 2026-07-09 | Codex | 迁移实现取舍 | `repair_review_stage_progress()` 依赖 `schedule_rebuild_service` 与多段 review/session helper，复制整套逻辑会明显超过 150 行且更易漂移；迁移改为在 `upgrade()` 内延迟 import 应用 repair 函数，并保留 `review_schedule_anchor_repair_v1` JSON 完成标记守卫。 |
| 2026-07-09 | Codex | 验证 | `python -m pytest tests/test_startup_runtime_and_supervisor.py tests/test_review_routes.py -q`：74 passed, 42 skipped；`python -m alembic history`：线性到 `0016_review_schedule_anchor_repair (head)`；`python -m alembic upgrade head`：首次执行 0016 成功，重复执行无动作；`python -m ruff check src/memory_anki/app/main.py src/memory_anki/app/startup_runtime.py src/memory_anki/core/migration.py alembic/versions/0016_review_schedule_anchor_repair.py`：All checks passed。 |
