---
编号: 08-09
标题: 修复 AppShell 侧栏时钟整体重渲染
类型: 优化
范围: 前端
优先级: P1
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-09 修复 AppShell 侧栏时钟整体重渲染

## 1. 原始需求

`AppShell` 侧栏时钟每秒 tick 不应导致整个 `SidebarContent` 和导航订阅重跑。目标是把时钟拆成 memo 化子组件，并用测试证明 tick 不触发订阅 hook 重跑。

## 2. 详细执行清单

1. 修改 `apps/web/src/app/shell/AppShell.tsx`，新增 memo 化 `SidebarClock`。
2. 将日期/时间 formatter 提升到模块级。
3. 补 `apps/web/src/app/shell/AppShell.test.tsx`。

## 3. 测试验收标准

- `cd apps/web && npm run test -- AppShell.test.tsx AppRouter.test.tsx AppShell.residency.test.tsx` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 拆出 SidebarClock 并补回归测试 | 已完成 |
