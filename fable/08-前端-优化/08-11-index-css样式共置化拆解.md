---
编号: 08-11
标题: index.css 样式共置化拆解
类型: 优化
范围: 前端
优先级: P1
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-11 index.css 样式共置化拆解

## 1. 原始需求

`apps/web/src/index.css` 膨胀到 1700+ 行，维护成本高。目标是在保持样式顺序和视觉行为不变的前提下拆分为语义 CSS 分片。

## 2. 详细执行清单

1. 将 `apps/web/src/index.css` 收敛为 import 入口。
2. 新增 `apps/web/src/styles/foundation.css`、`feedback.css`、`celebrations.css`、`timer.css`、`motion-surfaces.css`。
3. 保持原 CSS 顺序，不做视觉重设计。

## 3. 测试验收标准

- `cd apps/web && npm run build` 通过。
- `cd apps/web && npm run test -- src/indexCss.pwa.test.ts` 通过。
- `index.css` 从 1723 行收敛到 6 行 import。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 拆分全局 CSS 到 styles 分片 | 已完成 |
