---
编号: 01-02
标题: 删除 backups 模块的纯转发门面 backup_service.py，全部引用方改为直接 import 真实来源
类型: 删减
范围: 架构
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-02 删除 backups 模块纯转发门面 backup_service.py

## 1. 原始需求

`apps/api/src/memory_anki/modules/backups/application/backup_service.py` 全文 117 行，几乎全部是 `import X as X` 形式的 re-export（第 3-72 行）加一个 `__all__`（第 83-117 行）。真实实现分布在同目录 5 个模块里：

- `backup_lifecycle.py`：备份创建/恢复/周期循环（`create_full_backup`、`maybe_create_rolling_backup`、`start_periodic_backup_loop` 等 11 个名字 + 常量 `ROLLING_EDIT_BACKUP_INTERVAL`）；
- `editor_safety.py`：`MAX_SAFE_REMAINING_NODES`、`MIN_DANGEROUS_NODE_COUNT`、`count_editor_doc_nodes`、`is_dangerous_structure_change`；
- `backup_palace_restore.py`：`recover_palaces_from_git_snapshot`、`restore_palace_from_backup`、`restore_palace_version`；
- `backup_palace_snapshots.py`：快照对比 7 个名字；
- `backup_palace_versions.py`：宫殿版本 6 个名字。

文件里唯一"有逻辑"的部分是第 75-81 行：`maybe_create_interval_backup` 包装函数 + `_sync_facade_dependencies()`，其存在的唯一原因是测试通过 monkeypatch `backup_service.FULL_BACKUPS_DIR` 改备份目录，需要把该值同步回 `backup_lifecycle` 模块。删除门面后测试直接 patch `backup_lifecycle.FULL_BACKUPS_DIR` 即可，这个包装也随之消失。

经 `rg "backup_service"` 全量核实（2026-07-08），引用方共 7 处：6 个生产文件 + 1 个测试文件（详见清单）。

## 2. 详细执行清单

> 本清单共修改 7 个文件 + 删除 1 个文件。每一步只改 import 语句（及测试的 monkeypatch 目标），禁止改动任何函数体、禁止顺手重命名真实实现模块。

### 步骤 1：`apps/api/src/memory_anki/app/main.py`（第 29-33 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    create_shutdown_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
```

修改后（这 3 个名字全部定义在 `backup_lifecycle.py`）：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_shutdown_backup,
    start_periodic_backup_loop,
    stop_periodic_backup_loop,
)
```

自查点：`python -c "import memory_anki.app.main"`（在 `apps/api` 目录、装好依赖的环境中）不报 ImportError。

### 步骤 2：`apps/api/src/memory_anki/app/startup_runtime.py`（第 18-21 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
```

修改后（两个名字均在 `backup_lifecycle.py`）：

```python
from memory_anki.modules.backups.application.backup_lifecycle import (
    ensure_daily_backup,
    maybe_create_periodic_backup,
)
```

### 步骤 3：`apps/api/src/memory_anki/modules/knowledge/presentation/router.py`（第 15 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
```

修改后：

```python
from memory_anki.modules.backups.application.backup_lifecycle import maybe_create_rolling_backup
```

### 步骤 4：`apps/api/src/memory_anki/modules/palace_quiz/presentation/router.py`（第 9 行）

修改内容与步骤 3 完全相同（同一行 import，同样只把 `backup_service` 改成 `backup_lifecycle`）。

### 步骤 5：`apps/api/src/memory_anki/modules/mindmap/application/editor_state_service.py`（第 8-13 行）

修改前：

```python
from memory_anki.modules.backups.application.backup_service import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    create_effective_palace_version,
    is_dangerous_structure_change,
)
```

修改后（注意来源分两个模块）：

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

自查点：`python -m ruff check src`（在 `apps/api`）通过，尤其 I 类（isort）规则不报 import 排序错误。

### 步骤 6：`apps/api/src/memory_anki/modules/palaces/presentation/router.py`（第 14-26 行）

修改前（一条 import 引入 10 个名字）：

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

修改后（按真实来源拆成 3 条 import）：

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

