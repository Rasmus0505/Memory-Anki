---
编号: 01-04
标题: 清理 apps/api/pyproject.toml 中 mypy overrides 引用的两个不存在模块
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: 无
状态: 已完成
负责代理: fable Worker 1 / Codex复核
完成时间: 2026-07-09
---

# 01-04 清理 pyproject.toml mypy 死配置

## 1. 原始需求

`apps/api/pyproject.toml` 第 33-61 行的 `[[tool.mypy.overrides]]` 段（`ignore_errors = true` 的模块豁免清单）中有两个条目指向已不存在的模块，经核实（2026-07-08）：

- 第 42 行 `"memory_anki.modules.knowledge.application.bilink_service"` —— `apps/api/src/memory_anki/modules/knowledge/` 下只有 `presentation/`，**根本没有 `application/` 目录**（`ls` 确认路径不存在）；
- 第 59 行 `"memory_anki.modules.time_records.application.time_records_service"` —— `apps/api/src/memory_anki/modules/` 下 13 个子模块中**没有 `time_records`**（该功能已被删除，alembic 迁移 `0008_prune_deleted_features.py` 第 76 行还 drop 过 `time_records` 表）。

死条目的危害：豁免清单本应随豁免模块的修复而收缩，死条目让人误以为这些模块还存在、还欠类型债。同时 `pyproject.toml` 第 27 行开着 `warn_unused_configs = true`，保留匹配不到任何模块的 override 与该配置意图相悖。

## 2. 详细执行清单

> 只修改 `apps/api/pyproject.toml` 一个文件，且只删 2 行。不要"顺手"清理 overrides 里的其他条目（其余条目均指向真实存在的模块，是有意的类型债豁免）。

### 步骤 1：执行前复核两个模块确实不存在

在仓库根目录运行：

```
rg --files apps/api/src/memory_anki/modules/knowledge
rg --files apps/api/src/memory_anki/modules | rg "time_records"
```

期望：第一条命令的输出里没有任何 `application/bilink_service.py`；第二条命令无输出。若有输出说明现状已变化，停止执行并在进度记录中说明。

自查点：两条命令的结果与上述期望一致。

### 步骤 2：删除两行死配置

打开 `apps/api/pyproject.toml`，在 `[[tool.mypy.overrides]]` 的 `module = [...]` 列表中删除以下两行（当前为第 42 行与第 59 行）：

修改前（节选）：

```toml
    "memory_anki.modules.english_reading.application.version_service",
    "memory_anki.modules.knowledge.application.bilink_service",
    "memory_anki.modules.palace_quiz.application.quiz_generation_service",
    ...
    "memory_anki.modules.settings.application.ai_model_registry",
    "memory_anki.modules.time_records.application.time_records_service",
]
```

修改后（节选）：

```toml
    "memory_anki.modules.english_reading.application.version_service",
    "memory_anki.modules.palace_quiz.application.quiz_generation_service",
    ...
    "memory_anki.modules.settings.application.ai_model_registry",
]
```

不要做的事：不要调整列表其他行的顺序；不要动 `[tool.ruff]`、`[tool.importlinter]`、`[tool.pytest.ini_options]` 等其他段落；不要改 `ignore_errors = true`。

自查点：`git diff apps/api/pyproject.toml` 只显示 2 行删除、0 行新增。

### 步骤 3：运行 mypy 确认无回归

```
cd apps/api && python -m mypy
```

期望：结果与删除前完全一致（这两个条目本来就匹配不到任何文件，删除不可能引入新错误）。

自查点：mypy 输出的错误计数与执行前基线相同。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "bilink_service|time_records" pyproject.toml` | 无匹配（退出码 1） |
| `python -m mypy` | 与基线一致，且不出现 "unused section" 类警告 |
| `python -m pytest` | 全部通过（配置改动不影响运行时，作为回归兜底） |

行为验收：无运行时行为变化（本改动只影响静态检查配置）。

回归检查：mypy 对其余 overrides 条目的豁免行为不变（例如 `memory_anki.modules.palaces.presentation.router` 依旧被豁免、不报类型错误）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已用目录列举确认两个模块不存在（knowledge 无 application 目录、modules 下无 time_records） | 待执行 |
| 2026-07-09 | fable Worker 1 | 删除 `pyproject.toml` 中 `bilink_service` 与 `time_records_service` 两条 mypy override 死配置 | 已完成；`rg -n "bilink_service|time_records_service" apps/api/pyproject.toml apps/api/src apps/api/tests` 无匹配；`python -c "import tomllib; tomllib.load(open('apps/api/pyproject.toml','rb')); print('ok')"` 通过 |
| 2026-07-09 | Codex | 复核重复文档状态 | `rg -n "bilink_service|time_records" apps/api/pyproject.toml apps/api/requirements.txt apps/api/requirements-dev.txt` 未命中死配置；本文档同步标记已完成 |
