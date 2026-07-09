---
编号: 05-11
标题: dashboard 聚合查询性能与信息密度
类型: 优化
范围: 功能
优先级: P2
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 05-11 dashboard 聚合查询性能与信息密度

## 1. 原始需求

`/dashboard` 的今日复习组和周报聚合容易引入 N+1 与 Python 侧计数。目标是把 due palace 查询批量化，并让 ReviewLog 计数/均分交给 SQL 聚合。

## 2. 详细执行清单

1. 修改 `apps/api/src/memory_anki/modules/dashboard/application/service.py`。
2. 今日复习组批量查询并 eager load `palace.pegs`。
3. `build_weekly_report_payload` 的 ReviewLog 计数/均分改为 SQL 聚合。
4. 在 `apps/api/tests/test_database_performance_optimizations.py` 增加查询预算测试。

## 3. 测试验收标准

- `cd apps/api && python -m pytest tests/test_study_session_routes.py tests/test_dashboard_routes.py tests/test_database_performance_optimizations.py` 通过。
- `cd apps/api && python -m ruff check src/memory_anki/modules/dashboard/application tests/test_database_performance_optimizations.py` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 批量化 dashboard 查询并补查询预算测试 | 已完成 |
