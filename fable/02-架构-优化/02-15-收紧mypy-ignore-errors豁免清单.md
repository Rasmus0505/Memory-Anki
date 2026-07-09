---
编号: 02-15
标题: 收紧 mypy ignore_errors 豁免清单
类型: 优化
范围: 架构
优先级: P2
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-15 收紧 mypy ignore_errors 豁免清单

## 1. 原始需求

`apps/api/pyproject.toml` 中残留了已经不存在的 mindmap import 模块级 mypy 豁免，导致类型检查配置与真实代码结构脱节。目标是在不扩大 mypy 整改范围的前提下，先删除死配置，降低后续类型债务排查噪音。

## 2. 详细执行清单

1. 打开 `apps/api/pyproject.toml`，移除不存在模块 `mindmap_import.pdf_model_workflows` 与 `mindmap_import.preview_workflows` 的 mypy override。
2. 不修改仍然对应真实模块的豁免项。
3. 运行目标后端测试，确认删除配置不影响业务行为。

## 3. 测试验收标准

- `cd apps/api && python -m pytest tests/test_settings_routes.py tests/test_settings_ai_routes.py -q` 通过。
- `cd apps/api && python -m pytest tests/test_settings_ai_routes.py tests/test_review_routes.py -q` 通过。
- 已知 `mypy` 仍被既有无关类型错误阻塞，本任务只收紧死配置。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 删除不存在模块的 mypy override | 已完成，目标测试通过 |
