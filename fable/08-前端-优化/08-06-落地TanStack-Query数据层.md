---
编号: 08-06
标题: 落地 TanStack Query 数据层
类型: 优化
范围: 前端
优先级: P1
预估工作量: M
依赖文档: 07-01
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-06 落地 TanStack Query 数据层

## 1. 原始需求

项目已引入 TanStack Query，但缺少真实页面消费链路。目标选择低风险的宫殿列表 catalog 读取作为试点，把手写 loading/error 初次拉取迁移到 `useQuery`。

## 2. 详细执行清单

1. 修改 `apps/web/src/features/palace-catalog/PalaceListPage.tsx`，使用 `useQuery` 和 `useQueryClient`。
2. 在 `apps/web/src/features/palace-catalog/model/palaceCatalog.ts` 增加 query key/builder。
3. catalog invalidation 事件改为 `queryClient.invalidateQueries`。
4. 补 `apps/web/src/features/palace-catalog/PalaceListPage.test.tsx` 的 QueryClientProvider 与缓存断言。

## 3. 测试验收标准

- `cd apps/web && npm run test -- --run src/features/palace-catalog/PalaceListPage.test.tsx src/features/palace-catalog/model/palaceCatalog.test.ts` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | PalaceListPage 迁移到 TanStack Query | 已完成 |
