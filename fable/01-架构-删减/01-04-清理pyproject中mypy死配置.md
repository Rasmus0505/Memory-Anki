---
编号: 01-04
标题: 清理 apps/api/pyproject.toml 中指向不存在模块的 mypy override 死配置
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 1
完成时间: 2026-07-09
---

# 01-04 清理 pyproject 中 mypy 死配置

## 1. 原始需求

`apps/api/pyproject.toml` 的 `[[tool.mypy.overrides]]` 段（第 33-61 行）对 24 个模块设置了
`ignore_errors = true`。其中两个模块在源码中已不存在：

- 第 42 行 `"memory_anki.modules.knowledge.application.bilink_service"` —— 已核实
  `apps/api/src/memory_anki/modules/knowledge/` 下**只有 `presentation/router.py`，根本没有 `application/` 目录**；
  全仓 glob `**/bilink_service*` 零匹配。
- 第 59 行 `"memory_anki.modules.time_records.application.time_records_service"` —— 已核实
  `apps/api/src/memory_anki/modules/` 下没有 `time_records` 模块目录；glob `**/time_records*` 在源码中零匹配
  （只有 alembic `0008_prune_deleted_features.py` 里删除旧 `time_records` 表的历史记录）。

死 override 的危害：误导后续代理以为这些模块存在，且给"哪些模块还欠类型修复"的清单掺入噪音。
目标：删除这两行，其余 override 一律不动。

## 2. 详细执行清单

### 步骤 1：执行前再次核实两个模块确实不存在

```powershell
cd D:\322321\Memory-Anki
rg --files apps/api/src | rg -i "bilink|time_records"
rg -n "bilink_service|time_records_service" apps/api/src apps/api/tests
```

两条命令都应无输出。若有输出（说明后来有人新建了模块），**终止本文档执行**并在进度表记录。

- **自查点**：确认两条命令输出为空。

### 步骤 2：删除 pyproject.toml 中的两行

打开 `apps/api/pyproject.toml`，定位 `[[tool.mypy.overrides]]` 的 `module = [` 列表（第 34-60 行）。

修改前（节选，省略无关行）：

```toml
module = [
    ...
    "memory_anki.modules.english_reading.application.version_service",
    "memory_anki.modules.knowledge.application.bilink_service",
    "memory_anki.modules.palace_quiz.application.quiz_generation_service",
    ...
    "memory_anki.modules.settings.application.ai_model_registry",
    "memory_anki.modules.time_records.application.time_records_service",
]
```

修改后（只删两行，其余 22 个条目原样保留、顺序不变）：

```toml
module = [
    ...
    "memory_anki.modules.english_reading.application.version_service",
    "memory_anki.modules.palace_quiz.application.quiz_generation_service",
    ...
    "memory_anki.modules.settings.application.ai_model_registry",
]
```

- 不要删除或改动列表里的其他任何条目（例如 `memory_anki.modules.backups.application.backup_lifecycle`
  等模块都真实存在，仍需要 override）。
- 不要动 `[tool.mypy]` 主段（第 25-31 行）里的 `warn_unused_configs`、`packages`、`plugins` 等键。
- 不要动 `[tool.ruff]`、`[tool.importlinter]`、`[tool.pytest.ini_options]` 段。
- **自查点**：`rg -n "bilink|time_records" apps/api/pyproject.toml` 无匹配；toml 语法有效
  （`cd apps/api && python -c "import tomllib; tomllib.load(open('pyproject.toml','rb')); print('ok')"` 输出 `ok`）。

### 步骤 3：运行 mypy 验证

```powershell
cd D:\322321\Memory-Anki\apps\api
python -m mypy
```

期望：结果与改动前一致（改动前先跑一遍记录基线）。特别注意：`[tool.mypy]` 设了
`warn_unused_configs = true`，删除死 override 后这两条本会触发的
`Warning: unused section` 类提示应消失，不应新增任何错误。

- **自查点**：mypy 退出码与基线相同（正常应为 0），且输出中不再出现关于这两个模块的任何字样。

### 明确不要做的事

1. 不要趁机"修复"其余 22 个 override 模块的类型错误——那是完全独立的工作。
2. 不要调整 mypy 的全局严格度（`check_untyped_defs` 等）。
3. 不要改任何 `.py` 源文件——本文档只动 `pyproject.toml` 两行。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m mypy` | 通过（与改动前基线一致，无新增错误） |
| `cd apps/api && python -m pytest` | 全部通过（本改动不影响运行时，属回归兜底） |
| `cd apps/api && python -m ruff check src tests` | 无报错 |
| `rg -n "bilink_service|time_records_service" apps/api` | 无匹配 |

### 行为验收（人工）

1. 打开 `apps/api/pyproject.toml` → override 列表剩 22 个条目，均能在 `apps/api/src/` 下找到对应 `.py` 文件（抽查 3 个即可）。

### 回归检查

- CI 的 `Run mypy` 步骤（`.github/workflows/ci.yml` 第 39-41 行，命令为 `mypy`）必须保持绿色。
- 其余 override 模块（如 `backup_lifecycle`、`review_execution_service`）仍被 ignore，不因本次改动突然暴露大量类型错误。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 knowledge 模块无 application 目录、time_records 模块整体不存在，两条 override 确为死配置（位于 pyproject 第 42、59 行） | - |
| 2026-07-09 | fable Worker 1 | 删除 pyproject.toml 中 `bilink_service` 与 `time_records_service` 两条 mypy override 死配置 | 已完成；执行前复核源码/测试无对应模块；`python -c "import tomllib; tomllib.load(open('apps/api/pyproject.toml','rb')); print('ok')"` 通过；`rg -n "bilink_service|time_records_service" pyproject.toml src tests` 无匹配。`python -m mypy` 仍有既有类型错误（54 errors/26 files，如 `question_generation_source_meta.py` 缺 `Any`、若干 palace_quiz/settings 类型问题），非本任务引入 |
