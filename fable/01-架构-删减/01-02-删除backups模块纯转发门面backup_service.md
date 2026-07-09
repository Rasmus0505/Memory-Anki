---
编号: 01-02
标题: 删除 backups 模块转发门面 backup_service.py，调用方改为直接 import 真实来源
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-02 删除 backups 模块转发门面 backup_service.py

## 1. 原始需求

`apps/api/src/memory_anki/modules/backups/application/backup_service.py` 共 117 行，主体是
`import X as X` 式 re-export（来源为同模块的 `backup_lifecycle.py`、`editor_safety.py`、
`backup_palace_restore.py`、`backup_palace_snapshots.py`、`backup_palace_versions.py`，共约 33 个符号）。

**核实发现它并非 100% 纯转发**，第 75-81 行有一小段真实逻辑：

```75:81:apps/api/src/memory_anki/modules/backups/application/backup_service.py
def _sync_facade_dependencies() -> None:
    _backup_lifecycle.FULL_BACKUPS_DIR = FULL_BACKUPS_DIR


def maybe_create_interval_backup(*args, **kwargs):
    _sync_facade_dependencies()
    return _backup_lifecycle.maybe_create_interval_backup(*args, **kwargs)
```

这段包装的唯一用途是支持测试猴补丁：`apps/api/tests/test_review_routes.py` 第 3613-3630 行把
`backup_service.FULL_BACKUPS_DIR` 替换为临时目录后调用 `maybe_create_interval_backup`。删除门面时必须把
该测试改为直接补丁 `backup_lifecycle` 模块，否则测试会失败。

经全仓 grep，共 7 个调用方文件（6 个 src + 1 个测试）。目标：全部改为直接 import 真实来源，删除门面。

## 2. 详细执行清单

### 步骤 0：符号 → 真实来源对照表（后续步骤照抄）

| 符号 | 真实来源模块 |
|---|---|
| `create_full_backup` / `create_shutdown_backup` / `ensure_daily_backup` / `list_backups` / `maybe_create_periodic_backup` / `maybe_create_rolling_backup` / `maybe_create_interval_backup` / `restore_database_backup` / `start_periodic_backup_loop` / `stop_periodic_backup_loop` / `ROLLING_EDIT_BACKUP_INTERVAL` / `create_rescue_snapshot` | `memory_anki.modules.backups.application.backup_lifecycle` |
| `MIN_DANGEROUS_NODE_COUNT` / `MAX_SAFE_REMAINING_NODES` / `count_editor_doc_nodes` / `is_dangerous_structure_change` | `memory_anki.modules.backups.application.editor_safety` |
| `recover_palaces_from_git_snapshot` / `restore_palace_from_backup` / `restore_palace_version` | `memory_anki.modules.backups.application.backup_palace_restore` |
| `export_palace_snapshot_comparison` 等快照函数 | `memory_anki.modules.backups.application.backup_palace_snapshots` |
| `create_palace_version` / `create_effective_palace_version` / `get_palace_version_detail` / `list_palace_versions` / `cleanup_duplicate_palace_versions` / `should_create_editor_snapshot` | `memory_anki.modules.backups.application.backup_palace_versions` |

`FULL_BACKUPS_DIR` 的真实来源是 `memory_anki.core.config`，但调用方没有人从门面 import 它（只有测试通过模块属性改写），无需迁移。

### 步骤 1：改 `apps/api/src/memory_anki/app/main.py`（第 29-33 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    create_shutdown_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_shutdown_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
```

- **自查点**：`cd apps/api && python -c "import memory_anki.app.main"`（需要能建 DB 目录的环境；若嫌重，仅跑步骤 8 的 ruff/pytest 也可）。

### 步骤 2：改 `apps/api/src/memory_anki/app/startup_runtime.py`（第 18-21 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
```

### 步骤 3：改 `apps/api/src/memory_anki/modules/palaces/presentation/router.py`（第 14-26 行）

该处 import 了 10 个符号，来自 4 个真实模块，需拆成 4 条 import。修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    cleanup_duplicate_palace_versions,
    create_full_backup,
    export_palace_snapshot_comparison,
    get_palace_version_detail,
    list_backups,
    list_palace_versions,
    maybe_create_rolling_backup,
    recover_palaces_from_git_snapshot,
    restore_database_backup,
    restore_palace_from_backup,
    restore_palace_version,
)
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_full_backup,
    list_backups,
    maybe_create_rolling_backup,
    restore_database_backup,
)
from memory_anki.modules.backups.application.backup_palace_restore import (
    recover_palaces_from_git_snapshot,
    restore_palace_from_backup,
    restore_palace_version,
)
from memory_anki.modules.backups.application.backup_palace_snapshots import (
    export_palace_snapshot_comparison,
)
from memory_anki.modules.backups.application.backup_palace_versions import (
    cleanup_duplicate_palace_versions,
    get_palace_version_detail,
    list_palace_versions,
)
```

- **自查点**：`python -m ruff check src/memory_anki/modules/palaces/presentation/router.py` 通过（isort 顺序按字母序，如报 I001 用 `--fix`）。

### 步骤 4：改 `apps/api/src/memory_anki/modules/palace_quiz/presentation/router.py`（第 9 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import maybe_create_rolling_backup
```

