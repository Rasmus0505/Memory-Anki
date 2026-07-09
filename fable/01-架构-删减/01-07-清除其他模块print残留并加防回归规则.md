---
编号: 01-07
标题: 全量审计后端 print 调试残留（mindmap/backups/mindmap_import 等模块），并启用 ruff T20 规则防止回归
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: [01-06]
状态: 已完成
负责代理: fable Worker / Codex同步
完成时间: 2026-07-09
---

# 01-07 清除其他模块 print 调试残留（审计结论 + 防回归）

## 1. 原始需求

改进线索原本怀疑以下文件存在 print 调试残留：`modules/mindmap/application/editor_state_service.py`、`modules/mindmap/application/editor_state_documents.py`、`modules/backups/application/backup_palace_snapshots.py`、`modules/palaces/application/mindmap_import/job_creation.py` 及 `job_creation_support.py`。

经 `rg "\bprint\(" apps/api/src` 全量核实（2026-07-08，注意必须带 `\b` 词边界——不带边界会把 `build_fingerprint(`、`_assert_expected_fingerprint(` 等函数名里的 "print(" 子串误报为 print 调用，上述怀疑正是这样产生的误判）：

- **全部后端 src 目录中，真实的 `print(` 调用只存在于 `modules/knowledge/presentation/router.py`（8 处，由 01-06 负责清除）**；
- 上述被点名的 mindmap/backups/mindmap_import 文件中不存在任何 print 调用，也不存在 `[DEBUG]` 字样或 `flush=True` 残留（已用 `rg -i "\[DEBUG\]|flush=True|debug"` 复核，均无匹配）。

因此本文档的交付物调整为：（1）以可复现命令固化"零 print"审计；（2）在 ruff 中启用 `T20`（flake8-print）规则，把"src 目录禁止 print"变成 CI 强制约束，防止下次排障后再遗留。

## 2. 详细执行清单

> 只修改 `apps/api/pyproject.toml` 一个文件。执行前必须确认 01-06 已完成（否则 T20 会把 knowledge 路由的 8 处 print 报成 lint 错误，属于预期联动，先做 01-06 即可）。

### 步骤 1：复现全量审计

在仓库根目录运行：

```
rg -n "\bprint\(" apps/api/src
```

- 若 01-06 已完成：期望无任何输出（退出码 1）；
- 若 01-06 未完成：期望只输出 `modules/knowledge/presentation/router.py` 的 8 行。此时暂停本文档，先执行 01-06。

再运行第二条确认点名文件确实干净：

```
rg -n "\bprint\(" apps/api/src/memory_anki/modules/mindmap apps/api/src/memory_anki/modules/backups apps/api/src/memory_anki/modules/palaces/application/mindmap_import
```

期望无输出。若出现新的 print（现状之后有人加的），按 01-06 的模式处理：能删则删，需要保留的排障信息改为 `logging.getLogger(__name__)`。

自查点：两条 rg 命令的结果与期望一致，并把实际结果记入第 4 节进度表。

### 步骤 2：启用 ruff T20 规则

打开 `apps/api/pyproject.toml`，找到第 21-23 行：

修改前：

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
ignore = ["B008", "E501", "E712"]
```

修改后：

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "T20"]
ignore = ["B008", "E501", "E712"]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["T20"]
```

说明：`T20` 同时覆盖 `print`（T201）与 `pprint`（T203）。tests 目录允许 print（测试里临时输出是合理的），故加 per-file-ignores。若 `pyproject.toml` 中已存在 `[tool.ruff.lint.per-file-ignores]` 段（当前没有，已核实），则只在其中追加一行而不是新建段。

自查点：`cd apps/api && python -m ruff check src tests` 通过；故意在任一 src 文件临时加一行 `print("x")` 再跑 ruff，应报 `T201`，验证后撤销临时行。

### 步骤 3：确认无遗漏的其他调试残留形式

顺带用一条命令审计常见调试残留（只审计不扩权，发现问题记录到进度表、另开文档处理，**本文档不做额外修改**）：

```
rg -n "breakpoint\(\)|pdb\.set_trace|console\.log" apps/api/src
```

期望无输出。

不要做的事：

- 不要动 `apps/web`（前端 console.log 治理不在本文档范围）；
- 不要给任何现有代码行加 `# noqa: T201` 来"绕过"规则；
- 不要顺手调整 ruff 其他规则集（E/F/I/B/UP 与 ignore 列表保持原样）。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "\bprint\(" src` | 无匹配（退出码 1） |
| `python -m ruff check src tests` | `All checks passed!` |
| `python -m pytest` | 全部通过（确认规则变更没有伴随代码误改） |
| `python -m mypy` | 无新增错误 |

行为验收：本文档无运行时行为变化；CI 的 "Run ruff" 步骤（`.github/workflows/ci.yml` 第 35-37 行 `ruff check src tests`）在含 print 的提交上会失败，即防回归生效。

回归检查：现有全部 ruff 检查项不得从通过变为失败（除新增 T20 抓到的真实 print 外）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建；审计结论：除 knowledge 路由（01-06 范围）外后端 src 无任何 print 残留，原线索点名的 5 个文件均为 "fingerprint" 子串误报 | 待执行步骤 2 的防回归规则 |
| 2026-07-09 | Codex | 同步同编号主文档完成状态 | 对应主文档 `01-07-清除mindmap与backups与导入模块print残留.md` 已完成；后端 ruff 已启用 `T20` 防回归，本文档作为同编号副本标记完成，避免重复认领。 |
