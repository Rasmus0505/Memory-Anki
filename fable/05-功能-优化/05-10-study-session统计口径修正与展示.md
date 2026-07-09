---
编号: 05-10
标题: study session 统计口径修正与展示
类型: 优化
范围: 功能
优先级: P2
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 05-10 study session 统计口径修正与展示

## 1. 原始需求

学习会话统计需要排除软删、未完成、非正时长记录，并保持 scene 范围口径稳定。目标是用直接测试锁定 `/study-sessions/stats` 的统计语义。

## 2. 详细执行清单

1. 审计 `apps/api/src/memory_anki/modules/sessions/application/study_session_stats.py` 的统计口径。
2. 在 `apps/api/tests/test_study_session_routes.py` 增加 completed、软删、时长、scene 过滤测试。
3. 不改变无关 session 写入接口。

## 3. 测试验收标准

- `cd apps/api && python -m pytest tests/test_study_session_routes.py tests/test_dashboard_routes.py tests/test_database_performance_optimizations.py` 通过。
- `cd apps/api && python -m ruff check src/memory_anki/modules/sessions/application tests/test_study_session_routes.py` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 补直接统计口径测试 | 已完成 |
