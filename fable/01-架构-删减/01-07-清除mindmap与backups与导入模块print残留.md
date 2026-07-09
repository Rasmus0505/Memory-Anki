---
编号: 01-07
标题: 核实 mindmap/backups/导入模块 print 残留（实测已不存在）并启用 ruff T20 规则防回归
类型: 删减
范围: 架构
优先级: P1
预估工作量: S（<2h）
依赖文档: [01-06]
状态: 已完成
负责代理: fable Worker 1
完成时间: 2026-07-09
---

# 01-07 清除 mindmap/backups/导入模块 print 残留

## 1. 原始需求

任务清单认为以下文件存在 print 调试语句：

- `apps/api/src/memory_anki/modules/mindmap/application/editor_state_service.py`
- `apps/api/src/memory_anki/modules/mindmap/application/editor_state_documents.py`
- `apps/api/src/memory_anki/modules/backups/application/backup_palace_snapshots.py`
- `apps/api/src/memory_anki/modules/palaces/application/mindmap_import/job_creation.py`（及 `job_creation_support.py`）

**逐文件核实结论：这些文件中已不存在任何 `print(` 调用**。用宽松模式
`rg -n "print\(" apps/api/src` 得到的匹配全部是函数名 `fingerprint(` 的子串误报
（`build_fingerprint(`、`_assert_expected_fingerprint(`、`build_editor_state_fingerprint(`、
`build_editor_snapshot_fingerprint(`——"finger**print(**"包含"print("）。用词边界模式
`rg -n "(^|[^a-zA-Z0-9_])print\(" apps/api/src` 复核，整个 `src/` 下真实 print 只剩
`modules/knowledge/presentation/router.py` 的 8 处——那是文档 01-06 的范围。

因此本文档的任务调整为两部分：
(1) 执行时按同样方法复核一遍上述 4 个文件（防止执行时点代码已变化），确认/清除任何真实 print；
(2) 在 ruff 配置中启用 `T20`（flake8-print）规则，把"src 下禁止 print/pprint"固化为 CI 强制项，防止再次回潮。
启用 T20 之前必须先完成 01-06（否则 knowledge 路由的 8 处 print 会让 lint 失败），故本文档依赖 01-06。

## 2. 详细执行清单

### 步骤 1：用词边界正则复核 4 个目标文件

```powershell
cd D:\322321\Memory-Anki
rg -n "(^|[^a-zA-Z0-9_])print\(" `
  apps/api/src/memory_anki/modules/mindmap/application/editor_state_service.py `
  apps/api/src/memory_anki/modules/mindmap/application/editor_state_documents.py `
  apps/api/src/memory_anki/modules/backups/application/backup_palace_snapshots.py `
  apps/api/src/memory_anki/modules/palaces/application/mindmap_import/job_creation.py `
  apps/api/src/memory_anki/modules/palaces/application/mindmap_import/job_creation_support.py
```

- 期望：无输出（2026-07-08 核实即为无）。
- 若有输出：逐条按下述规则处理后再继续——
  - 纯进度/状态类信息 → 改为 `logger.info(...)` 或直接删除；
  - 异常信息 → 改为 `logger.exception(...)`；
  - 文件尚无 logger 时，在文件头部加 `import logging` 与模块级 `logger = logging.getLogger(__name__)`
    （参考 `modules/backups/application/backup_lifecycle.py` 第 3、21 行的现成写法）。
- **自查点**：上述命令输出为空。

### 步骤 2：复核整个 src/ 的真实 print 分布

```powershell
rg -n "(^|[^a-zA-Z0-9_])print\(" apps/api/src
```

- 期望：若 01-06 已完成则无输出；若 01-06 尚未完成，仅剩 `modules/knowledge/presentation/router.py` 的 8 处。
- 出现其他文件的匹配时，按步骤 1 的规则逐个处理，并把文件名与行号追加到本文档第 4 节进度表。
- **自查点**：除 knowledge 路由（01-06 范围）外无匹配。

### 步骤 3：在 ruff 中启用 T20 规则（防回归护栏）

打开 `apps/api/pyproject.toml`，找到第 21-23 行：

修改前：

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
ignore = ["B008", "E501", "E712"]
```

