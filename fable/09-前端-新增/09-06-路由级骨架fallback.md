---
编号: 09-06
标题: 路由级骨架 fallback
类型: 新增
范围: 前端
优先级: P2
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 09-06 路由级骨架 fallback

## 1. 原始需求

lazy 路由加载时需要稳定 fallback，未知旧路径也需要回退到合理入口。目标是用 `RouteFallback` 和 `resolveRouteFallbackTarget` 提供路由级加载和回退能力。

## 2. 详细执行清单

1. `apps/web/src/app/router/appRoutes.tsx` 使用 `Suspense fallback={<RouteFallback />}`。
2. `RouteFallback` 复用 `LoadingState`。
3. `resolveRouteFallbackTarget` 处理精确路由、动态路由、section 前缀和旧移动端路径。
4. `apps/web/src/app/router/appRoutes.fallback.test.ts` 覆盖回退规则。

## 3. 测试验收标准

- `cd apps/web && npm run test -- src/app/router/appRoutes.fallback.test.ts` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 确认路由级 fallback 与测试 | 已完成 |
