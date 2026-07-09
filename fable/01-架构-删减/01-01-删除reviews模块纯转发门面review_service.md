---
编号: 01-01
标题: 删除 reviews 模块纯转发门面 review_service.py，调用方改为直接 import 真实来源
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-01 删除 reviews 模块纯转发门面 review_service.py

## 1. 原始需求

`apps/api/src/memory_anki/modules/reviews/application/review_service.py` 共 47 行，全部内容是从
`review_execution_service.py`、`review_metrics_service.py`、`review_queue_service.py` 三个真实实现模块
re-export 共 17 个函数（文件头注释自称 "Compatibility facade"），本身不含任何业务逻辑。

经全仓 grep 核实（`rg "review_service" --glob "!node_modules"`），**当前仅剩 1 个调用方**仍从该门面 import：

```41:43:apps/api/tests/test_review_routes.py
from memory_anki.modules.reviews.application.review_service import (
    submit_review,
)
```

生产代码（`src/` 下）已经全部直接 import 真实来源（例如 `apps/api/src/memory_anki/app/main.py` 第 42-44 行
直接 `from memory_anki.modules.reviews.application.review_execution_service import repair_review_stage_progress`）。
门面已无存在价值，保留只会误导后续代理"还有两条 import 路径"。目标：改掉唯一调用方，删除门面文件。

> 注意：`segment_review_service`（palaces 模块）是另一个不同的文件，与本文档无关，绝对不要动它。

## 2. 详细执行清单

### 步骤 1：再次确认调用方清单（防止执行时代码已变化）

在仓库根目录执行：

```powershell
cd D:\322321\Memory-Anki
rg -n "reviews.application.review_service" apps
```

期望输出**只有** `apps/api/tests/test_review_routes.py` 一处（约第 41 行）。
如果出现了其他文件，先把它们逐一加入步骤 2 同样处理，再继续。

- 不要用 `review_service` 裸词搜索后把 `segment_review_service` 的匹配误当成调用方。
- **自查点**：确认输出行数为 1 行（或你已把新增调用方全部记录下来）。

### 步骤 2：修改 tests/test_review_routes.py 的 import

打开 `apps/api/tests/test_review_routes.py`，找到第 41-43 行：

修改前：

```python
from memory_anki.modules.reviews.application.review_service import (
    submit_review,
)
```

修改后（`submit_review` 的真实来源是 `review_execution_service.py`，见该文件第 59 行 `def submit_review(`）：

```python
from memory_anki.modules.reviews.application.review_execution_service import (
    submit_review,
)
```

- 只改这一个 import 语句，不要改动测试文件的任何其他行。
- 不要把 import 挪动位置——ruff 的 isort 规则（`I`）会检查顺序，`review_execution_service` 与原
  `review_service` 首字母顺序相同（`review_e...` < `review_s...`），保持在原位置即可通过；若 ruff 报
  `I001`，运行 `python -m ruff check --fix tests/test_review_routes.py` 让它自动排序。
- **自查点**：`cd apps/api && python -m ruff check tests/test_review_routes.py` 无报错。

### 步骤 3：删除门面文件

删除 `apps/api/src/memory_anki/modules/reviews/application/review_service.py` 整个文件。

- 不要删除同目录下的其他文件（`review_execution_service.py`、`review_metrics_service.py`、
  `review_queue_service.py`、`schedule_service.py`、`schedule_policy.py`、`schedule_rebuild_service.py` 都是真实实现，必须保留）。
- 不要动 `apps/api/src/memory_anki/modules/reviews/application/__init__.py`（如存在，先打开确认它没有
  re-export `review_service`；核实时该包的 `__init__.py` 不含相关引用）。
- **自查点**：执行 `rg -n "review_service" apps/api/src apps/api/tests`，除 `segment_review_service`
  的匹配外应无任何结果。

### 步骤 4：全量验证

```powershell
cd D:\322321\Memory-Anki\apps\api
python -m pytest
python -m ruff check src tests
```

- 若 pytest 报 `ModuleNotFoundError: ... review_service`，说明步骤 1 漏掉了调用方，回到步骤 1 重新 grep。
- **自查点**：两条命令都以 0 退出码结束。

### 明确不要做的事

1. 不要"顺手"合并或重命名 `review_execution_service.py` 等真实实现文件。
2. 不要修改 `review_queue_service.py`、`review_metrics_service.py` 中任何函数签名。
3. 不要动前端（`apps/web`）任何文件——前端不感知后端模块路径。
4. 不要修改 `pyproject.toml`（mypy overrides 里没有 `review_service` 条目，无需清理）。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest` | 全部通过，无 import 错误 |
| `cd apps/api && python -m ruff check src tests` | 无报错 |
| `rg -n "reviews.application.review_service" apps` | 无任何匹配 |
| `cd apps/api && python -c "from memory_anki.modules.reviews.application.review_execution_service import submit_review; print('ok')"` | 输出 `ok` |

### 行为验收（人工）

1. 启动后端（`start-desktop.bat` 或 `cd apps/api && python -m uvicorn memory_anki.app.main:app --port 8012`）→ 服务正常启动，无 ImportError。
2. 打开前端复习队列页，完成一次到期复习提交 → 复习成功记录、进度推进（`submit_review` 链路正常）。

### 回归检查

- 复习提交（`POST /api/v1/...` 由 `reviews/presentation/router.py` 承载）不受影响——该 router 本来就直接 import 真实来源。
- 启动时的复习计划修复迁移（`repair_review_stage_progress`，被 `startup_runtime.py` 与 `main.py` 引用）不受影响。
- 今日复习/周统计接口（`review_metrics_service`、`review_queue_service`）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建，核实门面 47 行、唯一调用方为测试文件第 41 行 | - |
