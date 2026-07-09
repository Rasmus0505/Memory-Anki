---
编号: 05-09
标题: freestyle 信息流去重与权重策略
类型: 优化
范围: 功能
优先级: P1
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 05-09 freestyle 信息流去重与权重策略

## 1. 原始需求

`freestyle` 信息流可能从多个来源返回重复 action 或 quiz card，影响今日训练密度与用户判断。目标是在后端最终返回前完成稳定去重和排序，并让 `counts` 反映最终 feed。

## 2. 详细执行清单

1. 修改 `apps/api/src/memory_anki/modules/freestyle/application/feed_service.py`。
2. action card 按 `id` 去重，保留 priority 更高的版本。
3. quiz card 按 question identity 合并。
4. 排序优先级为高 priority、due/overdue、类型权重、原始顺序/id。
5. 在 `apps/api/tests/test_freestyle_routes.py` 增加重复 feed 的回归测试。

## 3. 测试验收标准

- `cd apps/api && python -m pytest tests/test_freestyle_routes.py -q` 通过。
- `cd apps/api && python -m ruff check src/memory_anki/modules/freestyle/application tests/test_freestyle_routes.py` 通过。
- 回归要求：响应字段结构不新增破坏性变更。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 添加 feed-level 去重、排序与 counts 重算 | 已完成 |
