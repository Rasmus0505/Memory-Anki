---
编号: 08-10
标题: keep-alive 页面 inert 化与后台订阅暂停
类型: 优化
范围: 前端
优先级: P1
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-10 keep-alive 页面 inert 化与后台订阅暂停

## 1. 原始需求

resident route 保留 DOM 时，非活跃页面不应被读屏器/键盘访问，也不应继续执行活跃订阅。目标是在 `RouteResidency` 容器增加 `inert`，并用 `isActive` 测试订阅 start/cleanup。

## 2. 详细执行清单

1. 修改 `apps/web/src/app/router/AppRouter.tsx`，非活跃 resident route 增加 `inert`。
2. 保留既有 `aria-hidden`。
3. 补 `apps/web/src/app/router/AppRouter.test.tsx` 的 inert 与订阅断言。

## 3. 测试验收标准

- `cd apps/web && npm run test -- AppShell.test.tsx AppRouter.test.tsx AppShell.residency.test.tsx` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 增加 inert 与后台订阅测试 | 已完成 |
