---
编号: 08-14
标题: 硬编码色板迁移到语义 token
类型: 优化
范围: 前端
优先级: P1
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-14 硬编码色板迁移到语义 token

## 1. 原始需求

部分前端组件使用 hex 和 arbitrary gradient，绕过设计 token。目标是先收敛英语阅读工作区的明显硬编码色板，改用语义 token。

## 2. 详细执行清单

1. 修改 `apps/web/src/features/english-reading/components/EnglishReadingWorkspace.tsx`。
2. 将 `bg-[linear-gradient(...)]` 替换为 `bg-gradient-to-r from-info via-memory-strong to-success` 等 token。
3. 将 `border-slate-800/80 bg-slate-950/20` 替换为语义前景 token。

## 3. 测试验收标准

- `cd apps/web && npx eslint src/features/english-reading/components/EnglishReadingWorkspace.tsx eslint.config.js` 通过。
- `cd apps/web && npm run test -- src/features/english-reading` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 迁移英语阅读硬编码色板到语义 token | 已完成 |