修改后（只在 select 列表追加 `"T20"`，其余不动）：

```toml
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "T20"]
ignore = ["B008", "E501", "E712"]
```

说明：`T20` 包含 `T201`（禁 print）与 `T203`（禁 pprint）。`[tool.ruff] src = ["src", "tests"]`
意味着 tests 也会被检查——tests 目录当前没有 print（执行时用步骤 2 的正则加 `apps/api/tests` 复核一次；
如有测试里的合法调试 print，优先直接删除；确需保留输出的测试改用 `assert` 消息或 `-s` 时的日志）。

- **自查点**：`cd apps/api && python -m ruff check src tests` 通过。
  若报出 T201，报错位置就是漏网的 print，回到步骤 1 的规则处理它，禁止用 `# noqa: T201` 压制
  （唯一例外：`if __name__ == "__main__"` 的脚本入口块，本项目 src 下只有 `app/main.py` 第 171-174 行,
  该块没有 print，无需豁免）。

### 步骤 4：全量验证

```powershell
cd D:\322321\Memory-Anki\apps\api
python -m ruff check src tests
python -m pytest
```

### 明确不要做的事

1. 不要把 `fingerprint` 相关函数当成 print 改掉——`build_fingerprint`、`_assert_expected_fingerprint`、
   `build_editor_state_fingerprint`、`build_editor_snapshot_fingerprint` 是正常业务函数。
2. 不要在 `tools/` 目录启用 T20 或删除那里的 print——`tools/*.py` 是命令行脚本，print 是其正常输出方式，
   且 ruff 配置的作用域（`src`、`tests`）本来就不含 tools，保持现状。
3. 不要修改 `alembic/` 下的迁移脚本。
4. 不要顺手调整 ruff 的其他规则（line-length、ignore 列表等）。
5. 若 01-06 未完成，不要先启用 T20（会把 CI 打红）；可先只完成步骤 1、2 并在进度表标注"步骤 3 等待 01-06"。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `rg -n "(^|[^a-zA-Z0-9_])print\(" apps/api/src` | 无匹配 |
| `cd apps/api && python -m ruff check src tests` | 通过（T20 已生效且无违例） |
| `cd apps/api && python -m pytest` | 全部通过 |
| 在任意 src 文件临时加一行 `print("x")` 后再跑 `python -m ruff check src` | 报 `T201`（护栏生效），验证后撤销该临时行 |

### 行为验收（人工）

1. 前端保存宫殿导图（editor_state_service 链路）→ 功能正常，后端 stdout 无调试输出。
2. 执行一次导图导入任务（mindmap_import/job_creation 链路）→ 任务正常创建与执行，无 stdout 调试输出。
3. 触发一次宫殿版本快照对比（backup_palace_snapshots 链路）→ 对比结果正常。

### 回归检查

- 导图编辑指纹冲突检测（`_assert_expected_fingerprint`）行为不变。
- 导入任务指纹去重（`build_fingerprint`）行为不变。
- CI（`.github/workflows/ci.yml` 的 `Run ruff` 步骤，命令 `ruff check src tests`）保持绿色。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；**与任务描述不符**：4 个目标文件实测无任何 print，原判断系 `fingerprint(` 子串误报；任务改为复核 + 启用 ruff T20 防回归 | - |
| 2026-07-09 | fable Worker 1 | 复核目标文件和整个 `src/tests` 的真实 print；在 ruff select 追加 `T20` | 已完成；目标文件无真实 print，01-06 后 `python -m ruff check src tests --select T20` 通过，防回归护栏生效。`python -m ruff check src tests` 全量仍被既有/并行 lint 债阻塞（如 `tests/test_review_routes.py` 中旧符号 F821、其它文件 import 顺序与类型名问题），非 T20 违例 |