来源对照（写文档时已按 `backup_service.py` 第 3-72 行逐一核实）：`create_full_backup`/`list_backups`/`maybe_create_rolling_backup`/`restore_database_backup` → `backup_lifecycle`；`recover_palaces_from_git_snapshot`/`restore_palace_from_backup`/`restore_palace_version` → `backup_palace_restore`；`export_palace_snapshot_comparison` → `backup_palace_snapshots`；`cleanup_duplicate_palace_versions`/`get_palace_version_detail`/`list_palace_versions` → `backup_palace_versions`。

### 步骤 7：`apps/api/tests/test_review_routes.py`（两处）

7a. 第 31-37 行，修改前：

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

7b. 第 3613-3630 行 `test_interval_backup_skips_when_recent_backup_exists`，把 monkeypatch 目标从门面改为真实模块。修改前（第 3615-3628 行）：

```python
            from memory_anki.modules.backups.application import backup_service

            original_full_dir = backup_service.FULL_BACKUPS_DIR
            backup_root = Path(temp_dir)
            backup_service.FULL_BACKUPS_DIR = backup_root
            ...
            try:
                created = maybe_create_interval_backup("rolling-edit", ROLLING_EDIT_BACKUP_INTERVAL)
            finally:
                backup_service.FULL_BACKUPS_DIR = original_full_dir
```

修改后（只改 module 名与变量前缀，其余行不动）：

```python
            from memory_anki.modules.backups.application import backup_lifecycle

            original_full_dir = backup_lifecycle.FULL_BACKUPS_DIR
            backup_root = Path(temp_dir)
            backup_lifecycle.FULL_BACKUPS_DIR = backup_root
            ...
            try:
                created = maybe_create_interval_backup("rolling-edit", ROLLING_EDIT_BACKUP_INTERVAL)
            finally:
                backup_lifecycle.FULL_BACKUPS_DIR = original_full_dir
```

原理说明：`backup_lifecycle.py` 第 9 行 `from memory_anki.core.config import ... FULL_BACKUPS_DIR ...` 将其变成本模块全局变量，模块内函数（如第 56 行 `create_full_backup`）引用的是这个全局，直接 patch `backup_lifecycle.FULL_BACKUPS_DIR` 即可生效，不再需要门面里的 `_sync_facade_dependencies()`。

自查点：单跑该测试 `python -m pytest tests/test_review_routes.py -k interval_backup` 通过。

### 步骤 8：确认无残留引用，删除门面

在仓库根目录运行：

```
rg -n "backups\.application\.backup_service|backups\.application import backup_service" apps/
```

期望无输出。然后删除文件 `apps/api/src/memory_anki/modules/backups/application/backup_service.py`（整个文件，117 行，包括 `maybe_create_interval_backup` 包装与 `_sync_facade_dependencies`）。

不要做的事：

- 不要动 `backup_lifecycle.py` / `editor_safety.py` / `backup_palace_*.py` 的任何函数体；
- 不要动 `pyproject.toml` 的 mypy overrides（其中 `memory_anki.modules.backups.application.backup_lifecycle` 条目指向真实模块，仍然有效，保留）。

自查点：文件已不存在，且 `rg` 复查无匹配。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "backup_service" .. --glob "!fable/**"` | 无匹配（退出码 1） |
| `python -m pytest` | 全部通过 |
| `python -m ruff check src tests` | `All checks passed!` |
| `python -m mypy` | 无新增错误 |
| `lint-imports` | 契约全部通过（application 不 import presentation 等） |

行为验收：

- 启动后端 → lifespan 中 `start_periodic_backup_loop()` 正常启动，无 ImportError；
- 在前端保存一次学科编辑器 → 触发 `maybe_create_rolling_backup("rolling-subject-editor-save")` 正常（数据目录 `backups/full/` 下按间隔生成 `*-rolling-*` 目录）；
- 关闭后端 → `create_shutdown_backup()` 正常产生关机备份。

回归检查：全量备份创建/恢复、宫殿版本列表与恢复、编辑器危险结构保护（`is_dangerous_structure_change`）均不得被破坏。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已逐一核实 7 处引用方与各名字的真实来源模块 | 待执行 |
