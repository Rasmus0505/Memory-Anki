---
编号: 08-08
标题: 类型化事件中心替代散落 CustomEvent
类型: 优化
范围: 前端
优先级: P1
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-08 类型化事件中心替代散落 CustomEvent

## 1. 原始需求

前端模块之间通过散落的 `CustomEvent` 通信，事件名和 payload 缺少类型约束。目标是建立 `shared/events` 事件中心，并迁移偏好、catalog invalidation、计时器相关事件。

## 2. 详细执行清单

1. 新增 `apps/web/src/shared/events/appEvents.ts`。
2. 新增 `apps/web/src/shared/events/appEvents.test.ts`。
3. 迁移 `clientPreferences`、`persistentPreferenceStore`、`localStorage` helper、palace catalog invalidation、timer automation/listeners。

## 3. 测试验收标准

- `cd apps/web && npm run test -- src/shared/events/appEvents.test.ts src/shared/preferences src/shared/lib/localStorage.test.tsx` 通过。
- `cd apps/web && npm run typecheck` 通过。
- 仍允许少量非目标 CustomEvent 后续渐进迁移。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 建立类型化事件中心并迁移核心事件 | 已完成 |