### 步骤 5：改 `apps/api/src/memory_anki/modules/knowledge/presentation/router.py`（第 15 行）

与步骤 4 完全相同的一行替换（`backup_service` → `backup_lifecycle`）。

### 步骤 6：改 `apps/api/src/memory_anki/modules/mindmap/application/editor_state_service.py`（第 8-13 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    create_effective_palace_version,
    is_dangerous_structure_change,
)
```

修改后（拆成 2 条）：

```python
from memory_anki.modules.backups.application.backup_palace_versions import (
    create_effective_palace_version,
)
from memory_anki.modules.backups.application.editor_safety import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    is_dangerous_structure_change,
)
```

### 步骤 7：改 `apps/api/tests/test_review_routes.py`（两处）

7a. 第 31-37 行 import，修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    create_palace_version,
    export_palace_snapshot_comparison,
    maybe_create_interval_backup,
    restore_palace_from_backup,
)
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    ROLLING_EDIT_BACKUP_INTERVAL,
    maybe_create_interval_backup,
)
from memory_anki.modules.backups.application.backup_palace_restore import (
    restore_palace_from_backup,
)
from memory_anki.modules.backups.application.backup_palace_snapshots import (
    export_palace_snapshot_comparison,
)
from memory_anki.modules.backups.application.backup_palace_versions import (
    create_palace_version,
)
```

7b. 第 3613-3630 行的 `test_interval_backup_skips_when_recent_backup_exists`，把猴补丁目标从门面改为真实模块。修改前（节选）：

```python
from memory_anki.modules.backups.application import backup_service

original_full_dir = backup_service.FULL_BACKUPS_DIR
backup_root = Path(temp_dir)
backup_service.FULL_BACKUPS_DIR = backup_root
...
finally:
    backup_service.FULL_BACKUPS_DIR = original_full_dir
```

修改后（把 `backup_service` 全部换为 `backup_lifecycle`，逻辑不变）：

```python
from memory_anki.modules.backups.application import backup_lifecycle

original_full_dir = backup_lifecycle.FULL_BACKUPS_DIR
backup_root = Path(temp_dir)
backup_lifecycle.FULL_BACKUPS_DIR = backup_root
...
finally:
    backup_lifecycle.FULL_BACKUPS_DIR = original_full_dir
```

说明：`backup_lifecycle.py` 第 9 行 `from memory_anki.core.config import ... FULL_BACKUPS_DIR ...` 使其成为模块级属性，
`_latest_full_backup()`（第 218-224 行）与 `_daily_backup_exists()`（第 208-215 行）读取的正是这个模块属性，直接补丁即可生效，
原门面里 `_sync_facade_dependencies` 的"回写"机制随之失去存在意义。

- **自查点**：单跑该测试：`cd apps/api && python -m pytest tests/test_review_routes.py -k interval_backup -x`，通过。

### 步骤 8：删除门面文件并全量验证

1. 确认再无引用：`rg -n "backups.application.backup_service|application import backup_service" apps` 应无匹配。
2. 删除 `apps/api/src/memory_anki/modules/backups/application/backup_service.py`。
3. 运行：

```powershell
cd D:\322321\Memory-Anki\apps\api
python -m pytest
python -m ruff check src tests
lint-imports
```

- **自查点**：三条命令全部通过。

### 明确不要做的事

1. 不要把 `_sync_facade_dependencies` / `maybe_create_interval_backup` 包装逻辑搬进 `backup_lifecycle.py`——直接补丁模块属性即可，不需要包装。
2. 不要改 `backup_lifecycle.py` 等 5 个真实实现文件的任何函数体。
3. 不要动 `pyproject.toml` 中 `memory_anki.modules.backups.application.backup_lifecycle` 的 mypy override（它对应的模块仍存在）。
4. 不要动 `FULL_BACKUPS_DIR` 在 `core/config.py` 的定义（跨设备路径均由 `memory_anki.core.config` 派生，这是硬约束）。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest` | 全部通过 |
| `cd apps/api && python -m pytest tests/test_review_routes.py -k interval_backup` | 通过（猴补丁改造成功） |
| `cd apps/api && python -m ruff check src tests` | 无报错 |
| `cd apps/api && lint-imports` | 契约通过 |
| `rg -n "backup_service" apps/api/src apps/api/tests` | 无任何匹配 |

### 行为验收（人工）

1. 启动后端 → 启动日志无 ImportError；启动时每日备份（`ensure_daily_backup`）照常在 `APP_HOME/data/backups/full/` 生成当日目录（若当日已有则跳过）。
2. 前端编辑一个宫殿导图并保存 → 距上次备份超过 30 分钟时生成 `rolling-*` 轻量备份目录。
3. 设置页/宫殿页触发"从备份恢复"入口 → 备份列表能正常加载（`list_backups` 链路）。
4. 正常关闭服务（`stop.bat`）→ 生成 `shutdown` 备份。

### 回归检查

- 定时备份循环（每 300 秒检查一次，`start_periodic_backup_loop`）不受影响。
- 宫殿版本快照/对比/恢复（palaces router 的 versions 相关端点）不受影响。
- 导图编辑危险结构保护（`is_dangerous_structure_change`，editor_state_service 使用）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实门面 117 行且含 `maybe_create_interval_backup` 包装（非纯转发），测试猴补丁依赖已写入步骤 7b | - |
