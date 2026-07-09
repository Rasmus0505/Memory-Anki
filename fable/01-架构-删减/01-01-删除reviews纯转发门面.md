---
编号: 01-01
标题: 删除 reviews 模块的纯转发门面 review_service.py，引用方改为直接 import 真实来源
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker / Codex同步
完成时间: 2026-07-09
---

# 01-01 删除 reviews 模块纯转发门面 review_service.py

## 1. 原始需求

`apps/api/src/memory_anki/modules/reviews/application/review_service.py` 全文 47 行，没有任何业务逻辑，只是把三个真实实现模块的函数 re-export 出去（文件头注释自述为 "Compatibility facade for review application services."）：

- 第 5-9 行：转发 `review_execution_service` 的 `repair_review_stage_progress` / `submit_review` / `trigger_review_for_palace`；
- 第 10-17 行：转发 `review_metrics_service` 的 6 个统计函数；
- 第 18-27 行：转发 `review_queue_service` 的 8 个队列函数；
- 第 29-47 行：`__all__` 列表。

经 `rg "review_service"` 全量核实（2026-07-08），整个仓库只剩 **1 个引用方**：`apps/api/tests/test_review_routes.py` 第 41-43 行，且只 import 了 `submit_review` 一个名字。生产代码（如 `modules/reviews/presentation/router.py` 第 13-16 行、`app/main.py` 第 42-44 行、`app/startup_runtime.py` 第 28-30 行）早已直接 import `review_execution_service` 等真实来源。删除该门面可消除一层无意义的间接层，符合根目录 1.md 的最小架构原则。

## 2. 详细执行清单

> 只允许修改下面点名的 2 个文件（1 改 1 删）。不要顺手重构 `review_execution_service.py` 等真实实现文件，不要动 `modules/reviews/presentation/router.py`。

### 步骤 1：修改测试文件的 import

打开 `apps/api/tests/test_review_routes.py`，找到第 41-43 行：

修改前：

```python
from memory_anki.modules.reviews.application.review_service import (
    submit_review,
)
```

修改后：

```python
from memory_anki.modules.reviews.application.review_execution_service import (
    submit_review,
)
```

注意：`submit_review` 的真实定义就在 `apps/api/src/memory_anki/modules/reviews/application/review_execution_service.py` 第 59 行（`def submit_review(...)`），这不是猜测，是核实过的。不要改动该测试文件的其他任何行。

自查点：在 `apps/api` 目录运行 `rg -n "review_service" tests/`，输出中不应再出现 `reviews.application.review_service`（注意 `segment_review_service`、`review_execution_service` 属于其他模块名，包含 "review_service" 子串是正常的，不算残留）。

### 步骤 2：确认已无任何引用方

在仓库根目录运行：

```
rg -n "reviews\.application\.review_service" apps/
```

期望：无任何输出。若有输出，说明步骤 1 遗漏了引用方，先处理完再继续。

自查点：命令退出码为 1（rg 无匹配时退出码为 1）。

### 步骤 3：删除门面文件

删除文件 `apps/api/src/memory_anki/modules/reviews/application/review_service.py`（整个文件删除，共 47 行）。

不要做的事：

- 不要删除同目录下的 `review_execution_service.py`、`review_metrics_service.py`、`review_queue_service.py`、`schedule_service.py`、`schedule_policy.py`、`schedule_rebuild_service.py`；
- 不要在 `pyproject.toml` 里做任何"配套"修改（mypy overrides 里本来就没有 `review_service` 条目，核实过）。

自查点：`Test-Path apps/api/src/memory_anki/modules/reviews/application/review_service.py` 返回 False（或 `ls` 确认文件不存在）。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录下执行）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "reviews\.application\.review_service" ..` | 无匹配（退出码 1） |
| `python -m pytest` | 全部通过，0 failed |
| `python -m ruff check src tests` | `All checks passed!` |
| `python -m mypy` | 与改动前基线一致，无新增错误 |

行为验收（操作 → 期望现象）：

- 启动后端（`python -m uvicorn memory_anki.app.main:app --port 8012`）→ 启动无 ImportError；
- 前端复习页提交一次复习 → 复习记录正常写入（`submit_review` 链路未被破坏）。

回归检查：复习提交（`POST /api/v1/...` 复习相关路由）、复习队列查询、周统计接口不得被破坏——它们本来就直接 import 真实来源，理论上不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已核实 review_service.py 现状与唯一引用方 | 待执行 |
| 2026-07-09 | Codex | 同步同编号主文档完成状态 | 对应主文档 `01-01-删除reviews模块纯转发门面review_service.md` 已完成；`review_service.py` 已删除，引用已迁移，本文档作为同编号副本标记完成，避免重复认领。 |
