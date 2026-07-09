---
编号: 08-15
标题: 收紧 eslint 放宽规则
类型: 优化
范围: 前端
优先级: P2
预估工作量: S
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 08-15 收紧 eslint 放宽规则

## 1. 原始需求

ESLint 放宽项需要逐步收紧，先从低风险的 unused disable 报告开始。目标是在不引爆全量 lint 的情况下增加规则证据，并修复新暴露的目标错误。

## 2. 详细执行清单

1. 修改 `apps/web/eslint.config.js`，增加 `linterOptions.reportUnusedDisableDirectives: 'warn'`。
2. 修复目标 lint 中的 `knowledgeApi.ts` 无用赋值、`serviceWorkerContract.test.ts` 宽泛 Function 类型。
3. 对 `FreestyleCardScroller.tsx` 的 mutable ref registry 使用精准 disable，并写明原因。

## 3. 测试验收标准

- `cd apps/web && npx eslint src/entities/knowledge/api/knowledgeApi.ts src/features/freestyle/components/FreestyleCardScroller.tsx src/pwa/serviceWorkerContract.test.ts` 通过。
- `cd apps/web && npm run typecheck` 通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-09 | Codex | 增加 unused-disable 警告并修复目标 lint | 已完成 |
